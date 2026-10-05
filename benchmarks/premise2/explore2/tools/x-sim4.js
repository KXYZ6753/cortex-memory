// Worker x: approximate x4 (= x1 with p3's first context) offline: x1 where p3's context equals gates',
// x2 where p3 swapped (handover on swapped unsure commits not modelled).
import { openAll, weightedOf } from "./a-lib.js"
const { graded, missShare } = await openAll()
for (const set of ["S300-2", "S300-1"]) {
    const L = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const X1 = L("x1@1+cold"), X2 = L("x2@1+cold"), G = L("gates@1+cold"), P = L("p3@1+cold"), K = L("k3@1+cold")
    const rows = [...X1.keys()].map((k) => {
        const sw = JSON.stringify(P.get(k).answer.contextPaths) !== JSON.stringify(G.get(k).answer.contextPaths)
        return { record: X1.get(k).record, sw, x1: X1.get(k).correct, x2: X2.get(k).correct, g: G.get(k).correct, k3: K.get(k).correct }
    })
    const W = (f) => 100 * weightedOf(rows.map((r) => ({ record: r.record, correct: f(r) })), missShare).weighted
    const g = W((r) => r.g)
    console.log(set, `gates ${g.toFixed(1)} k3 ${(W((r) => r.k3) - g).toFixed(1)} x1 ${(W((r) => r.x1) - g).toFixed(1)} x2 ${(W((r) => r.x2) - g).toFixed(1)} x4~ ${(W((r) => (r.sw ? r.x2 : r.x1)) - g).toFixed(1)} (swapped ${rows.filter((r) => r.sw).length})`)
}
process.exit(0)
