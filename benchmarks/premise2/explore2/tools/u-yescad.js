// Worker u: offline check of "read the YES email alone" on x1's commit paths using the
// gold-only harness answers (u-ocad5 = CAD, oracles = plain) where x1's first YES email is
// the gold email (then a single read of the YES email is exactly the gold-only prompt).
//   node benchmarks/premise2/explore2/tools/u-yescad.js S300-2+S300-1+S300-3 [x1@1+cold]
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const [sets, base = "x1@1+cold"] = process.argv.slice(2)
const G = (v) => new Map(sets.split("+").flatMap((s) => graded(v, s)).map((i) => [i.record.questionKey, i]))
const X = G(base), O = G("oracles@1+cold"), C = G("u-ocad5@1+cold")
const t = {}
for (const [k, x] of X) {
    const o = O.get(k), c = C.get(k)
    if (!o || !c || x.correct == null || o.correct == null || c.correct == null) continue
    const yes = (x.answer.log ?? []).find((l) => l.act === "check" && l.yes)?.path
    const yesGold = yes && (yes === x.record.path || (x.record.twins ?? []).includes(yes))
    const key = `${x.record.stratum} ${x.answer.step} ${yesGold ? "YES=gold" : yes ? "YES=other" : "noYES"}`
    const r = (t[key] ??= { n: 0, x: 0, o: 0, c: 0, cPlus: 0, cMinus: 0 })
    r.n++; r.x += x.correct; r.o += o.correct; r.c += c.correct
    if (c.correct > x.correct) r.cPlus++
    if (c.correct < x.correct) r.cMinus++
}
console.log(`${sets}: ${base} vs gold-only oracles / CAD by x1 step`)
for (const [k, r] of Object.entries(t).sort()) console.log(`${k.padEnd(34)} n ${String(r.n).padStart(4)}  x1 ${r.x}  oracles ${r.o}  ocad5 ${r.c}  (ocad5 vs x1 +${r.cPlus}/-${r.cMinus})`)
process.exit(0)
