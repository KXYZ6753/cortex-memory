// Worker s: peek at gold-only (oracles) hit answers on dev sets by question type.
//   node benchmarks/premise2/explore2/tools/s-peek.js <sets> [n examples]
import { questionType } from "../../text.js"
import { loadTable, pool, closeEmails, emails } from "./c-lib.js"
const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,FULL-1").split(",")
const nEx = Number(process.argv[3] ?? 0)
const store = await emails()
const by = {}
const ex = []
for (const s of sets) {
    const { table } = loadTable(s, ["oracles"])
    const t = table.get("oracles")
    if (!t) { console.log(`${s}: no oracles`); continue }
    for (const [key, row] of t) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const qt = questionType(r.question)
        by[qt] ??= { n: 0, ok: 0, ung: 0 }
        by[qt].n++
        if (row.correct === null) by[qt].ung++
        else by[qt].ok += row.correct
        if (row.correct === 0 && ex.length < nEx) ex.push({ s, key, qt, q: r.question, gold: r.gold, ans: row.answer })
    }
}
console.log(by)
for (const e of ex) console.log(`\n[${e.s} ${e.qt}] ${e.q}\n  GOLD: ${e.gold}\n  ANS:  ${e.ans}`)
if (nEx === 1) { const r = pool.byKey.get(ex[0].key); console.log(store.emailOf(r.path)) }
closeEmails()
