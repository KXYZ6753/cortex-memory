// Grading units and the registered analysis for the addendum-4 TEST arms (worker p3).
// Called from confirm2.js (`grade <arm>`, `analyze`); never reads TEST data at import time.
//
// Estimator exactly as addendum 3 §4 / explore/confirm.js analyzeConfirm: per-question paired
// differences over the questions where both arms have a final tier-A score, unweighted;
// mailbox-cluster bootstrap (stats.js clusterBootstrap, B = 10,000, seed 20260922),
// bootstrapP (two-sided; non-inferiority one-sided at the margin, doubled, as in stats.js),
// classify; Holm over the primary family. Scores come from confirm.js scoreWith (an arm's own
// context overflow / technical failure counts INCORRECT with overflowIsWrong; sensitivity with
// exclusion). Verdicts: the main study's, addendum 3's confirm/verdicts.jsonl (gates and the
// comparators) and every addendum-4 arm's verdicts.jsonl; adjudicator = the model with the most
// adjudications, as analyzeConfirm.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"

export const B_CONFIRM = 10_000
export const SEED = 20260922
export const MARGIN = 0.05
const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN)
const round = (value, digits = 4) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)))
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null)
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

// ---- answers and units ----

// explore/confirm.js confirmAnswers' rule, for any store: the latest final record per key; a
// question whose attempts all failed keeps its last failure (graded INCORRECT).
export async function latestAnswers(answersPath) {
    const { readJsonl, FINAL_STATUSES } = await import("../explore/run.js")
    const byKey = new Map()
    for (const record of readJsonl(answersPath)) {
        const previous = byKey.get(record.key)
        if (!previous || FINAL_STATUSES.has(record.status) || !FINAL_STATUSES.has(previous.status)) byKey.set(record.key, record)
    }
    return [...byKey.values()]
}

// Grading units in the main study's shape (as confirm.js confirmUnits). The adjudicator's
// evidence is the set of emails the final answer call saw: `readPaths` (every explore2 arm sets
// it: the final context, plus W1 when the abstention retry ran; g5's final read set on a
// handover), else `contextPaths`.
export async function armUnits({ dataDir, dir, cellId, confirmVersion, alias = "small" }) {
    const pools = readJson(join(dataDir, "pools.json"))
    const recordByKey = new Map(pools.test.map((record) => [record.questionKey, record]))
    return (await latestAnswers(join(dir, "answers.jsonl"))).map((answer) => {
        const paths = answer.readPaths ?? answer.contextPaths ?? []
        return {
            cellId, role: "primary", tier: "A", alias, answer, answerKey: answer.key, record: recordByKey.get(answer.questionKey),
            item: { questionKey: answer.questionKey, promptSha: sha256(`${confirmVersion}|${JSON.stringify(paths)}`), paths },
        }
    })
}

// ---- descriptives ----

// Path of one answer, as tools/e2-energy.js pathOf.
export const pathOf = (a) => {
    if (a.q?.m2Fired === true || a.lite?.m2Fired === true || (Array.isArray(a.log) && a.log.some((l) => l?.act === "rec"))) return a.step === "commit-g5" ? "m2+g5" : "m2"
    if (["found", "nofound", "nopick"].includes(a.step)) return "explore"
    if (a.step === "commit-g5") return "commit+g5"
    if (a.step == null) return "one-shot"
    return "commit"
}

export function describeAnswers(answers) {
    const walls = answers.map((a) => a.wallMs).filter(Number.isFinite).sort((a, b) => a - b)
    const resets = answers.map((a) => a.det?.resets ?? 0)
    const calls = answers.map((a) => a.calls ?? 0)
    const paths = {}
    for (const a of answers) { const p = pathOf(a); paths[p] = (paths[p] ?? 0) + 1 }
    const cached = answers.flatMap((a) => a.det?.cached ?? [])
    const statuses = {}
    for (const a of answers) statuses[a.status] = (statuses[a.status] ?? 0) + 1
    return {
        n: answers.length, statuses,
        latency: { meanMs: Math.round(mean(walls)), p50Ms: quantile(walls, 0.5), p95Ms: quantile(walls, 0.95), maxMs: walls.at(-1) ?? null },
        calls: { meanAll: round(mean(calls), 3), meanReal: round(mean(calls.map((c, i) => c - resets[i])), 3), meanResets: round(mean(resets), 3), maxReal: Math.max(0, ...calls.map((c, i) => c - resets[i])) },
        paths,
        det: cached.length ? { calls: cached.length, at0: cached.filter((c) => c === 0).length, at1to99: cached.filter((c) => c != null && c >= 1 && c <= 99).length, atLeast100: cached.filter((c) => c != null && c >= 100).length, unknown: cached.filter((c) => c == null).length } : null,
        switched: answers.filter((a) => a.switched).length, retried: answers.filter((a) => a.used === 2).length,
    }
}

// ---- contrasts ----

// arms: { name: Map(questionKey -> { final, j1 }) }; userOf(questionKey) -> mailbox.
export async function makeContrast({ arms, userOf }) {
    const { clusterBootstrap, bootstrapP, classify } = await import("../stats.js")
    return (name, a, b, { kind = "final", keys, type = "superiority", margin = 0 } = {}) => {
        if (!arms[a] || !arms[b]) return { name, n: 0, label: "NOT RUN", missingArm: !arms[a] ? a : b }
        const rows = []
        for (const key of keys) {
            const x = arms[a].get(key)?.[kind]
            const y = arms[b].get(key)?.[kind]
            if (x == null || y == null) continue
            rows.push({ user: userOf(key), a: x, b: y })
        }
        if (rows.length < 2) return { name, n: rows.length, label: "NOT RUN" }
        const result = clusterBootstrap({ items: rows, clusterOf: (row) => row.user, statistic: (sample) => mean(sample.map((row) => row.a - row.b)), B: B_CONFIRM, seed: SEED })
        const p = bootstrapP(result, { kind: type, margin })
        return {
            name, arms: [a, b], kind, type, margin, n: rows.length, clusters: result.clusters,
            armMeans: [round(mean(rows.map((row) => row.a))), round(mean(rows.map((row) => row.b)))],
            estimate: round(result.estimate), low: round(result.low), high: round(result.high), p: round(p, 5),
            label: classify({ estimate: result.estimate, low: result.low, high: result.high, margin, kind: type }),
            discordant: { onlyFirst: rows.filter((row) => row.a > row.b).length, onlySecond: rows.filter((row) => row.a < row.b).length },
        }
    }
}

// The registered tests. armIds: the PREREG's `Arms:` list (first = confirmatory), short names
// from the verdict key prefixes. Arm maps: `<arm>` (overflowIsWrong), `<arm>:excl`, gates,
// gates:excl, e2bPB, b31PB.
export async function registeredTests({ arms, userOf, armIds, shortOf, first600, allRun }) {
    const { holm } = await import("../stats.js")
    const contrast = await makeContrast({ arms, userOf })
    const [primary, ...others] = armIds
    const s = (arm) => shortOf[arm] ?? arm
    const three = (arm, { kind = "final", excl = false, keys = first600, suffix = "" } = {}) => {
        const a = excl ? `${arm}:excl` : arm
        const g = excl ? "gates:excl" : "gates"
        return {
            Z1: contrast(`Z1 e2b(${s(arm)}) - e2b(P-B), superiority${suffix}`, a, "e2bPB", { kind, keys }),
            Z2ni: contrast(`Z2-NI e2b(${s(arm)}) - 31b(P-B), non-inferiority at 5 pts${suffix}`, a, "b31PB", { kind, keys, type: "noninferiority", margin: MARGIN }),
            Z3: contrast(`Z3 e2b(${s(arm)}) - e2b(gates), superiority${suffix}`, a, g, { kind, keys }),
        }
    }
    const confirmatory = three(primary)
    const family = ["Z1", "Z2ni", "Z3"].filter((id) => confirmatory[id].p != null)
    const adjusted = holm(family.map((id) => confirmatory[id].p))
    family.forEach((id, index) => { confirmatory[id].holmP = round(adjusted[index], 5) })
    const secondary = {}
    const add = (prefix, tests) => { for (const [id, test] of Object.entries(tests)) secondary[`${prefix}.${id}`] = test }
    add(`${s(primary)}.excl`, three(primary, { excl: true, suffix: ", own overflow/failures excluded" }))
    add(`${s(primary)}.j1`, three(primary, { kind: "j1", suffix: ", J1 only" }))
    secondary[`${s(primary)}.Z2sup`] = contrast(`e2b(${s(primary)}) - 31b(P-B), superiority`, primary, "b31PB", { keys: first600 })
    for (const arm of others) {
        add(s(arm), three(arm))
        add(`${s(arm)}.excl`, three(arm, { excl: true, suffix: ", own overflow/failures excluded" }))
        add(`${s(arm)}.j1`, three(arm, { kind: "j1", suffix: ", J1 only" }))
        secondary[`${s(arm)}-${s(primary)}`] = contrast(`e2b(${s(arm)}) - e2b(${s(primary)})`, arm, primary, { keys: first600 })
        secondary[`${s(arm)}-${s(primary)}.j1`] = contrast(`e2b(${s(arm)}) - e2b(${s(primary)}), J1 only`, arm, primary, { kind: "j1", keys: first600 })
    }
    for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) {
        secondary[`${s(others[i])}-${s(others[j])}`] = contrast(`e2b(${s(others[i])}) - e2b(${s(others[j])})`, others[i], others[j], { keys: first600 })
    }
    for (const arm of armIds) {
        const run = allRun[arm]
        if (run && run.size > first600.size) secondary[`${s(arm)}.Z1all`] = contrast(`Z1 on every TEST question run (${run.size})`, arm, "e2bPB", { keys: run })
    }
    return { confirmatory, secondary }
}

// ---- report ----

const pct = (v) => (v == null ? "–" : (v * 100).toFixed(1))
export function renderMarkdown(out) {
    const row = (t) => (t.estimate == null ? `| ${t.name} | ${t.n} | – | NOT RUN | – | – | ${t.label} |` : `| ${t.name} | ${t.n} | ${pct(t.armMeans[0])} vs ${pct(t.armMeans[1])} | ${pct(t.estimate)} [${pct(t.low)}, ${pct(t.high)}] | ${t.p} | ${t.holmP ?? "–"} | ${t.label} |`)
    const head = ["| test | n | arm means | Δ [95% CI] | p | Holm p | label |", "|---|---|---|---|---|---|---|"]
    const lines = [
        `# Addendum 4 on TEST: ${out.arms.join(", ")}${out.synthetic ? " (SYNTHETIC: pipeline test, not data)" : ""}`, "",
        `Tier A (J1 ${out.judges.j1}, J2 ${out.judges.j2}, adjudicator ${out.judges.adj}); paired mailbox-cluster bootstrap, B = ${B_CONFIRM}, seed ${SEED}. explore2 code hash \`${out.codeHash}\`.`, "",
        `## Confirmatory (${out.arms[0]}; Holm over Z1, Z2-NI, Z3)`, "", ...head, ...Object.values(out.confirmatory).map(row), "",
        "## Secondary (estimates and 95% CIs; unadjusted p; no confirmatory claim)", "", ...head, ...Object.values(out.secondary).map(row), "",
        "## Per arm", "",
        "| arm | answers (600) | tier-A accuracy | unresolved | overflow | technical | mean ms | p50 | p95 | calls real (all) | paths |", "|---|---|---|---|---|---|---|---|---|---|---|",
        ...Object.entries(out.perArm).map(([arm, a]) => `| ${arm} | ${a.answers600 ?? "–"} | ${pct(a.accuracy600)} | ${a.unresolved600 ?? "–"} | ${a.overflow ?? "–"} | ${a.technical ?? "–"} | ${a.describe?.latency.meanMs ?? "–"} | ${a.describe?.latency.p50Ms ?? "–"} | ${a.describe?.latency.p95Ms ?? "–"} | ${a.describe?.calls.meanReal ?? "–"} (${a.describe?.calls.meanAll ?? "–"}) | ${a.describe ? Object.entries(a.describe.paths).map(([p, n]) => `${p} ${n}`).join(", ") : "–"} |`),
        "", "## Energy", "",
        "| arm | block basis gross / marginal J per answer | per correct | GPU gross J/answer | GPU marginal | CPU J (A / B) | total gross J/answer | **total J per correct** (gross / marginal) | CPU share | runner pid (source, CPU s/answer) |", "|---|---|---|---|---|---|---|---|---|---|",
        ...Object.entries(out.perArm).map(([arm, a]) => {
            const e = a.energy
            if (!e?.available) return `| ${arm} | ${e?.reason ?? "–"} | | | | | | | | |`
            const b1 = e.basis1, b2 = e.basis2
            const runners = b2?.runners?.map((r) => `${r.pid ?? "?"} (${r.source}, ${r.perAnswer ?? "?"})`).join("; ") ?? "–"
            return `| ${arm} | ${b1.grossJPerAnswer?.mean ?? "–"} / ${b1.marginalJPerAnswer?.mean ?? "–"} | ${b1.grossJPerCorrect ?? "–"} / ${b1.marginalJPerCorrect ?? "–"} | ${b2?.perAnswer.gpuGrossJ ?? "–"} | ${b2?.perAnswer.gpuMarginalJ ?? "–"} | ${b2?.perAnswer.cpuAJ ?? "–"} / ${b2?.perAnswer.cpuBJ ?? "–"} | ${b2?.perAnswer.totalGrossJ ?? "–"} | ${b2?.perCorrect.totalGrossJ ?? "–"} / ${b2?.perCorrect.totalMarginalJ ?? "–"} | ${b2?.perAnswer.cpuShare ?? "–"} | ${runners} |`
        }),
        "", out.energyNote ?? "",
    ]
    return lines.join("\n") + "\n"
}

// ---- the TEST analysis ----

export async function analyzeTest({ dataDir, armIds, cellOf, shortOf, codeHash, confirmVersion, dirOf, outDir = "benchmarks/results/premise2/explore2", log = console.log }) {
    const { AnswerStore, readJsonl: readStoreJsonl } = await import("../store.js")
    const { judgeConfig } = await import("../judge.js")
    const { gradingUnits, verdictIndex } = await import("../grade.js")
    const { confirmRecords, confirmUnits, confirmAnswers, confirmDirOf, scoreWith } = await import("../explore/confirm.js")
    const { mainVerdictRecords, JUDGE_MODELS } = await import("./tier-a.js")
    const { armEnergy } = await import("./confirm2-energy.js")
    const state = readJson(join(dataDir, "run-state.json"))
    const { cells } = readJson(join(dataDir, "cells.json"))
    const pools = readJson(join(dataDir, "pools.json"))
    const recordByKey = new Map([...pools.dev, ...pools.test, ...pools.bridge].map((record) => [record.questionKey, record]))
    const confirmDir = confirmDirOf(dataDir)
    const verdicts = [...mainVerdictRecords(dataDir), ...readStoreJsonl(join(confirmDir, "verdicts.jsonl")).records]
    for (const arm of armIds) verdicts.push(...readStoreJsonl(join(dirOf(arm), "verdicts.jsonl")).records)
    const j1 = judgeConfig("j1")
    const j2 = judgeConfig("j2")
    const adjCounts = new Map()
    for (const record of verdicts) if (record.type === "verdict" && record.judge === "adj" && record.verdict) adjCounts.set(record.judgeModel, (adjCounts.get(record.judgeModel) ?? 0) + 1)
    const adj = { ...judgeConfig("adj"), model: [...adjCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? JUDGE_MODELS.adj }
    const score = scoreWith({ j1, j2, adj, j1Index: verdictIndex(verdicts, "j1", j1.model), j2Index: verdictIndex(verdicts, "j2", j2.model), adjIndex: verdictIndex(verdicts, "adj", adj.model) })

    const order = confirmRecords(dataDir, 955).map((record) => record.questionKey)
    const first600 = new Set(order.slice(0, 600))
    const pbUnits = gradingUnits({ cells, state, store: new AnswerStore(join(dataDir, "answers.jsonl")), recordByKey }).filter((unit) => unit.cellId === "P-B")
    const toMap = (units, options) => new Map(units.map((unit) => [unit.item.questionKey, { unit, ...score(unit, options) }]))
    // Sensitivity (addendum 3 §6 text): the arm's own context overflows (scoreWith without
    // overflowIsWrong, as analyzeConfirm) and its technical failures after 3 attempts (a status
    // outside explore/run.js FINAL_STATUSES) are excluded instead of INCORRECT.
    const { FINAL_STATUSES } = await import("../explore/run.js")
    const toExclMap = (units) => new Map(units.map((unit) => [unit.item.questionKey, FINAL_STATUSES.has(unit.answer.status) ? { unit, ...score(unit) } : { unit, final: null, j1: null, excluded: unit.answer.status }]))
    const gatesUnits = confirmUnits(dataDir)
    const arms = {
        gates: toMap(gatesUnits, { overflowIsWrong: true }), "gates:excl": toExclMap(gatesUnits),
        e2bPB: toMap(pbUnits.filter((unit) => unit.alias === "small")), b31PB: toMap(pbUnits.filter((unit) => unit.alias === "large")),
    }
    const unitsOf = {}
    const allRun = {}
    for (const arm of armIds) {
        const dir = dirOf(arm)
        if (!existsSync(join(dir, "answers.jsonl"))) continue
        const units = await armUnits({ dataDir, dir, cellId: cellOf[arm], confirmVersion })
        unitsOf[arm] = units
        arms[arm] = toMap(units, { overflowIsWrong: true })
        arms[`${arm}:excl`] = toExclMap(units)
        allRun[arm] = new Set(units.map((unit) => unit.item.questionKey).filter((key) => order.includes(key)))
    }
    const tests = await registeredTests({ arms, userOf: (key) => recordByKey.get(key).user, armIds, shortOf, first600, allRun })

    const perArm = {}
    const summarise = async (name, map, answers, energyArgs) => {
        const in600 = [...map.values()].filter((entry) => first600.has(entry.unit.item.questionKey))
        const finals = in600.filter((entry) => entry.final != null)
        const accuracy = finals.length ? mean(finals.map((entry) => entry.final)) : null
        const a600 = answers.filter((a) => first600.has(a.questionKey))
        perArm[name] = {
            answers600: in600.length, finals600: finals.length, unresolved600: in600.length - finals.length, accuracy600: round(accuracy),
            overflow: a600.filter((a) => a.status === "context_overflow").length,
            technical: a600.filter((a) => a.status !== "ok" && a.status !== "output_limit" && a.status !== "context_overflow").length,
            describe: describeAnswers(a600),
            energy: energyArgs ? await armEnergy({ ...energyArgs, answers: a600, accuracy }) : null,
        }
    }
    for (const arm of armIds) {
        if (!arms[arm]) { perArm[arm] = { note: "not run" }; continue }
        const dir = dirOf(arm)
        const manifest = readStoreJsonl(join(dir, "manifest.jsonl")).records.filter((record) => record.kind === "session-start" && record.mode === "test")
        const runnerPids = Object.fromEntries(manifest.map((record) => [record.session, record.runnerPid]))
        const excludePids = manifest.flatMap((record) => [record.energy?.loggerPid, record.energy?.samplerPid]).filter(Boolean)
        await summarise(arm, arms[arm], unitsOf[arm].map((unit) => unit.answer), { dir, runnerPids, excludePids })
    }
    const confirmLog = existsSync(join(dataDir, "explore", "confirm-run.log")) ? readFileSync(join(dataDir, "explore", "confirm-run.log"), "utf8") : ""
    const gatesLoggerPids = [...confirmLog.matchAll(/energy logger started \(pid (\d+)\)/g)].map((m) => Number(m[1]))
    const gatesPin = process.env.CONFIRM2_GATES_RUNNER_PID ? { run: Number(process.env.CONFIRM2_GATES_RUNNER_PID) } : null
    await summarise("gates", arms.gates, confirmAnswers(dataDir), { dir: confirmDir, runnerPids: gatesPin, excludePids: gatesLoggerPids })
    for (const [name, alias] of [["e2bPB", "small"], ["b31PB", "large"]]) {
        const map = arms[name]
        const in600 = [...map.values()].filter((entry) => first600.has(entry.unit.item.questionKey))
        const finals = in600.filter((entry) => entry.final != null)
        perArm[name] = { alias, answers600: in600.length, finals600: finals.length, unresolved600: in600.length - finals.length, accuracy600: round(finals.length ? mean(finals.map((e) => e.final)) : null), note: "main study's P-B answers; energy: main study's figures (mainStudy below)" }
    }
    const mainReportPath = "benchmarks/results/premise2/report.json"
    const mainReport = existsSync(mainReportPath) ? readJson(mainReportPath) : null
    const out = {
        version: confirmVersion, arms: armIds, cells: cellOf, at: new Date().toISOString(), codeHash,
        judges: { j1: j1.model, j2: j2.model, adj: adj.model }, ...tests, perArm,
        mainStudy: mainReport ? { energy: mainReport.energy?.perCorrect ?? mainReport.energy ?? null } : null,
        energyNote: "Energy: block basis = addendum 3's (CPU package + GPU, a lower bound); attribution = e2.md's (GPU per question window + runner/llama-server/ollama CPU-seconds x this run's J per CPU-second, method A; B = direct share). gates' runner pid is detected (no manifest); set CONFIRM2_GATES_RUNNER_PID to pin it.",
    }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "confirm2.json"), JSON.stringify(out, null, 2))
    const md = renderMarkdown(out)
    writeFileSync(join(outDir, "confirm2.md"), md)
    log(md)
    return out
}

// ---- synthetic pipeline test (never TEST data) ----

// Random arms over synthetic questions and mailboxes, run through registeredTests and the
// report; energy from the dry-run directories of the arms (exploration questions only).
export async function analyzeSynthetic({ armIds, shortOf, cellOf, codeHash, confirmVersion, dryDirOf, outDir, seed = 7, log = console.log }) {
    const { armEnergy } = await import("./confirm2-energy.js")
    let state = seed >>> 0
    const rand = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const keys = Array.from({ length: 640 }, (_, i) => `syn-${i}`)
    const userOf = (key) => `user-${Number(key.slice(4)) % 30}`
    const first600 = new Set(keys.slice(0, 600))
    const base = new Map(keys.map((key) => [key, rand()]))
    const armOf = (p, { overflow = 0, unresolved = 0 } = {}) => new Map(keys.map((key) => {
        const final = base.get(key) < p ? 1 : 0
        const r = rand()
        if (r < unresolved) return [key, { final: null, j1: final }]
        if (r < unresolved + overflow) return [key, { final: 0, j1: 0, pre: "overflow" }]
        return [key, { final, j1: rand() < 0.95 ? final : 1 - final }]
    }))
    const arms = { e2bPB: armOf(0.88), b31PB: armOf(0.918), gates: armOf(0.90, { overflow: 0.002 }) }
    arms["gates:excl"] = new Map([...arms.gates].map(([k, v]) => [k, v.pre ? { final: null, j1: null } : v]))
    const accuracies = [0.925, 0.915, 0.912]
    armIds.forEach((arm, i) => {
        arms[arm] = armOf(accuracies[i] ?? 0.9, { overflow: 0.005, unresolved: 0.003 })
        arms[`${arm}:excl`] = new Map([...arms[arm]].map(([k, v]) => [k, v.pre ? { final: null, j1: null } : v]))
    })
    const allRun = Object.fromEntries(armIds.map((arm, i) => [arm, new Set(i === 0 ? keys : keys.slice(0, 600))]))
    const tests = await registeredTests({ arms, userOf, armIds, shortOf, first600, allRun })
    const perArm = {}
    for (const arm of armIds) {
        const dir = dryDirOf(arm)
        const finals = [...arms[arm].entries()].filter(([key, e]) => first600.has(key) && e.final != null).map(([, e]) => e)
        const accuracy = mean(finals.map((e) => e.final))
        let answers = []
        let energy = { available: false, reason: "no dry-run directory" }
        if (existsSync(join(dir, "answers.jsonl"))) {
            const { readJsonl } = await import("../store.js")
            answers = await latestAnswers(join(dir, "answers.jsonl"))
            const manifest = readJsonl(join(dir, "manifest.jsonl")).records.filter((record) => record.kind === "session-start")
            energy = await armEnergy({ dir, answers, accuracy, runnerPids: Object.fromEntries(manifest.map((record) => [record.session, record.runnerPid])), excludePids: manifest.flatMap((record) => [record.energy?.loggerPid, record.energy?.samplerPid]).filter(Boolean) })
        }
        perArm[arm] = { answers600: 600, finals600: finals.length, unresolved600: 600 - finals.length, accuracy600: round(accuracy), describe: answers.length ? describeAnswers(answers) : null, energy, note: "accuracy synthetic; latency, paths and energy from the arm's dry-run (exploration questions)" }
    }
    const out = { version: confirmVersion, synthetic: true, arms: armIds, cells: cellOf, at: new Date().toISOString(), codeHash, judges: { j1: "synthetic", j2: "synthetic", adj: "synthetic" }, ...tests, perArm, energyNote: "SYNTHETIC accuracy; energy rows are the dry-runs' own measurements." }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "confirm2.json"), JSON.stringify(out, null, 2))
    const md = renderMarkdown(out)
    writeFileSync(join(outDir, "confirm2.md"), md)
    log(md)
    return out
}
