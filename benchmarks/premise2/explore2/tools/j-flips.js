// Worker j: verdict flips of a j variant vs x1 (and vs gates) by j's step and stratum;
// same-text rate on non-handover paths; SHOW=1 prints the changed handover cases.
//   node benchmarks/premise2/explore2/tools/j-flips.js S300-2 j1
import { pool, loadTable, same } from "./n-lib.js"
const [setName, id, base = "x1"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, [id, base, "gates"])
const agg = new Map()
for (const key of keys) {
    const r = pool.byKey.get(key)
    const j = table.get(id).get(key), x = table.get(base).get(key)
    const step = j.a.step
    const k = `${r.stratum} ${step}`
    const s = agg.get(k) ?? { n: 0, j: 0, x: 0, plus: 0, minus: 0, sameText: 0, xStepSame: 0, ungraded: 0 }
    s.n++; s.j += j.correct ?? 0; s.x += x.correct ?? 0
    if (j.correct === null || x.correct === null) s.ungraded++
    if (j.correct === 1 && x.correct === 0) s.plus++
    if (j.correct === 0 && x.correct === 1) s.minus++
    if (same(j.answer, x.answer)) s.sameText++
    if (x.a.step === step || (step === "commit-single" && x.a.step === "commit-g5")) s.xStepSame++
    agg.set(k, s)
    if (process.env.SHOW && j.correct !== x.correct && step.startsWith("commit-")) console.log(`[${k}] j=${j.correct} x1=${x.correct} singleLp=${j.a.j?.singleMean}\n  Q: ${r.question}\n  G: ${r.gold}\n  J: ${j.answer}\n  X: ${x.answer}`)
}
console.log(`${setName} ${id} vs ${base}: stratum step | n | ${id} right | ${base} right | +/- | same text | ${base} on same step`)
for (const [k, s] of [...agg].sort()) console.log(`${k} | ${s.n} | ${s.j} | ${s.x} | +${s.plus}/-${s.minus} | ${s.sameText} | ${s.xStepSame}${s.ungraded ? ` | ungraded ${s.ungraded}` : ""}`)
