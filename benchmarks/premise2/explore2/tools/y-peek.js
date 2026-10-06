// Worker y: j2 and m2 flips vs x1 with the first YES's token logprob and route (offline).
//   node benchmarks/premise2/explore2/tools/y-peek.js
import { openAll, byKey } from "./y-lib.js"
const { graded, bearing } = await openAll()
for (const set of ["S300-2", "S300-1"]) {
    const X = byKey(graded, "x1@1+cold", [set]), M = byKey(graded, "m2@1+cold", [set]), J = byKey(graded, "j2@1+cold", [set])
    for (const [id, V] of [["j2", J], ["m2", M]]) for (const [k, v] of V) {
        const x = X.get(k)
        if (!x || v.correct === x.correct) continue
        const yes1 = (x.answer.log ?? []).find((l) => l.act === "check" && l.yes)
        const ab = yes1 ? bearing(x.record)(yes1.path) : null
        console.log(`${set} ${id} ${v.correct > x.correct ? "WIN " : "LOSS"} ${x.record.stratum} x1:${x.answer.step} ${id}:${v.answer.step} yesLp1=${yes1?.yesLp} yes1AB=${ab} singleMean=${v.answer.j?.singleMean ?? ""} rec=${v.answer.recovered ? bearing(x.record)(v.answer.recovered) : ""}`)
    }
}
process.exit(0)
