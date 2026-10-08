// Worker n6: shared offline helpers (no GPU): verdict lookup for arbitrary answer texts from
// the shared verdicts.jsonl, paired bootstraps (question and mailbox-cluster, mulberry32,
// B = 10,000) for a hit-point Δ, flip counts.
import { judgeConfig, preGrade } from "../../judge.js"
import { verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"
import { openAll, dataDir } from "./a-lib.js"

export async function openN6() {
    const base = await openAll()
    const V = verdictIndex(dataDir), J = judgeConfig("j1")
    // 1 / 0, or null if the text was never graded
    const verdictOf = (text, record, status = "ok") => {
        if (preGrade({ answer: text ?? "", status })) return 0
        const v = V.get(answerVerdictKey({ answer: text }, record, J))
        return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
    }
    return { ...base, verdictOf }
}

// pairs: [{ user, d }] with d in {-1, 0, 1} (variant minus reference, hits only).
// Returns Δ in hit points with the question bootstrap and the mailbox-cluster bootstrap 95% CIs.
export function hitDelta(pairs, { B = BOOT_B, seed = 6006 } = {}) {
    const n = pairs.length
    const plus = pairs.filter((p) => p.d > 0).length, minus = pairs.filter((p) => p.d < 0).length
    const delta = (100 * (plus - minus)) / n
    const r = mulberry32(seed)
    const q = []
    for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += pairs[Math.floor(r() * n)].d; q.push((100 * s) / n) }
    q.sort((a, b) => a - b)
    const byUser = new Map()
    for (const p of pairs) { if (!byUser.has(p.user)) byUser.set(p.user, []); byUser.get(p.user).push(p.d) }
    const users = [...byUser.values()]
    const r2 = mulberry32(seed + 1)
    const c = []
    for (let b = 0; b < B; b++) {
        let s = 0, m = 0
        for (let i = 0; i < users.length; i++) { const u = users[Math.floor(r2() * users.length)]; for (const d of u) s += d; m += u.length }
        c.push((100 * s) / m)
    }
    c.sort((a, b) => a - b)
    return { n, plus, minus, delta, q: [pctSorted(q, 0.025), pctSorted(q, 0.975)], cl: [pctSorted(c, 0.025), pctSorted(c, 0.975)] }
}
export const fmtD = (h) => `${h.delta >= 0 ? "+" : ""}${h.delta.toFixed(2)} [${h.q[0].toFixed(2)}, ${h.q[1].toFixed(2)}] cl [${h.cl[0].toFixed(2)}, ${h.cl[1].toFixed(2)}] (+${h.plus}/-${h.minus}, n ${h.n})`
