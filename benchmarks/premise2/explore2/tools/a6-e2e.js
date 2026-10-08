// Worker a6: end-to-end a6 variant vs its det parent, pooled over sets: hit (and miss) accuracy,
// paired Δ in hit points with question and mailbox-cluster bootstrap CIs (mulberry32,
// B = 10,000), flips split by fired / not fired, byte identity of unfired answers, wall ms
// (mean, p95) and calls (all / without det resets), for variant and parent.
//   node benchmarks/premise2/explore2/tools/a6-e2e.js <sets> <variant@ver> <parent@ver> [show]
import { loadRuns, pool, bootHits, missShare } from "./a6-lib.js"

const [setsArg = "S300-4,S300-5,FULL-2,FULL-3", V = "a6-g-dec@1+cold", P = "i-det-gates@2+cold", show = ""] = process.argv.slice(2)
const sets = setsArg.split(",")
const runs = loadRuns(sets, [V, P])
const A = runs.get(V), B = runs.get(P)
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] }
const sg = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(2)}`
const out = { hit: [], miss: [] }
const cell = {}
let ungraded = 0
for (const [k, a] of A) {
    const b = B.get(k)
    if (!b) continue
    if (a.correct == null || b.correct == null) { ungraded++; continue }
    const r = pool.byKey.get(k)
    const fired = !!a.a.a6?.fired
    out[r.stratum].push({ a: a.correct, b: b.correct, user: r.user, k, fired, same: a.a.answer === b.a.answer, set: a.set })
}
for (const st of ["hit", "miss"]) {
    const L = out[st]
    if (!L.length) continue
    const bh = bootHits(L)
    console.log(`${st}: n ${L.length} | ${V} ${(100 * mean(L.map((x) => x.a))).toFixed(2)} vs ${P} ${(100 * mean(L.map((x) => x.b))).toFixed(2)} | Δ ${sg(bh.delta)} [${sg(bh.low)}, ${sg(bh.high)}] cluster [${sg(bh.cLow)}, ${sg(bh.cHigh)}] flips +${bh.plus}/−${bh.minus}`)
    for (const f of [true, false]) {
        const l = L.filter((x) => x.fired === f)
        console.log(`   ${f ? "fired " : "unfired"}: n ${l.length}, +${l.filter((x) => x.a > x.b).length}/−${l.filter((x) => x.a < x.b).length}, identical text ${l.filter((x) => x.same).length}/${l.length}`)
    }
    for (const s of sets) { const l = L.filter((x) => x.set === s); if (l.length) console.log(`   ${s}: n ${l.length} Δ ${sg(mean(l.map((x) => x.a - x.b)))} (+${l.filter((x) => x.a > x.b).length}/−${l.filter((x) => x.a < x.b).length})`) }
}
if (out.miss.length && out.hit.length) {
    const w = (key) => missShare * mean(out.miss.map((x) => x[key])) + (1 - missShare) * mean(out.hit.map((x) => x[key]))
    console.log(`weighted: ${(100 * w("a")).toFixed(2)} vs ${(100 * w("b")).toFixed(2)}`)
}
// replays (parentWallMs present): the real variant's cost = the parent's stored wall / calls + the form's
const stat = (M) => { const xs = [...M.values()].map((x) => x.a); const calls = xs.map((a) => a.calls + (a.parentCalls ?? 0)), resets = xs.map((a) => (a.det?.resets ?? 0) + (a.parentResets ?? 0)); const fired = xs.filter((a) => a.a6?.fired); return `fired ${fired.length}/${xs.length}, form wall on fired ${Math.round(mean(fired.map((a) => a.wallMs)))} ms; ` + `wall ${Math.round(mean(xs.map((a) => a.wallMs + (a.parentWallMs ?? 0))))} ms (p95 ${p95(xs.map((a) => a.wallMs + (a.parentWallMs ?? 0)))}), calls ${mean(calls).toFixed(2)} (real ${(mean(calls) - mean(resets)).toFixed(2)})` }
console.log(`${V}: ${stat(A)}\n${P}: ${stat(B)}\nungraded pairs: ${ungraded}`)
if (show) for (const st of ["hit", "miss"]) for (const x of out[st]) if (x.a !== x.b) {
    const r = pool.byKey.get(x.k)
    console.log(`\n[${x.a > x.b ? "+" : "−"} ${st} ${x.fired ? "fired" : "unfired"}] Q: ${r.question}\n  G: ${r.gold}\n  parent: ${B.get(x.k).a.answer.slice(0, 300)}\n  a6: ${A.get(x.k).a.answer.slice(0, 400)}`)
}
