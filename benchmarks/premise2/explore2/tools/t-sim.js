// Worker t: offline routing simulations on top of stored x1 answers (overstates gains when
// the substituted answers come from another call sequence; see x.md).
//   node benchmarks/premise2/explore2/tools/t-sim.js S300-2
import { openAll, weightedOf } from "./a-lib.js"
import { verdictOf } from "./n-lib.js"
const { graded, missShare, pool } = await openAll()
const [set] = process.argv.slice(2)
const x1 = graded("x1@1+cold", set)
const tbl = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
const subs = ["gates@1+cold", "k3@1+cold", "g5@1+cold", "r5@1+cold", "p3@1+cold", "s1@1+cold", "o4@1+cold", "n-g5@1+cold", "w7@1+cold", "s3@1+cold"]
const T = Object.fromEntries(subs.map((v) => [v, tbl(v)]))
const W = (items) => { const w = weightedOf(items.map((i) => ({ ...i, correct: i.v })), missShare); return `${(100 * w.weighted).toFixed(1)} (miss ${(100 * w.miss).toFixed(0)} hit ${(100 * w.hit).toFixed(1)})` }
const base = x1.map((i) => ({ record: i.record, v: i.correct }))
console.log(`${set} x1 ${W(base)}`)
// handover substitutes: commit-g5 questions take V's verdict
for (const v of ["gatesAnswer", ...subs]) {
    let flips = { hit: [0, 0], miss: [0, 0] }, missing = 0
    const items = x1.map((i) => {
        if (i.answer.step !== "commit-g5") return { record: i.record, v: i.correct }
        let c
        if (v === "gatesAnswer") c = verdictOf(i.record, i.answer.gatesAnswer)
        else c = T[v].get(i.record.questionKey)?.correct ?? null
        if (c == null) { missing++; c = i.correct }
        if (c !== i.correct) flips[i.record.stratum][c ? 0 : 1]++
        return { record: i.record, v: c }
    })
    console.log(`handover=${v.padEnd(14)} ${W(items)} flips vs x1 hit +${flips.hit[0]}/-${flips.hit[1]} miss +${flips.miss[0]}/-${flips.miss[1]}${missing ? ` missing ${missing}` : ""}`)
}
process.exit(0)
