// Worker k: offline "confidence-gated agent" (n's logprob gate, stored n-g5 answers):
// confident gates answers kept (n-g5's own answer on step "gates"), otherwise the k
// agent's stored answer. node benchmarks/premise2/explore2/tools/k-gated.js
import { openAll, weightedOf } from "./a-lib.js"
const { graded, missShare } = await openAll()
const fmt = (s) => `${(100 * s.weighted).toFixed(1)} (miss ${(100 * s.miss).toFixed(1)}, hit ${(100 * s.hit).toFixed(1)})`
for (const set of ["S300-2", "S300-1"]) {
    const g = new Map(graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
    const n = new Map(graded("n-g5@1+cold", set).map((i) => [i.record.questionKey, i]))
    if (!n.size) { console.log(set, "no n-g5"); continue }
    const base = weightedOf([...g.values()], missShare)
    console.log(`${set}: gates ${fmt(base)}; n-g5 ${fmt(weightedOf([...n.values()], missShare))}; unsure ${[...n.values()].filter((i) => i.answer.unsure).length}/${n.size}`)
    for (const v of ["k1@1+cold", "k3@1+cold"]) {
        const k = new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
        if (!k.size) continue
        const items = [...n.values()].map((ni) => ({ record: ni.record, correct: ni.answer.unsure ? k.get(ni.record.questionKey).correct : ni.correct }))
        const s = weightedOf(items, missShare)
        console.log(`  gated ${v}: ${fmt(s)}  Δ vs gates ${(100 * (s.weighted - base.weighted)).toFixed(1)}; ungated ${fmt(weightedOf([...k.values()], missShare))}`)
    }
}
process.exit(0)
