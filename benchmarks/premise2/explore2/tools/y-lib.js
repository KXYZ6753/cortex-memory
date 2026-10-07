// Worker y: shared offline helpers. Graded answers joined by question (a-lib.js openAll),
// paired stratified bootstrap of a weighted Δ (same procedure and seed as t-ladder.js).
import { openAll, weightedOf } from "./a-lib.js"
import { mulberry32, BOOT_B } from "./rng.js"
export { openAll, weightedOf }

export function bootstrap(pairs, missShare, B = BOOT_B) {
    // pairs: [{ stratum, d }], d = variant - reference per question
    const m = pairs.filter((p) => p.stratum === "miss").map((p) => p.d), h = pairs.filter((p) => p.stratum === "hit").map((p) => p.d)
    const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
    const point = missShare * mean(m) + (1 - missShare) * mean(h)
    const rnd = mulberry32(12345) // was a double-precision LCG with period 10,466 (ci-erratum.md)
    const draws = []
    for (let b = 0; b < B; b++) {
        let sm = 0, sh = 0
        for (let i = 0; i < m.length; i++) sm += m[Math.floor(rnd() * m.length)]
        for (let i = 0; i < h.length; i++) sh += h[Math.floor(rnd() * h.length)]
        draws.push(missShare * sm / m.length + (1 - missShare) * sh / h.length)
    }
    draws.sort((a, b) => a - b)
    return { point: 100 * point, lo: 100 * draws[Math.floor(0.025 * B)], hi: 100 * draws[Math.floor(0.975 * B)] }
}

export const fmtCi = (ci) => `${ci.point >= 0 ? "+" : ""}${ci.point.toFixed(2)} [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]`
export const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }

// map questionKey -> graded item for variant@version over sets
export function byKey(graded, vAtVer, sets) {
    const m = new Map()
    for (const s of sets) for (const it of graded(vAtVer, s)) m.set(it.record.questionKey, it)
    return m
}

// y route of an answer (for flips by path)
export function route(a) {
    const s = a.step ?? ""
    if (s === "commit") return "sure commit"
    if (s === "commit-single") return "unsure → re-read"
    if (s === "commit-g5") return "unsure → g5"
    if (s.startsWith("recover")) return `recovery (${s.slice(8)})`
    if (["found", "nofound", "nopick"].includes(s)) return "explore"
    return s || "?"
}
