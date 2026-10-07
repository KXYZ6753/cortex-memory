// Worker u: gold-only reading errors (stored `oracles` answers, FULL-0 dev) next to gates'.
//   node benchmarks/premise2/explore2/tools/u-oracle.js [set] [variant@version] [--all]
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const [set = "FULL-0", v = "oracles@1+cold"] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const all = process.argv.includes("--all")
const items = graded(v, set).filter((i) => i.record.stratum === "hit")
const gates = new Map(graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
let n = 0, wrong = 0
for (const i of items) {
    if (i.correct == null) continue
    n++
    if (i.correct) continue
    wrong++
    if (!all && wrong > 60) continue
    const g = gates.get(i.record.questionKey)
    console.log(`--- ${i.record.questionKey}\nQ: ${i.record.question}\nGOLD: ${i.record.gold}${i.record.alternates?.length ? ` | ALT: ${i.record.alternates.join(" | ")}` : ""}\nORACLE: ${i.answer.answer.slice(0, 300)}\nGATES(${g?.correct}): ${(g?.answer.answer ?? "").slice(0, 200)}`)
}
console.log(`\n${v} ${set} hits: ${n - wrong}/${n} right (${(100 * (n - wrong) / n).toFixed(1)})`)
process.exit(0)
