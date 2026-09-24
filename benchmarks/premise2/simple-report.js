// Exploratory word-overlap report. Reads immutable preparation and copied answer
// snapshots; writes no data into the Windows simple-run directory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { generationKey, optionsHash, readJsonl } from "./store.js"
import { judgeConfig, preGrade, spanScore } from "./judge.js"
import { agentUnits, unitVerdictKey, verdictIndex } from "./grade.js"
import { ranksFor } from "./retrieve.js"
import { clusterBootstrap } from "./stats.js"
import { simpleDirOf, simpleStatus, loadSimple, simpleUnits } from "./simple.js"
import { integrateBlocks } from "./energy-integrate.js"

const mean = (xs) => xs.reduce((sum, value) => sum + value, 0) / xs.length
const round = (x) => Number.isFinite(x) ? Number(x.toFixed(4)) : null
const percent = (x) => x == null ? "pending" : `${(x * 100).toFixed(1)}%`
const read = (path) => JSON.parse(readFileSync(path, "utf8"))

export function pairedEstimate(rows, { weightedCore = false, shares = null, B = 10000 } = {}) {
    if (rows.length < 2) return { n: rows.length, estimate: null, ci: [null, null] }
    const stratumCounts = new Map()
    for (const row of rows) stratumCounts.set(row.stratum, (stratumCounts.get(row.stratum) ?? 0) + 1)
    const statistic = (sample) => {
        let total = 0, weights = 0
        for (const row of sample) {
            const weight = weightedCore ? (shares[row.stratum] ?? 0) / (stratumCounts.get(row.stratum) / rows.length) : 1
            total += weight * (row.a - row.b)
            weights += weight
        }
        return total / weights
    }
    const boot = clusterBootstrap({ items: rows, clusterOf: (row) => row.user, statistic, B, seed: 20260922 })
    return { n: rows.length, estimate: round(boot.estimate), ci: [round(boot.low), round(boot.high)], clusters: boot.clusters, weightedCore }
}

export function coreWeightedMean(rows, field, shares) {
    const counts = new Map()
    for (const row of rows) counts.set(row.stratum, (counts.get(row.stratum) ?? 0) + 1)
    let sum = 0, weightSum = 0
    for (const row of rows) {
        const weight = (shares[row.stratum] ?? 0) / (counts.get(row.stratum) / rows.length)
        sum += weight * row[field]
        weightSum += weight
    }
    return sum / weightSum
}

export function score(unit, indexes, judges) {
    if (!unit) return null
    if (unit.answer.status === "context_overflow") return { final: null, strict: null, span: null, excluded: true }
    const pre = preGrade(unit.answer)
    if (pre) return { final: 0, strict: 0, span: 0, pre: pre.source }
    const j1 = indexes.j1.get(unitVerdictKey(unit, judges.j1))?.verdict
    const j2 = indexes.j2.get(unitVerdictKey(unit, judges.j2))?.verdict
    const adj = indexes.adj.map(({ judge, index }) => index.get(unitVerdictKey(unit, judge))?.verdict).find(Boolean) ?? null
    const bit = (value) => value === "CORRECT" ? 1 : value === "INCORRECT" ? 0 : null
    const consensus = j1 && j2 && j1 === j2 ? bit(j1) : null
    return { final: adj ? bit(adj) : consensus, strict: j1 && j2 ? Number(j1 === "CORRECT" && j2 === "CORRECT") : null, span: spanScore(unit.answer.answer, unit.record.gold) }
}

export async function simpleReport({ dataDir, outDir = "benchmarks/results/premise2", loadCorpus, log = console.log }) {
    const { dir, items, manifest } = loadSimple({ dataDir })
    const pools = read(join(dataDir, "pools.json"))
    const main = read(join(dataDir, "run-state.json"))
    const cells = read(join(dataDir, "cells.json")).cells
    const baseline = cells.find((cell) => cell.id === "P-B")
    if (!baseline) throw new Error("P-B baseline cell missing")
    const byQuestion = new Map(pools.test.map((record) => [record.questionKey, record]))
    const simple = simpleUnits({ dataDir, recordByKey: byQuestion })
    const mainDone = new Map(readJsonl(join(dataDir, "answers.jsonl")).records.filter((row) => row.type === "answer" && ["ok", "empty", "output_limit", "context_overflow"].includes(row.status)).map((row) => [row.key, row]))
    const optsHash = optionsHash(main.provenance.options)
    const baseUnits = ["small", "mid", "large"].flatMap((alias) => (baseline.items.slice(0, baseline.models[alias] ?? baseline.items.length)).flatMap((item) => {
        const key = generationKey(main.provenance.digests[alias], optsHash, item.promptSha)
        const answer = mainDone.get(key)
        if (!answer) return []
        return [{ cellId: "P-B", alias, tier: "A", item, answer, answerKey: key, record: byQuestion.get(item.questionKey) }]
    }))
    const agentDir = join(dataDir, "agent")
    const verdicts = [
        ...readJsonl(join(dataDir, "verdicts.jsonl")).records,
        ...readJsonl(join(dataDir, "simple-grading", "verdicts.jsonl")).records,
        ...readJsonl(join(agentDir, "verdicts.jsonl")).records,
    ]
    const judges = { j1: judgeConfig("j1"), j2: judgeConfig("j2") }
    const adjModels = new Map()
    for (const row of verdicts) if (row.type === "verdict" && row.judge === "adj" && row.verdict) adjModels.set(row.judgeModel, (adjModels.get(row.judgeModel) ?? 0) + 1)
    judges.adj = { ...judgeConfig("adj"), model: [...adjModels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? judgeConfig("adj").model }
    const indexes = { j1: verdictIndex(verdicts, "j1", judges.j1.model), j2: verdictIndex(verdicts, "j2", judges.j2.model), adj: [judges.adj.model, ...[...adjModels.keys()].filter((model) => model !== judges.adj.model)].map((model) => ({ judge: { ...judges.adj, model }, index: verdictIndex(verdicts, "adj", model) })) }
    const keyed = (units) => new Map(units.map((unit) => [`${unit.alias}|${unit.item.questionKey}`, { ...unit, scores: score(unit, indexes, judges) }]))
    const simpleMap = keyed(simple)
    const baseMap = keyed(baseUnits)
    const agentItems = read(new URL("./agent-items.json", import.meta.url))
    const stratum = new Map(agentItems.items.map((item) => [item.questionKey, item.stratum]))
    const paired = (aMap, bMap, aliasA, aliasB, limit, weightedCore = false) => {
        const rows = []
        let generated = 0, pending = 0, excluded = 0
        for (const item of items.slice(0, limit)) {
            const a = aMap.get(`${aliasA}|${item.questionKey}`)
            const b = bMap.get(`${aliasB}|${item.questionKey}`)
            if (!a || !b) continue
            generated++
            if (a.scores.excluded || b.scores.excluded) { excluded++; continue }
            if (a.scores.final == null || b.scores.final == null) { pending++; continue }
            rows.push({ user: a.record.user, a: a.scores.final, b: b.scores.final, stratum: stratum.get(item.questionKey) })
        }
        const complete = generated === limit && rows.length === limit && pending === 0 && excluded === 0
        const useWeights = weightedCore && complete
        return { target: limit, generatedPairs: generated, gradedPairs: rows.length, pending, excluded,
            aAccuracy: round(rows.length ? useWeights ? coreWeightedMean(rows, "a", agentItems.trueShares) : mean(rows.map((row) => row.a)) : NaN),
            bAccuracy: round(rows.length ? useWeights ? coreWeightedMean(rows, "b", agentItems.trueShares) : mean(rows.map((row) => row.b)) : NaN),
            ratesWeighted: useWeights, complete,
            comparison: complete ? pairedEstimate(rows, { weightedCore, shares: agentItems.trueShares }) : { n: rows.length, estimate: null, ci: [null, null], note: "graded prefix only; inference withheld until checkpoint complete" } }
    }
    const comparisons = {}
    for (const alias of ["small", "mid", "large"]) {
        comparisons[`${alias} word overlap − BM25, 600`] = paired(simpleMap, baseMap, alias, alias, 600)
        if (alias !== "large") comparisons[`${alias} word overlap − BM25, 955`] = paired(simpleMap, baseMap, alias, alias, items.length)
    }
    for (const alias of ["small", "mid"]) {
        comparisons[`${alias} BM25 − large word overlap, core`] = paired(baseMap, simpleMap, alias, "large", 200, true)
        comparisons[`${alias} BM25 − large word overlap, 600`] = paired(baseMap, simpleMap, alias, "large", 600)
    }
    const { evidence, emailByPath } = await loadCorpus()
    const retrievalRows = readJsonl(join(dataDir, "retrieval.jsonl")).records
    const retrievalByKey = new Map(retrievalRows.map((row) => [row.questionKey, row]))
    const recall = { wordOverlap: 0, bm25: 0, strictWordOverlap: 0, strictBm25: 0, n: items.length }
    for (const item of items) {
        const record = byQuestion.get(item.questionKey)
        const ranked = item.paths.map((path) => ({ path }))
        const r = ranksFor(record, ranked, evidence)
        const b = retrievalByKey.get(item.questionKey)?.ranks?.["bm25|global|questions"]
        if (r.answer != null && r.answer <= 5) recall.wordOverlap++
        if (b?.answer != null && b.answer <= 5) recall.bm25++
        if (r.strict != null && r.strict <= 5) recall.strictWordOverlap++
        if (b?.strict != null && b.strict <= 5) recall.strictBm25++
    }
    const agentComparisons = {}
    if (existsSync(join(agentDir, "answers.jsonl"))) {
        const agent = agentUnits({ agentDir, recordByKey: byQuestion, emailByPath, evidence })
        for (const alias of ["small", "mid", "large"]) {
            const arm = keyed(agent.filter((unit) => unit.alias === alias && unit.cellId === "A-agent@bm25-fields"))
            const base = keyed(agent.filter((unit) => unit.alias === alias && unit.cellId === "A-agent"))
            agentComparisons[`${alias} field BM25 − ordinary BM25`] = paired(arm, base, alias, alias, alias === "large" ? 200 : 600, alias === "large")
        }
    }
    const status = simpleStatus({ dataDir, quiet: true })
    const energyBlocks = existsSync(join(dir, "energy.jsonl")) ? integrateBlocks({ samples: readJsonl(join(dir, "energy.jsonl")).records, markers: readJsonl(join(dir, "markers.jsonl")).records }).filter((row) => row.kind === "block") : []
    const energy = energyBlocks.length ? { grossJ: round(energyBlocks.reduce((sum, row) => sum + (row.grossJ ?? 0), 0)), blocks: energyBlocks.length, note: "gross phase energy includes model load and any waits; not directly comparable with V2 marginal energy" } : null
    const latency = Object.fromEntries(["small", "mid", "large"].map((alias) => {
        const values = simple.filter((unit) => unit.alias === alias && !unit.answer.reusedFromMain && Number.isFinite(unit.answer.wallMs)).map((unit) => unit.answer.wallMs)
        return [alias, { newlyGenerated: values.length, meanWallMs: round(values.length ? mean(values) : NaN) }]
    }))
    const result = { label: "EXPLORATORY; partial until generated and graded targets are met", generatedAt: new Date().toISOString(), ranker: "distinct content-word overlap over the full BM25 corpus; score/path order with context-budget selection; no IDF/TF/length normalization", eligibility: { allEmails: manifest.allEmails, fallbackQuestions: manifest.fallbackQuestions, underFive: manifest.underFive }, recall: Object.fromEntries(Object.entries(recall).map(([key, value]) => key === "n" ? [key, value] : [key, round(value / recall.n)])), status, judges, adjudicatorModels: [...adjModels.keys()], warnings: adjModels.size > 1 ? ["multiple adjudicator models were used; report combines their saved verdicts per question"] : [], comparisons, agentComparisons, latency, energy }
    mkdirSync(outDir, { recursive: true })
    const jsonPath = join(outDir, "simple-report.json")
    const mdPath = join(outDir, "simple-report.md")
    writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n")
    const lines = ["# Exploratory word-overlap comparison", "", `Generated ${result.generatedAt}. Partial prefixes are observations only; uncertainty intervals appear when a declared checkpoint is fully generated and graded.`, "", `Word overlap ranks all ${manifest.allEmails} BM25 corpus emails, greedily selects five in score/path order while reserving prompt space, and fills any remaining slots with the earliest fitting zero-score emails in path order. This fallback was used on ${manifest.fallbackQuestions} questions. No gold answers enter ranking.`, "", "## Retrieval on 955 test questions", "", `Answer-bearing recall@5: word overlap ${percent(result.recall.wordOverlap)}, BM25 ${percent(result.recall.bm25)}. Strict gold recall@5: ${percent(result.recall.strictWordOverlap)} versus ${percent(result.recall.strictBm25)}.`, "", "## Paired answer accuracy", "", "| Comparison | Generated pairs / target | Graded pairs | First arm | Second arm | Difference, 95% mailbox CI |", "|---|---:|---:|---:|---:|---:|"]
    for (const [name, row] of Object.entries(comparisons)) lines.push(`| ${name} | ${row.generatedPairs}/${row.target} | ${row.gradedPairs} | ${percent(row.aAccuracy)}${row.ratesWeighted ? " weighted" : row.complete ? "" : " observed prefix"} | ${percent(row.bAccuracy)}${row.ratesWeighted ? " weighted" : row.complete ? "" : " observed prefix"} | ${percent(row.comparison.estimate)} [${percent(row.comparison.ci[0])}, ${percent(row.comparison.ci[1])}]${row.comparison.weightedCore ? " weighted" : ""} |`)
    lines.push("", "## Agent index comparisons (existing episodes)", "", "| Comparison | Generated / target | Graded | Difference, 95% mailbox CI |", "|---|---:|---:|---:|")
    for (const [name, row] of Object.entries(agentComparisons)) lines.push(`| ${name} | ${row.generatedPairs}/${row.target} | ${row.gradedPairs} | ${percent(row.comparison.estimate)} [${percent(row.comparison.ci[0])}, ${percent(row.comparison.ci[1])}]${row.comparison.weightedCore ? " weighted to selected 600" : ""} |`)
    lines.push("", `New-generation mean wall time: ${["small", "mid", "large"].map((alias) => `${alias} ${result.latency[alias].meanWallMs ?? "pending"} ms (n=${result.latency[alias].newlyGenerated})`).join("; ")}.`, `Energy: ${energy ? `${energy.grossJ} gross J across ${energy.blocks} blocks; ${energy.note}` : "unavailable"}.`, "", "All new word-overlap comparisons are exploratory. The 200-question core is enriched for BM25 misses; only a complete core receives the pre-specified stratum weighting.")
    writeFileSync(mdPath, lines.join("\n") + "\n")
    log(`[simple-report] wrote ${mdPath}`)
    return result
}
