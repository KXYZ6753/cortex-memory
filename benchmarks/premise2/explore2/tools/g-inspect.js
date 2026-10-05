// Worker g: behaviour + accuracy summary of a g-agent variant on a set, paired with gates.
//   node benchmarks/premise2/explore2/tools/g-inspect.js S300-2 g2@1+cold [show=N] [ref=gates@1+cold]
import { openAll, weightedOf } from "./a-lib.js"

const [setName = "S300-2", vv = "g2@1+cold", showArg = "0", ref = "gates@1+cold"] = process.argv.slice(2)
const show = Number(showArg)
const { graded, emails, bearing, missShare } = await openAll()
const items = graded(vv, setName)
const refMap = new Map(graded(ref, setName).map((i) => [i.record.questionKey, i]))
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}% (${a}/${b})` : "-")
const gradedItems = items.filter((i) => i.correct !== null)
console.log(`${vv} on ${setName}: n=${items.length}, graded=${gradedItems.length}`)
if (gradedItems.length) {
    const w = weightedOf(gradedItems, missShare)
    console.log(`weighted ${(100 * w.weighted).toFixed(1)}  miss ${(100 * w.miss).toFixed(1)} (n${w.nMiss})  hit ${(100 * w.hit).toFixed(1)} (n${w.nHit})`)
    const paired = gradedItems.filter((i) => refMap.get(i.record.questionKey)?.correct != null)
    const rw = weightedOf(paired.map((i) => refMap.get(i.record.questionKey)), missShare)
    console.log(`ref ${ref} on same items: weighted ${(100 * rw.weighted).toFixed(1)} miss ${(100 * rw.miss).toFixed(1)} hit ${(100 * rw.hit).toFixed(1)}`)
    for (const st of ["miss", "hit"]) {
        const p = paired.filter((i) => i.record.stratum === st)
        const gain = p.filter((i) => i.correct && !refMap.get(i.record.questionKey).correct).length
        const loss = p.filter((i) => !i.correct && refMap.get(i.record.questionKey).correct).length
        const same = p.filter((i) => i.answer.answer === refMap.get(i.record.questionKey).answer.answer).length
        console.log(`  ${st}: gained ${gain}, lost ${loss}, identical answer text ${same}/${p.length}`)
    }
}
const a = items.map((i) => i.answer)
const mean = (f) => (a.reduce((s, x) => s + (f(x) ?? 0), 0) / Math.max(1, a.length)).toFixed(2)
console.log(`wall ${mean((x) => x.wallMs)} ms, calls ${mean((x) => x.calls)}, searches(model) ${mean((x) => x.nSearch)}, read calls ${mean((x) => x.nRead)}`)
const firstAct = {}
for (const x of a) { const f = (x.actions ?? []).find((y) => !y.auto)?.name ?? "none"; firstAct[f] = (firstAct[f] ?? 0) + 1 }
console.log("first model action:", JSON.stringify(firstAct))
const errs = a.filter((x) => (x.actions ?? []).some((y) => y.name === "error")).length
console.log(`errors ${errs}, statuses ${JSON.stringify(a.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {}))}`)
for (const st of ["miss", "hit"]) {
    const s = items.filter((i) => i.record.stratum === st)
    const shown = s.filter((i) => i.answer.goldShown), full = s.filter((i) => i.answer.goldFull), fin = s.filter((i) => i.answer.goldInFinal)
    const bearingFinal = s.filter((i) => (i.answer.readPaths ?? []).some(bearing(i.record))).length
    const previewOnly = s.filter((i) => i.answer.goldShown && !(i.answer.actions ?? []).length).length
    const readWhenPreview = s.filter((i) => i.answer.goldShown).filter((i) => (i.answer.explicitReads ?? []).includes(i.record.path))
    console.log(`${st}: gold shown ${pct(shown.length, s.length)}, gold in full ${pct(full.length, s.length)}, gold in final ${pct(fin.length, s.length)}, answer-bearing in final ${pct(bearingFinal, s.length)}, explicit read of gold ${readWhenPreview.length}, extra steps ${pct(s.filter((i) => (i.answer.nSearch ?? 0) + (i.answer.nRead ?? 0) > 0).length, s.length)}`)
}
let shownCount = 0
for (const i of items) {
    if (shownCount >= show) break
    shownCount++
    const x = i.answer
    const r = refMap.get(i.record.questionKey)
    console.log(`\n--- ${i.record.stratum} ${i.record.questionKey} correct=${i.correct} ref=${r?.correct} goldFull=${x.goldFull} goldFinal=${x.goldInFinal}\nQ: ${i.record.question}\nGOLD: ${i.record.gold}`)
    for (const act of x.actions ?? []) console.log(`  > ${act.name}${act.auto ? " (auto)" : ""} ${JSON.stringify(act.args ?? {}).slice(0, 200)}${act.error ? ` ERR ${act.error}` : ""}`)
    console.log(`  A: ${String(x.answer).slice(0, 200)}`)
    if (r && r.answer.answer !== x.answer) console.log(`  REF: ${String(r.answer.answer).slice(0, 200)}`)
}
emails.close()
