// Worker q: alternative uncertainty for a det-paired Δ (no GPU). Behind det every concordant
// pair is byte-identical, so the information is in the discordant pairs. Prints, pooled over the
// given sets: discordant counts per stratum, the weighted Δ with (a) explore/analyze.js's
// mailbox-cluster paired bootstrap (as cli2 report), (b) a stratified question bootstrap (as
// y-lib.js / t-ladder.js, with a 32-bit RNG), and (c) an exact-style sign-flip randomisation test of the weighted Δ
// (H0: within each pair the two arms are exchangeable; 200,000 draws).
//   node benchmarks/premise2/explore2/tools/q-stats.js <set,set> [variant@ver] [ref@ver]
import { openAll } from "./a-lib.js"
import { pairedBootstrap } from "../../explore/analyze.js"
const [setsArg, v = "q-det-q1@1+cold", ref = "i-det-x1@2+cold"] = process.argv.slice(2)
const { graded, missShare } = await openAll()
const pairs = []
for (const s of setsArg.split(",")) {
    const R = new Map(graded(ref, s).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
    for (const it of graded(v, s)) {
        const r = R.get(it.record.questionKey)
        if (!r || it.correct === null) continue
        pairs.push({ user: it.record.user, stratum: it.record.stratum, a: it.correct, b: r.correct, d: it.correct - r.correct })
    }
}
const n = { miss: pairs.filter((p) => p.stratum === "miss").length, hit: pairs.filter((p) => p.stratum === "hit").length }
const disc = (st) => { const l = pairs.filter((p) => p.stratum === st); return [l.filter((p) => p.d > 0).length, l.filter((p) => p.d < 0).length] }
const [mp, mm] = disc("miss"), [hp, hm] = disc("hit")
const w = (dm, dh) => 100 * (missShare * dm / n.miss + (1 - missShare) * dh / n.hit)
const obs = w(mp - mm, hp - hm)
const cl = pairedBootstrap(pairs, missShare)
// mulberry32 (32-bit integer arithmetic; y-lib's LCG multiplies past 2^53 in doubles)
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
function bootstrap(pairs, share, B = 20000) {
    const m = pairs.filter((p) => p.stratum === "miss").map((p) => p.d), h = pairs.filter((p) => p.stratum === "hit").map((p) => p.d)
    const r = mulberry(12345), draws = []
    for (let b = 0; b < B; b++) {
        let sm = 0, sh = 0
        for (let i = 0; i < m.length; i++) sm += m[Math.floor(r() * m.length)]
        for (let i = 0; i < h.length; i++) sh += h[Math.floor(r() * h.length)]
        draws.push(100 * (share * sm / m.length + (1 - share) * sh / h.length))
    }
    draws.sort((x, y) => x - y)
    return { lo: draws[Math.floor(0.025 * B)], hi: draws[Math.floor(0.975 * B)] }
}
// sign-flip randomisation over discordant pairs
const rnd = mulberry(7)
const B = 200000
let extreme = 0
const kM = mp + mm, kH = hp + hm
for (let b = 0; b < B; b++) {
    let sm = 0, sh = 0
    for (let i = 0; i < kM; i++) sm += rnd() < 0.5 ? 1 : -1
    for (let i = 0; i < kH; i++) sh += rnd() < 0.5 ? 1 : -1
    if (Math.abs(w(sm, sh)) >= Math.abs(obs) - 1e-9) extreme++
}
console.log(`${v} vs ${ref} over ${setsArg} (n miss ${n.miss}, hit ${n.hit})`)
console.log(`  discordant: misses +${mp}/−${mm}, hits +${hp}/−${hm}`)
console.log(`  weighted Δ ${obs >= 0 ? "+" : ""}${obs.toFixed(2)}`)
console.log(`  mailbox-cluster bootstrap 95% CI [${(100 * cl.low).toFixed(2)}, ${(100 * cl.high).toFixed(2)}]`)
const st = bootstrap(pairs, missShare)
console.log(`  stratified question bootstrap 95% CI [${st.lo.toFixed(2)}, ${st.hi.toFixed(2)}]`)
console.log(`  sign-flip randomisation, two-sided p = ${(extreme / B).toFixed(4)}`)
process.exit(0)
