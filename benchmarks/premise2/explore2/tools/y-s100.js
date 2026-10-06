// Worker y: out-of-sample replicate on S100 sets (x1 and y1 run side by side): per set and
// pooled Δ vs x1 (paired stratified bootstrap), flips by route, same-text rate on unchanged paths.
//   node benchmarks/premise2/explore2/tools/y-s100.js S100-4,S100-5 [y1]
import { openAll, weightedOf, bootstrap, fmtCi, byKey, route } from "./y-lib.js"
const { graded, missShare } = await openAll()
const sets = (process.argv[2] ?? "S100-4,S100-5").split(",")
const id = process.argv[3] ?? "y1"
for (const g of [...sets.map((s) => [s]), ...(sets.length > 1 ? [sets] : [])]) {
    const X = byKey(graded, "x1@1+cold", g), Y = byKey(graded, `${id}@1+cold`, g)
    const pairs = [], flips = new Map()
    for (const [k, y] of Y) {
        const x = X.get(k)
        if (!x || x.correct == null || y.correct == null) continue
        pairs.push({ stratum: y.record.stratum, d: y.correct - x.correct })
        const r = route(y.answer)
        const c = flips.get(r) ?? { n: 0, hp: 0, hm: 0, mp: 0, mm: 0, same: 0 }
        c.n++; if (y.answer.answer === x.answer.answer) c.same++
        const hit = y.record.stratum === "hit"
        if (y.correct > x.correct) hit ? c.hp++ : c.mp++
        if (y.correct < x.correct) hit ? c.hm++ : c.mm++
        flips.set(r, c)
    }
    const wy = weightedOf([...Y.values()].filter((i) => i.correct != null), missShare), wx = weightedOf([...X.values()].filter((i) => i.correct != null), missShare)
    const mean = (l) => l.reduce((s, v) => s + v, 0) / l.length
    console.log(`\n${g.join("+")}: n ${pairs.length} (miss ${wy.nMiss}, hit ${wy.nHit}) | ${id} W ${(100 * wy.weighted).toFixed(1)} miss ${(100 * wy.miss).toFixed(1)} hit ${(100 * wy.hit).toFixed(1)} wall ${Math.round(mean([...Y.values()].map((i) => i.answer.wallMs)))} calls ${mean([...Y.values()].map((i) => i.answer.calls)).toFixed(2)} | x1 W ${(100 * wx.weighted).toFixed(1)} miss ${(100 * wx.miss).toFixed(1)} hit ${(100 * wx.hit).toFixed(1)} wall ${Math.round(mean([...X.values()].map((i) => i.answer.wallMs)))} | Δ ${fmtCi(bootstrap(pairs, missShare))}`)
    for (const [r, c] of [...flips].sort()) console.log(`  ${r.padEnd(22)} n ${String(c.n).padStart(3)} hits +${c.hp}/-${c.hm} misses +${c.mp}/-${c.mm} sameText ${c.same}`)
}
process.exit(0)
