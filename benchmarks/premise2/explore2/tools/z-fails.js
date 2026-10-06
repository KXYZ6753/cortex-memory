// z: dump wrong answers of a variant on a set (question, gold, answer, J1 reason, step).
import { loadTable, pool, verdictRow } from "./n-lib.js"
const [set = "S300-2", variant = "x1", stratum = "hit"] = process.argv.slice(2)
const { table, keys } = loadTable(set, [variant])
const m = table.get(variant)
let n = 0
for (const k of keys) {
    const x = m.get(k); const r = pool.byKey.get(k)
    if (!x || x.correct !== 0 || r.stratum !== stratum) continue
    n++
    const v = verdictRow(r, x.answer)
    console.log(`#${n} [${x.a.step ?? ""} lp=${x.a.firstMean ?? ""}] Q: ${r.question}\n  GOLD: ${r.gold}\n  ANS: ${String(x.answer).replace(/\s+/g, " ")}\n  J1: ${String(v?.reason ?? v?.rationale ?? JSON.stringify(v ?? {})).slice(0, 200)}\n`)
}
