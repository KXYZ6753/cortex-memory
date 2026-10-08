// Worker a6: offline loaders. Dev records only (pool), stored exploration answers, J1
// verdicts. Only entries whose questionKey is an exploration-pool record are kept (the "test:"
// key prefix is EnronQA's own split, not the study's TEST; TEST records are never in the pool).
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { ensureEmailStore } from "../../agent-run.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
export const dataDir = ".data/premise2"
export const pool = loadPool(dataDir)
export const missShare = pool.manifest.strata.missShare
export const judge = judgeConfig("j1")

let verdicts = null
export function verdictsIdx() {
    if (verdicts) return verdicts
    verdicts = new Map()
    const text = readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8")
    for (const line of text.split("\n")) {
        if (!line) continue
        const e = JSON.parse(line)
        if (e.verdict && pool.byKey.has(e.questionKey)) verdicts.set(e.vkey, e)
    }
    return verdicts
}
export const verdictRow = (record, text) => verdictsIdx().get(answerVerdictKey({ answer: text }, record, judge)) ?? null
export function verdictOf(record, text, status = "ok") {
    if (preGrade({ answer: text, status })) return 0
    const v = verdictRow(record, text)
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}

let answersCache = null
const allAnswers = () => (answersCache ??= latestAnswers(dataDir).filter((a) => pool.byKey.has(a.questionKey)))

// variant@version -> Map(questionKey -> { correct, a, row }) for the given sets
export function loadRuns(sets, variantsAt) {
    const keyset = new Map(sets.map((s) => [s, new Set(loadSet(dataDir, s, pool).questionKeys)]))
    const out = new Map(variantsAt.map((v) => [v, new Map()]))
    for (const a of allAnswers()) {
        const vAt = `${a.variant}@${a.version}`
        if (!out.has(vAt) || !keyset.has(a.set) || !keyset.get(a.set).has(a.questionKey)) continue
        const record = pool.byKey.get(a.questionKey)
        const row = preGrade(a) ? null : verdictRow(record, a.answer)
        const correct = preGrade(a) ? 0 : row ? (row.verdict === "CORRECT" ? 1 : 0) : null
        out.get(vAt).set(a.questionKey, { correct, a, row, set: a.set })
    }
    return out
}
export const setKeys = (s) => loadSet(dataDir, s, pool).questionKeys
export const openEmails = () => ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})

// question-stratified paired bootstrap over hits (Δ = mean(a - b)), and mailbox-cluster bootstrap
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"
export function bootHits(pairs, { B = BOOT_B, seed = 6060 } = {}) {
    const n = pairs.length
    const d = pairs.map((p) => p.a - p.b)
    const delta = d.reduce((s, x) => s + x, 0) / n
    const rnd = mulberry32(seed)
    const qs = []
    for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += d[Math.floor(rnd() * n)]; qs.push(s / n) }
    qs.sort((x, y) => x - y)
    // mailbox clusters
    const byUser = new Map()
    for (const [i, p] of pairs.entries()) { const l = byUser.get(p.user) ?? []; l.push(d[i]); byUser.set(p.user, l) }
    const groups = [...byUser.values()]
    const rnd2 = mulberry32(seed + 1)
    const cs = []
    for (let b = 0; b < B; b++) { let s = 0, m = 0; for (let g = 0; g < groups.length; g++) { const G = groups[Math.floor(rnd2() * groups.length)]; for (const x of G) s += x; m += G.length } cs.push(s / m) }
    cs.sort((x, y) => x - y)
    return { delta, low: pctSorted(qs, 0.025), high: pctSorted(qs, 0.975), cLow: pctSorted(cs, 0.025), cHigh: pctSorted(cs, 0.975), plus: d.filter((x) => x > 0).length, minus: d.filter((x) => x < 0).length, n }
}
