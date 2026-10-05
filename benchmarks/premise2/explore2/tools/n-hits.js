// Dump gates' wrong hits on a set with other variants' answers and J1 reasons.
// node benchmarks/premise2/explore2/tools/n-hits.js S300-2 [variants]
import { pool, loadTable, verdictRow } from "./n-lib.js"
const [setName = "S300-2", list = "gates,o4,o5,pb,s1"] = process.argv.slice(2)
const vs = list.split(",")
const { table, keys } = loadTable(setName, vs)
const g = table.get("gates")
for (const q of keys) {
    const r = pool.byKey.get(q)
    if (r.stratum !== "hit" || g.get(q).correct) continue
    console.log(`\n### ${q}\nQ: ${r.question}\nGOLD: ${r.gold}`)
    for (const v of vs) { const x = table.get(v)?.get(q); if (!x) continue; const vr = verdictRow(r, x.answer); console.log(`  ${v} [${x.correct}] ${x.answer.replace(/\s+/g, " ").slice(0, 300)}${v === "gates" && vr ? `\n     J1: ${vr.reason}` : ""}`) }
}
