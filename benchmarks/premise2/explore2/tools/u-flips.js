// Worker u: paired flips between two variants on one or more sets, by stratum and by the
// reference's path (x1 step when present), plus identical-text counts.
//   node benchmarks/premise2/explore2/tools/u-flips.js S300-2[+S300-1] a@v b@v [--show]
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const show = process.argv.includes("--show")
const [sets, A, B] = args
const by = (v) => new Map(sets.split("+").flatMap((s) => graded(v, s)).map((i) => [i.record.questionKey, i]))
const a = by(A), b = by(B)
const rows = {}
let same = 0, n = 0
const shown = []
for (const [k, x] of a) {
    const y = b.get(k)
    if (!y || x.correct == null || y.correct == null) continue
    n++
    if (x.answer.answer === y.answer.answer) same++
    const path = `${x.record.stratum} ${y.answer.step ?? x.answer.step ?? "-"}`
    const r = (rows[path] ??= { n: 0, a: 0, b: 0, plus: 0, minus: 0, sameText: 0 })
    r.n++; r.a += x.correct; r.b += y.correct
    if (x.answer.answer === y.answer.answer) r.sameText++
    if (y.correct > x.correct) r.plus++
    if (y.correct < x.correct) r.minus++
    if (show && y.correct !== x.correct) shown.push(`${y.correct > x.correct ? "+" : "-"} [${path}] ${k}\n  Q: ${x.record.question}\n  GOLD: ${x.record.gold}\n  A: ${x.answer.answer.slice(0, 250)}\n  B: ${y.answer.answer.slice(0, 250)}`)
}
console.log(`${sets}: ${A} -> ${B}, n ${n}, identical texts ${same}`)
for (const [p, r] of Object.entries(rows).sort()) console.log(`${p.padEnd(24)} n ${String(r.n).padStart(4)}  A ${r.a}  B ${r.b}  +${r.plus}/-${r.minus}  sameText ${r.sameText}`)
const tot = (s) => Object.entries(rows).filter(([p]) => p.startsWith(s)).reduce((t, [, r]) => ({ n: t.n + r.n, a: t.a + r.a, b: t.b + r.b, plus: t.plus + r.plus, minus: t.minus + r.minus }), { n: 0, a: 0, b: 0, plus: 0, minus: 0 })
for (const s of ["hit", "miss"]) { const t = tot(s); if (t.n) console.log(`${s.padEnd(5)} all: n ${t.n}  A ${(100 * t.a / t.n).toFixed(1)}  B ${(100 * t.b / t.n).toFixed(1)}  +${t.plus}/-${t.minus}`) }
if (show) console.log(shown.join("\n"))
process.exit(0)
