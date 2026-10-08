// Worker n6: do two single-config n6 variants fix / break the same hits? (offline, no GPU)
// Joins both with the det parent per question; prints the 3x3 table of (A − parent, B − parent).
//   node benchmarks/premise2/explore2/tools/n6-overlap.js <A@ver> <B@ver> <set,set> [parent@ver]
import { openN6 } from "./n6-lib.js"
const [A, B, setsArg, parent = "i-det-gates@2+cold"] = process.argv.slice(2)
const { graded } = await openN6()
const t = {}
let sameText = 0, bothChanged = 0
for (const s of setsArg.split(",")) {
    const P = new Map(graded(parent, s).map((i) => [i.record.questionKey, i]))
    const Bm = new Map(graded(B, s).map((i) => [i.record.questionKey, i]))
    for (const a of graded(A, s)) {
        const p = P.get(a.record.questionKey), b = Bm.get(a.record.questionKey)
        if (a.record.stratum !== "hit" || !p || !b || a.correct == null || b.correct == null || p.correct == null) continue
        const ca = a.answer.answer.trim() !== p.answer.answer.trim(), cb = b.answer.answer.trim() !== p.answer.answer.trim()
        if (ca && cb) { bothChanged++; if (a.answer.answer.trim() === b.answer.answer.trim()) sameText++ }
        const k = `A ${a.correct - p.correct >= 0 ? "+" : ""}${a.correct - p.correct} / B ${b.correct - p.correct >= 0 ? "+" : ""}${b.correct - p.correct}`
        t[k] = (t[k] ?? 0) + 1
    }
}
console.log(`${A} (A) and ${B} (B) vs ${parent} over ${setsArg}: both changed ${bothChanged}, identical texts among them ${sameText}`)
for (const [k, n] of Object.entries(t).sort()) console.log(`  ${k}: ${n}`)
process.exit(0)
