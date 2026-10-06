// Worker h (round 4): how reliable is a cheap "vague / incomplete answer" (PART) detector?
// Over every graded variant's hit answers on the given sets: fire rate and accuracy of
// VAGUE (variants/h-spec.js), with and without HEDGE; and on x1's handover answers.
//   node benchmarks/premise2/explore2/tools/h-vague.js S300-2 S300-1 FULL-0
import { pool, loadTable } from "./n-lib.js"
import { VAGUE } from "../variants/h-spec.js"
import { HEDGE } from "../variants/n-conf.js"

const sets = process.argv.slice(2)
const s = {}
const add = (k, c) => { s[k] ??= { n: 0, right: 0 }; s[k].n++; s[k].right += c }
const examples = []
for (const setName of sets) {
    const { table, keys } = loadTable(setName)
    for (const [variant, rows] of table) {
        if (variant === "oracles") continue
        for (const key of keys) {
            const row = rows.get(key)
            if (!row || row.correct === null) continue
            const r = pool.byKey.get(key)
            const t = String(row.answer ?? "")
            add(`${r.stratum} all`, row.correct)
            const v = VAGUE.test(t), h = HEDGE.test(t)
            if (v) add(`${r.stratum} vague`, row.correct)
            if (v && !h) add(`${r.stratum} vague&!hedge`, row.correct)
            if (h) add(`${r.stratum} hedge`, row.correct)
            if (variant === "x1" && row.a.step === "commit-g5") {
                add(`x1-handover ${r.stratum} all`, row.correct)
                if (v) add(`x1-handover ${r.stratum} vague`, row.correct)
                if (v && r.stratum === "hit") examples.push(`${setName} ${row.correct} | ${t.slice(0, 140)}`)
            }
        }
    }
}
for (const [k, v] of Object.entries(s).sort()) console.log(`${k}\t${v.n}\t${(100 * v.right / v.n).toFixed(1)}`)
if (process.env.SHOW) console.log(examples.join("\n"))
process.exit(0)
