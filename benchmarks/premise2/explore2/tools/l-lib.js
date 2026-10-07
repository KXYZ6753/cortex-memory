// Worker l (self-verification): shared offline helpers. Candidate pools per question from
// stored answers of every variant on a set (plus x1's internal commit answer and j1/j2's
// single-email re-read when those texts have a J1 verdict), joined with J1 verdicts by
// exact answer text (verdict keys are text-keyed, so a text graded for any variant counts).
import { openAll, weightedOf } from "./a-lib.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"
import { mulberry32, BOOT_B } from "./rng.js"
export { openAll, weightedOf }

export const DEV = ["S300-1", "S300-2", "S300-3", "FULL-1"]
export const norm = (t) => String(t ?? "").trim()

// sets -> Map(questionKey -> { record, set, cands: Map(text -> { text, correct, sources:Set, ctx: {variant: paths} }), by: {variant@ver: answer} })
export async function loadCandidates(sets = DEV, { only = null, exclude = /^(i-|c-gold|cascg)/ } = {}) {
    const env = await openAll()
    const judge = judgeConfig("j1")
    const verdicts = verdictIndex(".data/premise2")
    const answers = latestAnswers(".data/premise2")
    const Q = new Map()
    const verdictOf = (record, text, status = "ok") => {
        const ans = { answer: text, status }
        if (preGrade(ans)) return 0
        const v = verdicts.get(answerVerdictKey(ans, record, judge))
        return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
    }
    for (const a of answers) {
        if (!sets.includes(a.set)) continue
        if (only && !only.includes(a.variant)) continue
        if (!only && exclude && exclude.test(a.variant)) continue
        const record = env.pool.byKey.get(a.questionKey)
        if (!record) continue
        const key = a.questionKey
        if (!Q.has(key)) Q.set(key, { record, set: a.set, cands: new Map(), by: {} })
        const q = Q.get(key)
        const vv = `${a.variant}@${a.version}`
        q.by[vv] = a
        const add = (text, src, paths, status = "ok") => {
            const t = norm(text)
            if (!t && status === "ok") return
            const c = verdictOf(record, text, status)
            if (c === null) return
            if (!q.cands.has(t)) q.cands.set(t, { text: t, correct: c, sources: new Set(), ctx: {} })
            const e = q.cands.get(t)
            e.sources.add(src)
            if (paths?.length && !e.ctx[src]) e.ctx[src] = paths
        }
        add(a.answer, a.variant, a.contextPaths, a.status)
        if (a.variant === "x1" && a.gatesAnswer) add(a.gatesAnswer, "x1.commit", a.log ? undefined : undefined)
        if (a.j?.singleAnswer) add(a.j.singleAnswer, `${a.variant}.single`, a.j.yesPath ? [a.j.yesPath] : undefined)
    }
    return { env, Q, verdictOf }
}

// x1's first YES email (commit check) or explore's found email
export function yesPathOf(x1) {
    if (!x1) return null
    const y = (x1.log ?? []).find((l) => l.act === "check" && l.yes)
    if (["commit", "commit-g5", "commit-single"].includes(x1.step)) return y?.path ?? null
    return x1.foundPath ?? null
}

export function bootstrapPairs(pairs, missShare, B = BOOT_B) {
    const m = pairs.filter((p) => p.stratum === "miss").map((p) => p.d), h = pairs.filter((p) => p.stratum === "hit").map((p) => p.d)
    const mean = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : 0)
    const point = missShare * mean(m) + (1 - missShare) * mean(h)
    const rnd = mulberry32(12345) // was a double-precision LCG with period 10,466 (ci-erratum.md)
    const draws = []
    for (let b = 0; b < B; b++) {
        let sm = 0, sh = 0
        for (let i = 0; i < m.length; i++) sm += m[Math.floor(rnd() * m.length)]
        for (let i = 0; i < h.length; i++) sh += h[Math.floor(rnd() * h.length)]
        draws.push(missShare * (m.length ? sm / m.length : 0) + (1 - missShare) * (h.length ? sh / h.length : 0))
    }
    draws.sort((a, b) => a - b)
    return { point: 100 * point, lo: 100 * draws[Math.floor(0.025 * B)], hi: 100 * draws[Math.floor(0.975 * B)] }
}
export const fmtCi = (ci) => `${ci.point >= 0 ? "+" : ""}${ci.point.toFixed(2)} [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]`

// AUC of scores for label 1 vs 0 (ties count half)
export function auc(items) {
    const pos = items.filter((i) => i.y === 1).map((i) => i.s), neg = items.filter((i) => i.y === 0).map((i) => i.s)
    if (!pos.length || !neg.length) return NaN
    let w = 0
    for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0
    return w / (pos.length * neg.length)
}
