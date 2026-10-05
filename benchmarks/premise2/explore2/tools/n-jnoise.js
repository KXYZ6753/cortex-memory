// Offline: how much of the gates-vs-alt disagreement is between near-identical answers
// (token F1 >= 0.85), i.e. judge noise no selector can harvest.
import { pool, loadTable } from "./n-lib.js"
import { tokens } from "../../text.js"
const [setName = "S300-2", list = "o4,o5,pb"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, ["gates", ...list.split(",")])
const f1 = (a, b) => { const A = tokens(a), B = tokens(b); const m = new Map(); for (const t of A) m.set(t, (m.get(t) ?? 0) + 1); let c = 0; for (const t of B) if (m.get(t) > 0) { c++; m.set(t, m.get(t) - 1) } return c ? (2 * c) / (A.length + B.length) : 0 }
for (const v of list.split(",")) {
    let dis = 0, near = 0
    for (const q of keys) { const g = table.get("gates").get(q), o = table.get(v).get(q); if (!o || pool.byKey.get(q).stratum !== "hit") continue; if (g.correct !== o.correct) { dis++; if (f1(g.answer, o.answer) >= 0.85) near++ } }
    console.log(`${v}: hit disagreements ${dis}, near-identical answers ${near}`)
}
