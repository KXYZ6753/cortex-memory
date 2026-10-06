// Worker t: run-to-run reproduction between two runs of the same code (or any two variants):
// identical answer texts, identical routing (step), verdict flips per step and stratum.
//   node benchmarks/premise2/explore2/tools/t-repro.js S300-2 x1@1+cold t-x1r@1+cold
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const [set, a, b] = process.argv.slice(2)
const B = new Map(graded(b, set).map((i) => [i.record.questionKey, i]))
const by = {}
let same = 0, sameStep = 0, n = 0, samePaths = 0
for (const i of graded(a, set)) {
    const j = B.get(i.record.questionKey); if (!j) continue
    n++
    const st = `${i.answer.step ?? "-"}${i.answer.step === j.answer.step ? "" : `→${j.answer.step}`}`
    by[st] ??= { n: 0, text: 0, hit: [0, 0], miss: [0, 0] }
    const t = by[st]; t.n++
    if (i.answer.answer === j.answer.answer) { same++; t.text++ }
    if (i.answer.step === j.answer.step) sameStep++
    if (JSON.stringify(i.answer.readPaths) === JSON.stringify(j.answer.readPaths)) samePaths++
    if (i.correct !== j.correct && i.correct != null && j.correct != null) t[i.record.stratum][j.correct ? 0 : 1]++
}
console.log(`${set} ${a} vs ${b}: n ${n}, identical text ${same}, same step ${sameStep}, same final context ${samePaths}`)
for (const [k, t] of Object.entries(by).sort()) console.log(`  ${k.padEnd(20)} n ${t.n} text= ${t.text} | ${b} vs ${a}: hit +${t.hit[0]}/-${t.hit[1]} miss +${t.miss[0]}/-${t.miss[1]}`)
process.exit(0)
