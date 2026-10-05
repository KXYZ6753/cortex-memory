// Offline: dump wrong "who" hits for a variant with J1 reasons.
import { pool, loadTable, verdictRow } from "./n-lib.js"
import { questionType } from "../../text.js"
const [setName = "FULL-0", v = "gates", other = "oracles"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, [v, other])
for (const q of keys) {
    const r = pool.byKey.get(q); if (r.stratum !== "hit" || questionType(r.question) !== "who") continue
    const x = table.get(v).get(q); if (x.correct) continue
    const o = table.get(other).get(q)
    console.log(`\nQ: ${r.question}\nGOLD: ${r.gold}\n${v}: ${x.answer.replace(/\s+/g, " ").slice(0, 250)}\n  J1: ${verdictRow(r, x.answer)?.reason}\n${other} [${o?.correct}]: ${o?.answer.replace(/\s+/g, " ").slice(0, 200)}`)
}
