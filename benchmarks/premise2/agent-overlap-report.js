// Exploratory paired report: only matched agent questions, no rerun of BM25.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readJsonl } from "./store.js"
import { judgeConfig } from "./judge.js"
import { agentUnits, verdictIndex } from "./grade.js"
import { pairedEstimate, coreWeightedMean, score } from "./simple-report.js"
import { agentOverlapDir, overlapStatus } from "./agent-overlap.js"
import { integrateBlocks } from "./energy-integrate.js"
import { simpleDirOf, simpleUnits } from "./simple.js"

const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const round = (value) => Number.isFinite(value) ? Number(value.toFixed(4)) : null
const percent = (value) => value == null ? "pending" : `${(value * 100).toFixed(1)}%`
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null

export function checkpointAccuracy({ paired, target, generated, pending = 0, excluded = 0, core = false, shares, B = 10000 }) {
    const complete = generated === target && paired.length === target && !pending && !excluded
    const weightedCore = core && complete
    const accuracy = (field) => round(paired.length ? weightedCore ? coreWeightedMean(paired, field, shares) : mean(paired.map((row) => row[field])) : NaN)
    return { target, generatedPairs: generated, gradedPairs: paired.length, pending, excluded, complete, weightedCore,
        aAccuracy: accuracy("a"), bAccuracy: accuracy("b"),
        difference: complete ? pairedEstimate(paired, { weightedCore, shares, B }) : { estimate: null, ci: [null, null], note: "partial checkpoint; descriptive only" } }
}

export async function agentOverlapReport({ dataDir, outDir = "benchmarks/results/premise2", loadCorpus, log = console.log }) {
    const itemsFile = read(new URL("./agent-items.json", import.meta.url))
    const byKey = new Map(read(join(dataDir, "pools.json")).test.map((row) => [row.questionKey, row]))
    const { evidence, emailByPath } = await loadCorpus()
    const newDir = agentOverlapDir(dataDir)
    const oldDir = join(dataDir, "agent")
    const verdicts = [
        ...readJsonl(join(dataDir, "verdicts.jsonl")).records,
        ...readJsonl(join(oldDir, "verdicts.jsonl")).records,
        ...readJsonl(join(dataDir, "simple-grading", "verdicts.jsonl")).records,
        ...readJsonl(join(dataDir, "agent-overlap-grading", "verdicts.jsonl")).records,
    ]
    const judges = { j1: judgeConfig("j1"), j2: judgeConfig("j2") }
    const adjModels = [...new Set(verdicts.filter((row) => row.type === "verdict" && row.judge === "adj" && row.verdict).map((row) => row.judgeModel))]
    judges.adj = judgeConfig("adj")
    const indexes = {
        j1: verdictIndex(verdicts, "j1", judges.j1.model),
        j2: verdictIndex(verdicts, "j2", judges.j2.model),
        adj: (adjModels.length ? adjModels : [judges.adj.model]).map((model) => ({ judge: { ...judges.adj, model }, index: verdictIndex(verdicts, "adj", model) })),
    }
    const base = agentUnits({ agentDir: oldDir, recordByKey: byKey, emailByPath, evidence }).filter((unit) => unit.cellId === "A-agent")
    const fresh = existsSync(join(newDir, "answers.jsonl")) ? agentUnits({ agentDir: newDir, recordByKey: byKey, emailByPath, evidence }).filter((unit) => unit.cellId === "A-agent@overlap") : []
    const mapped = (units) => new Map(units.map((unit) => [`${unit.alias}|${unit.item.questionKey}`, { ...unit, result: score(unit, indexes, judges) }]))
    const oldMap = mapped(base), newMap = mapped(fresh)
    const oneShot = existsSync(join(simpleDirOf(dataDir), "answers.jsonl")) ? mapped(simpleUnits({ dataDir, recordByKey: byKey })) : new Map()
    const rows = {}
    const oneShotRows = {}
    for (const [alias, target] of [["small", 600], ["mid", 600], ["large", 200], ["large", 600], ["tiny", 600]]) {
        const paired = []
        let generated = 0, excluded = 0, pending = 0
        let oldEvidence = 0, newEvidence = 0, oldRounds = [], newRounds = [], oldErrors = [], newErrors = [], oldLatency = [], newLatency = []
        for (const item of itemsFile.items.slice(0, target)) {
            const a = newMap.get(`${alias}|${item.questionKey}`)
            const b = oldMap.get(`${alias}|${item.questionKey}`)
            if (!a || !b) continue
            generated++
            const record = byKey.get(item.questionKey)
            const supports = (path) => path === record.path || (record.twins ?? []).includes(path) || evidence.answerBearing(path, record) === true
            if ((a.answer.shownPaths ?? []).some(supports)) newEvidence++
            if ((b.answer.shownPaths ?? []).some(supports)) oldEvidence++
            if (Number.isFinite(a.answer.rounds)) newRounds.push(a.answer.rounds)
            if (Number.isFinite(b.answer.rounds)) oldRounds.push(b.answer.rounds)
            if (Number.isFinite(a.answer.protocolErrors)) newErrors.push(a.answer.protocolErrors)
            if (Number.isFinite(b.answer.protocolErrors)) oldErrors.push(b.answer.protocolErrors)
            if (Number.isFinite(a.answer.wallMs)) newLatency.push(a.answer.wallMs)
            if (Number.isFinite(b.answer.wallMs)) oldLatency.push(b.answer.wallMs)
            if (a.result.excluded || b.result.excluded) { excluded++; continue }
            if (a.result.final == null || b.result.final == null) { pending++; continue }
            paired.push({ user: record.user, stratum: item.stratum, a: a.result.final, b: b.result.final })
        }
        const summary = checkpointAccuracy({ paired, target, generated, pending, excluded, core: alias === "large" && target === 200, shares: itemsFile.trueShares })
        rows[`${alias}${target}`] = {
            ...summary, overlapAccuracy: summary.aAccuracy, bm25Accuracy: summary.bAccuracy,
            surfacedEvidence: { overlap: round(generated ? newEvidence / generated : NaN), bm25: round(generated ? oldEvidence / generated : NaN) },
            meanRounds: { overlap: round(mean(newRounds)), bm25: round(mean(oldRounds)) },
            meanProtocolErrors: { overlap: round(mean(newErrors)), bm25: round(mean(oldErrors)) },
            meanWallMs: { overlap: round(mean(newLatency)), bm25: round(mean(oldLatency)) },
            auxiliaryCoreUnweighted: alias === "large" && target === 200,
        }
        // Secondary comparison: whole agent policy versus one-shot overlap, not
        // an isolated estimate of repeated SEARCH's causal contribution.
        if (alias !== "tiny") {
            const againstOneShot = []
            let oneShotGenerated = 0, oneShotPending = 0, oneShotExcluded = 0
            for (const item of itemsFile.items.slice(0, target)) {
                const a = newMap.get(`${alias}|${item.questionKey}`)
                const b = oneShot.get(`${alias}|${item.questionKey}`)
                if (!a || !b) continue
                oneShotGenerated++
                if (a.result.excluded || b.result.excluded) { oneShotExcluded++; continue }
                if (a.result.final == null || b.result.final == null) { oneShotPending++; continue }
                againstOneShot.push({ user: byKey.get(item.questionKey).user, stratum: item.stratum, a: a.result.final, b: b.result.final })
            }
            const oneShotSummary = checkpointAccuracy({ paired: againstOneShot, target, generated: oneShotGenerated, pending: oneShotPending, excluded: oneShotExcluded, core: alias === "large" && target === 200, shares: itemsFile.trueShares })
            oneShotRows[`${alias}${target}`] = {
                ...oneShotSummary, agentAccuracy: oneShotSummary.aAccuracy, oneShotAccuracy: oneShotSummary.bAccuracy,
            }
        }
    }
    const markers = readJsonl(join(newDir, "markers.jsonl")).records
    const samples = readJsonl(join(newDir, "energy.jsonl")).records
    const blocks = samples.length ? integrateBlocks({ samples, markers }).filter((row) => row.kind === "block") : []
    const energy = blocks.length ? { grossJ: round(blocks.reduce((sum, row) => sum + (row.grossJ ?? 0), 0)), blocks: blocks.length, note: "gross phase energy includes loads and waits; not a matched marginal-energy contrast" } : null
    const result = { label: "EXPLORATORY agent-plus-index effect", generatedAt: new Date().toISOString(), selectedQuestions: 600, coreQuestions: 200, status: overlapStatus({ dataDir, quiet: true }), adjudicatorModels: adjModels, rows, oneShotRows, energy, warning: "Tiny is a different model generation; complete core accuracy and differences weight to selected 600, not all 955 TEST questions. Auxiliary core metrics are unweighted descriptives." }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "agent-overlap-report.json"), JSON.stringify(result, null, 2) + "\n")
    const lines = ["# Exploratory agent word-overlap comparison", "", `Generated ${result.generatedAt}. Same agent protocol and frozen 600 questions; only SEARCH ranking changes. The accuracy contrast is the total agent-plus-index effect.`, "", "| Model checkpoint | Paired generated / target | Fully graded | Overlap agent | BM25 agent | Paired difference, 95% mailbox CI | Surfaced evidence overlap / BM25 |", "|---|---:|---:|---:|---:|---:|---:|"]
    for (const [name, row] of Object.entries(rows)) lines.push(`| ${name}${row.weightedCore ? " (core weighted to 600)" : row.target === 200 ? " (core only)" : ""} | ${row.generatedPairs}/${row.target} | ${row.gradedPairs} | ${percent(row.overlapAccuracy)}${row.complete ? "" : " observed prefix"} | ${percent(row.bm25Accuracy)}${row.complete ? "" : " observed prefix"} | ${percent(row.difference.estimate)} [${percent(row.difference.ci[0])}, ${percent(row.difference.ci[1])}] | ${percent(row.surfacedEvidence.overlap)} / ${percent(row.surfacedEvidence.bm25)} |`)
    lines.push("", "## Agent versus one-shot word overlap (secondary exploratory comparison)", "", "This compares whole policies with different prompts and search budgets; it does not isolate the causal benefit of repeated SEARCH.", "", "| Model checkpoint | Generated pairs / target | Graded | Agent overlap | One-shot overlap | Paired difference, 95% mailbox CI |", "|---|---:|---:|---:|---:|---:|")
    for (const [name, row] of Object.entries(oneShotRows)) lines.push(`| ${name}${row.weightedCore ? " (core weighted to 600)" : ""} | ${row.generatedPairs}/${row.target} | ${row.gradedPairs} | ${percent(row.agentAccuracy)}${row.complete ? "" : " observed prefix"} | ${percent(row.oneShotAccuracy)}${row.complete ? "" : " observed prefix"} | ${percent(row.difference.estimate)} [${percent(row.difference.ci[0])}, ${percent(row.difference.ci[1])}] |`)
    lines.push("", "Partial checkpoints have descriptive rates only; intervals require every paired answer and grade. Terminal technical or no-answer episodes score incorrect. Tiny is cross-generation and exploratory.", "", `Energy: ${energy ? `${energy.grossJ} gross J across ${energy.blocks} blocks; ${energy.note}` : "unavailable"}.`, "", "Mean rounds, protocol errors, and wall time are in the JSON report. Complete large-core accuracy and differences weight to the selected 600; auxiliary core metrics are unweighted descriptions of the 200 core questions. Full 600 estimates target the selected 600, not all 955 TEST questions.")
    writeFileSync(join(outDir, "agent-overlap-report.md"), lines.join("\n") + "\n")
    log(`[agent-overlap-report] wrote ${join(outDir, "agent-overlap-report.md")}`)
    return result
}
