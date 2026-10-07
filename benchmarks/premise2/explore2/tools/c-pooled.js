// Worker c: pooled paired Δ (design-weighted J1) over several (set, variant, base) triples
// whose variant ids differ by set (config slots), with a stratified bootstrap CI.
//   node benchmarks/premise2/explore2/tools/c-pooled.js S300-2:c-fin1@1+cold:x1@1+cold S300-3:...
import { openAll } from "./a-lib.js"
const { graded, missShare } = await openAll()
const pairs = []
for (const arg of process.argv.slice(2)) {
    const [set, v, b] = arg.split(":")
    const base = new Map(graded(b, set).map((i) => [i.record.questionKey, i]))
    for (const i of graded(v, set)) {
        const j = base.get(i.record.questionKey)
        if (i.correct == null || j?.correct == null) continue
        pairs.push({ stratum: i.record.stratum, d: i.correct - j.correct, v: i.correct, b: j.correct })
    }
}
const m = pairs.filter((p) => p.stratum === "miss"), h = pairs.filter((p) => p.stratum === "hit")
const mean = (l, f) => l.reduce((s, x) => s + f(x), 0) / l.length
const W = (f) => 100 * (missShare * mean(m, f) + (1 - missShare) * mean(h, f))
let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const draws = []
for (let b = 0; b < 4000; b++) {
    let sm = 0, sh = 0
    for (let i = 0; i < m.length; i++) sm += m[Math.floor(rnd() * m.length)].d
    for (let i = 0; i < h.length; i++) sh += h[Math.floor(rnd() * h.length)].d
    draws.push(100 * (missShare * sm / m.length + (1 - missShare) * sh / h.length))
}
draws.sort((a, b) => a - b)
const fl = (l) => `+${l.filter((p) => p.d > 0).length}/−${l.filter((p) => p.d < 0).length}`
console.log(`${pairs.length} paired questions (${h.length} hits, ${m.length} misses)`)
console.log(`variant W ${W((p) => p.v).toFixed(1)} (hit ${(100 * mean(h, (p) => p.v)).toFixed(1)}, miss ${(100 * mean(m, (p) => p.v)).toFixed(1)}) | base W ${W((p) => p.b).toFixed(1)}`)
console.log(`Δ ${W((p) => p.d) >= 0 ? "+" : ""}${W((p) => p.d).toFixed(2)} [${draws[100].toFixed(2)}, ${draws[3899].toFixed(2)}] | flips hits ${fl(h)}, misses ${fl(m)}`)
process.exit(0)
