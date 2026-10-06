// Worker m: verdict flips of an m-variant vs x1 by step and stratum; identical-text rate.
//   node benchmarks/premise2/explore2/tools/m-flips.js S300-2 m1 [base=x1]
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const [set, v, base = "x1"] = process.argv.slice(2)
const B = new Map(graded(`${base}@1+cold`, set).map((i) => [i.record.questionKey, i]))
const t = {}
for (const it of graded(`${v}@1+cold`, set)) {
    const b = B.get(it.record.questionKey)
    const k = `${it.record.stratum} ${it.answer.step}`
    const c = (t[k] ??= { n: 0, same: 0, win: 0, loss: 0, ok: 0, abRec: 0 })
    c.n++; c.ok += it.correct
    if (it.answer.answer === b.answer.answer) c.same++
    if (it.correct > b.correct) c.win++
    if (it.correct < b.correct) c.loss++
    const E = it.answer.recovered ?? (it.answer.step === "found-x" ? it.answer.foundPath : null)
    if (E && bearing(it.record)(E)) c.abRec++
}
for (const [k, c] of Object.entries(t).sort()) console.log(`${k.padEnd(22)} n ${String(c.n).padStart(3)} ok ${String(c.ok).padStart(3)} sameText ${String(c.same).padStart(3)}  +${c.win}/-${c.loss}  recoveredAB ${c.abRec}`)
process.exit(0)
