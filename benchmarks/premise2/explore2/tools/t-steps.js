// Worker t: per-step cost and accuracy of an x1-like variant (step field), plus yesAt and probe counts.
//   node benchmarks/premise2/explore2/tools/t-steps.js S300-2 x1@1+cold [k3@1+cold]
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const [set, v, cmp] = process.argv.slice(2)
const items = graded(v, set)
const other = cmp ? new Map(graded(cmp, set).map((i) => [i.record.questionKey, i])) : null
const groups = new Map()
for (const i of items) {
    const k = `${i.answer.step}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
}
const mean = (l, f) => l.reduce((s, x) => s + f(x), 0) / Math.max(1, l.length)
for (const [k, l] of [...groups].sort()) {
    const hit = l.filter((i) => i.record.stratum === "hit"), miss = l.filter((i) => i.record.stratum === "miss")
    const acc = (s) => `${s.filter((i) => i.correct).length}/${s.length}`
    let cmpS = ""
    if (other) { const o = (s) => s.filter((i) => other.get(i.record.questionKey)?.correct).length; cmpS = ` | ${cmp}: hit ${o(hit)} miss ${o(miss)}` }
    const probes = mean(l, (i) => (i.answer.log ?? []).filter((x) => x.act === "check").length)
    console.log(`${k.padEnd(12)} n ${String(l.length).padStart(3)} | wall ${Math.round(mean(l, (i) => i.answer.wallMs))} | calls ${mean(l, (i) => i.answer.calls).toFixed(2)} | probes ${probes.toFixed(2)} | genMs ${Math.round(mean(l, (i) => i.answer.genMs))} | auxMs ${Math.round(mean(l, (i) => i.answer.auxMs ?? 0))} | hit ${acc(hit)} miss ${acc(miss)}${cmpS}`)
}
const ya = {}
for (const i of items) if (i.answer.yesAt != null) ya[i.answer.yesAt] = (ya[i.answer.yesAt] ?? 0) + 1
console.log("yesAt", ya)
process.exit(0)
