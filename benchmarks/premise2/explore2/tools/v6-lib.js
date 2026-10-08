// Worker v6 (aux encoder selection): shared offline loaders. Pool records and development sets
// only (never TEST). Answers are restricted to alias "small" (e2b): FULL-0 also holds 600 answers
// from the "large" alias, which must never enter an e2b candidate pool.
import { readFileSync, existsSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { judgeConfig, preGrade } from "../../judge.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { ensureEmailStore } from "../../agent-run.js"
import { mulberry32, BOOT_B } from "./rng.js"

export const dataDir = ".data/premise2"
// The J1 judge config (provider/model) comes from .env; verdict keys depend on it.
if (process.env.POC2_J1_PROVIDER === undefined) try { process.loadEnvFile(".env") } catch {}
export const OUT = join(dataDir, "explore")
const FORBIDDEN = /^(H6-C|TEST)/i

export async function openV6() {
    const pool = loadPool(dataDir)
    const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
    const judge = judgeConfig("j1")
    const verdicts = verdictIndex(dataDir)
    const answers = latestAnswers(dataDir).filter((a) => (a.alias ?? "small") === "small" && !FORBIDDEN.test(a.set))
    const verdictOf = (record, text, status = "ok") => {
        const ans = { answer: text, status }
        if (preGrade(ans)) return 0
        const v = verdicts.get(answerVerdictKey(ans, record, judge))
        return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
    }
    // set -> questionKey -> variant -> answer (latest version of each variant id)
    const bySet = new Map()
    for (const a of answers) {
        if (!bySet.has(a.set)) bySet.set(a.set, new Map())
        const m = bySet.get(a.set)
        if (!m.has(a.questionKey)) m.set(a.questionKey, {})
        const q = m.get(a.questionKey)
        const prev = q[a.variant]
        if (!prev || String(a.at) > String(prev.at)) q[a.variant] = a
    }
    const setKeys = (name) => {
        if (FORBIDDEN.test(name)) throw new Error(`v6: set ${name} is off limits`)
        return loadSet(dataDir, name, pool).questionKeys
    }
    return { pool, emails, verdictOf, bySet, setKeys, missShare: pool.manifest.strata.missShare }
}

export const norm = (t) => String(t ?? "").trim()
export const sameCtx = (a, b) => JSON.stringify(a?.contextPaths ?? []) === JSON.stringify(b?.contextPaths ?? [])

// x1-family commit-check YES email (first YES of the commit check), or null
export const yesPath = (a) => (a?.log ?? []).find((l) => l.act === "check" && l.yes)?.path ?? null

// Paired bootstrap of a per-question difference (stratified by miss/hit), optionally clustered by
// mailbox (resample mailboxes, then their questions). Items: { stratum, d, user }.
export function bootDelta(items, missShare, { B = BOOT_B, seed = 6006, cluster = false, hitOnly = false } = {}) {
    const mean = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : 0)
    const est = (its) => {
        const m = its.filter((i) => i.stratum === "miss").map((i) => i.d), h = its.filter((i) => i.stratum === "hit").map((i) => i.d)
        if (hitOnly) return mean(h)
        return (m.length ? missShare * mean(m) : 0) + (h.length ? (m.length ? 1 - missShare : 1) * mean(h) : 0)
    }
    const point = est(items)
    const rnd = mulberry32(seed)
    const draws = []
    if (!cluster) {
        const m = items.filter((i) => i.stratum === "miss"), h = items.filter((i) => i.stratum === "hit")
        for (let b = 0; b < B; b++) {
            const s = []
            for (let i = 0; i < m.length; i++) s.push(m[Math.floor(rnd() * m.length)])
            for (let i = 0; i < h.length; i++) s.push(h[Math.floor(rnd() * h.length)])
            draws.push(est(s))
        }
    } else {
        const groups = new Map()
        for (const i of items) { const k = i.user ?? "?"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i) }
        const g = [...groups.values()]
        for (let b = 0; b < B; b++) {
            const s = []
            for (let i = 0; i < g.length; i++) s.push(...g[Math.floor(rnd() * g.length)])
            draws.push(est(s))
        }
    }
    draws.sort((a, b) => a - b)
    return { point: 100 * point, lo: 100 * draws[Math.floor(0.025 * B)], hi: 100 * draws[Math.floor(0.975 * B)] }
}
export const fmt = (ci) => `${ci.point >= 0 ? "+" : ""}${ci.point.toFixed(2)} [${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}]`

// Bootstrap of pairwise accuracy clustered by question (pairs within a question are not independent).
export function bootPairwise(byQuestion, { B = BOOT_B, seed = 6007 } = {}) {
    // byQuestion: [{ wins, n }] per question (wins can be fractional for ties)
    const tot = (l) => { let w = 0, n = 0; for (const x of l) { w += x.wins; n += x.n } return n ? w / n : NaN }
    const point = tot(byQuestion)
    const rnd = mulberry32(seed)
    const draws = []
    for (let b = 0; b < B; b++) {
        const s = []
        for (let i = 0; i < byQuestion.length; i++) s.push(byQuestion[Math.floor(rnd() * byQuestion.length)])
        draws.push(tot(s))
    }
    draws.sort((a, b) => a - b)
    return { point: 100 * point, lo: 100 * draws[Math.floor(0.025 * B)], hi: 100 * draws[Math.floor(0.975 * B)] }
}

// Encoder cache: one QA read per (questionKey, path); JSONL, append-only.
export function readCache(file) {
    const m = new Map()
    if (!existsSync(file)) return m
    for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue
        try { const r = JSON.parse(line); m.set(r.k, r) } catch {}
    }
    return m
}
export const appendCache = (file, rec) => appendFileSync(file, JSON.stringify(rec) + "\n")
