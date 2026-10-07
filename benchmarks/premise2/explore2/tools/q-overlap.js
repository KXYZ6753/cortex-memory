// Worker q: the overlap of m2 and d8 on dev sets (no GPU). On commits where m2 accepted a
// recovery email E (m2 step recover-*), compare m2's verdict with d8r's (seeded g5 on unsure
// commits; x1's sure answer otherwise) and x1's. Sets: S300-1, S300-2 (where m2 ran).
//   node benchmarks/premise2/explore2/tools/q-overlap.js
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const tab = {}
for (const s of ["S300-1", "S300-2"]) {
    const X = new Map(graded("x1@1+cold", s).map((i) => [i.record.questionKey, i]))
    const D = new Map(graded("d8r@1+cold", s).map((i) => [i.record.questionKey, i]))
    for (const m of graded("m2@1+cold", s)) {
        const step = String(m.answer.step ?? "")
        if (!step.startsWith("recover")) continue
        const x = X.get(m.record.questionKey), d = D.get(m.record.questionKey)
        const k = `${m.record.stratum} ${step}`
        const t = (tab[k] ??= { n: 0, m2: 0, d8: 0, x1: 0 })
        t.n++; t.m2 += m.correct ?? 0; t.d8 += d?.correct ?? 0; t.x1 += x?.correct ?? 0
    }
}
console.log("m2 recovery questions (S300-1 + S300-2): correct counts m2 / d8r / x1")
for (const [k, t] of Object.entries(tab).sort()) console.log(`  ${k}: n ${t.n}: m2 ${t.m2}, d8r ${t.d8}, x1 ${t.x1}`)
process.exit(0)
