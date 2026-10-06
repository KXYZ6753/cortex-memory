// Worker y: the recover-single questions (single read of the accepted email E kept):
// y vs m2 vs x1 verdicts, E answer-bearing, single-read mean logprob.
//   node benchmarks/premise2/explore2/tools/y-recsingle.js y1
import { openAll, byKey } from "./y-lib.js"
const { graded, bearing } = await openAll()
const id = process.argv[2] ?? "y1"
for (const set of ["S300-2", "S300-1"]) {
    const Y = byKey(graded, `${id}@1+cold`, [set]), M = byKey(graded, "m2@1+cold", [set]), X = byKey(graded, "x1@1+cold", [set])
    for (const [k, y] of Y) {
        if (!(y.answer.step ?? "").startsWith("recover")) continue
        const m = M.get(k), x = X.get(k)
        console.log(`${set} ${y.record.stratum} ${y.answer.step.padEnd(14)} y=${y.correct} m2=${m?.correct} (m2 step ${m?.answer.step}) x1=${x?.correct} E_AB=${bearing(y.record)(y.answer.y.recovered)} singleLp=${y.answer.j?.singleMean ?? ""}`)
    }
}
process.exit(0)
