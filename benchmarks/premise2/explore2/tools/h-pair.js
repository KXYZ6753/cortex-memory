// Offline: paired outcome of an h variant vs a reference by escalation step and stratum,
// plus hit-prompt changes (questions whose final answer did not come from the ref's prompt).
//   node benchmarks/premise2/explore2/tools/h-pair.js S300-2 h4@1+cold r4@1+cold
import { openH } from "./h-common.js"
const [set, v, ref] = process.argv.slice(2)
const env = await openH()
const R = new Map(env.graded(ref, set).map((i) => [i.record.questionKey, i]))
const t = {}
let wall = 0, calls = 0, n = 0
for (const i of env.graded(v, set)) {
    const r = R.get(i.record.questionKey)
    if (!r || i.correct === null || r.correct === null) continue
    n++; wall += i.answer.wallMs; calls += i.answer.calls
    const k = `${i.record.stratum} ${i.answer.step}`
    t[k] ??= { n: 0, both: 0, varOnly: 0, refOnly: 0, sameText: 0 }
    t[k].n++
    if (i.correct && r.correct) t[k].both++
    if (i.correct && !r.correct) t[k].varOnly++
    if (!i.correct && r.correct) t[k].refOnly++
    if (i.answer.answer === r.answer.answer) t[k].sameText++
}
console.table(t)
console.log({ n, wall: Math.round(wall / n), calls: +(calls / n).toFixed(2) })
