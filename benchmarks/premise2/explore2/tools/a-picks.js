// Offline (no judge): for agent answers (a2/a3) or a1, was the email read alone
// answer-bearing? Per stratum, plus steps.   node .../a-picks.js a2@1+cold S300-2
import { openAll } from "./a-lib.js"
const [target, setName = "S300-2"] = process.argv.slice(2)
const { graded, bearing, emails } = await openAll()
const items = graded(target, setName)
const steps = {}
for (const i of items) {
    const isB = bearing(i.record)
    const read = i.answer.rereadPath ? [i.answer.rereadPath] : i.answer.readPaths ?? []
    const k = `${i.record.stratum} ${i.answer.step} readBearing=${read.some(isB)} shownBearing=${(i.answer.shownPaths ?? i.answer.contextPaths ?? []).some(isB)}`
    steps[k] ??= { n: 0, correct: 0, graded: 0 }
    steps[k].n++
    if (i.correct !== null) { steps[k].graded++; steps[k].correct += i.correct }
}
console.log(target, setName, items.length, "answers; mean wall", Math.round(items.reduce((s, i) => s + i.answer.wallMs, 0) / items.length), "calls", (items.reduce((s, i) => s + i.answer.calls, 0) / items.length).toFixed(2))
for (const [k, v] of Object.entries(steps).sort()) console.log(`  ${k}: ${v.n}${v.graded ? ` (correct ${v.correct}/${v.graded})` : ""}`)
if (process.argv.includes("--picks")) for (const i of items.slice(0, 20)) console.log(JSON.stringify(i.answer.picks), i.answer.step)
emails.close()
