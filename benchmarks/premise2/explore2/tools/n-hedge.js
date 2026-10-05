// Offline: accuracy of answers that hedge ("does not specify ...") per variant, by stratum.
// node benchmarks/premise2/explore2/tools/n-hedge.js S300-2 gates,o4,o5,pb
import { pool, loadTable } from "./n-lib.js"
const [setName = "S300-2", list = "gates,o4,o5,pb"] = process.argv.slice(2)
export const HEDGE = /\b(do(es)?n['’]?t|do(es)? not|is not|are not|isn['’]t|aren['’]t|was not|were not)\s+(specif|mention|provide|state|say|include|give|indicate|explicitly|contain|identify|detail)|\bnot (specified|mentioned|stated|provided)\b|\bno (specific|explicit) /i
const vs = list.split(",")
const { table, keys } = loadTable(setName, vs)
for (const v of vs) {
    const m = table.get(v); if (!m) continue
    for (const st of ["hit", "miss"]) {
        const rows = keys.filter((q) => pool.byKey.get(q).stratum === st && m.get(q)?.correct !== null && m.get(q))
        const h = rows.filter((q) => HEDGE.test(m.get(q).answer) && !m.get(q).abstain)
        const nh = rows.filter((q) => !HEDGE.test(m.get(q).answer))
        const acc = (l) => (l.length ? (100 * l.reduce((s, q) => s + m.get(q).correct, 0) / l.length).toFixed(1) : "-")
        console.log(`${v} ${st}: hedge n=${h.length} acc ${acc(h)} | other n=${nh.length} acc ${acc(nh)}`)
    }
}
// When gates hedges on a hit: how do the others do?
const g = table.get("gates")
const hq = keys.filter((q) => g.get(q) && HEDGE.test(g.get(q).answer) && !g.get(q).abstain)
for (const v of vs) { const m = table.get(v); if (!m) continue; const l = hq.filter((q) => m.get(q)?.correct !== null); console.log(`on gates-hedge (n=${l.length}): ${v} acc ${(100 * l.reduce((s, q) => s + m.get(q).correct, 0) / l.length).toFixed(1)}, nonhedge-alt ${l.filter((q) => !HEDGE.test(m.get(q).answer)).length}`) }
