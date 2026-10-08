// Worker n6: verdict flips of a single-config n6 variant vs its det parent (offline, no GPU):
// question, reference, parent answer, variant answer, greedy mean logprob, branches.
//   node benchmarks/premise2/explore2/tools/n6-dump2.js <variant@ver> <set,set> [parent@ver]
import { openN6 } from "./n6-lib.js"
const [v, setsArg, parent = "i-det-gates@2+cold"] = process.argv.slice(2)
const { graded } = await openN6()
let plus = 0, minus = 0
for (const s of setsArg.split(",")) {
    const P = new Map(graded(parent, s).map((i) => [i.record.questionKey, i]))
    for (const i of graded(v, s)) {
        const p = P.get(i.record.questionKey)
        if (i.record.stratum !== "hit" || !p || i.correct == null || p.correct == null || i.correct === p.correct) continue
        i.correct > p.correct ? plus++ : minus++
        const inf = i.answer.n6?.info?.at(-1) ?? {}
        console.log(`${i.correct > p.correct ? "+FIXED" : "-BROKE"} ${s} ${i.record.questionKey} mean ${inf.mean} branches ${inf.branches} ${JSON.stringify((inf.changes ?? []).map((c) => [c.at, c.from, c.to]))}\n  Q: ${i.record.question}\n  REF: ${i.record.gold}\n  parent: ${p.answer.answer.slice(0, 300)}\n  variant: ${i.answer.answer.slice(0, 300)}`)
    }
}
console.log(`\n+${plus} / -${minus}`)
process.exit(0)
