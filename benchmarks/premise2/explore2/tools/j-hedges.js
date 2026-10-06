// Worker j: x1's (or any variant's) final answers that hedge / list several candidates /
// are truncated, by set, stratum and step, with accuracy and the gold-only oracle where
// available. Prints the hit cases.
//   node benchmarks/premise2/explore2/tools/j-hedges.js x1 FULL-0 S300-1 S300-2
import { pool, loadTable } from "./n-lib.js"
import { PATTERNS } from "./j-lib.js"

const [variant, ...sets] = process.argv.slice(2)
for (const setName of sets) {
    const { table, keys } = loadTable(setName, [variant, "oracles", "gates"])
    const agg = new Map()
    for (const key of keys) {
        const r = pool.byKey.get(key)
        const x = table.get(variant).get(key)
        const t = x.answer ?? ""
        const kind = x.a.status === "output_limit" ? "trunc" : PATTERNS.hedge(t) ? "hedge" : PATTERNS.multiCand(t) ? "multi" : null
        if (!kind) continue
        const id = `${r.stratum} ${kind} ${x.a.step ?? ""}`
        const s = agg.get(id) ?? { n: 0, right: 0, or: 0, gates: 0 }
        s.n++; s.right += x.correct ?? 0; s.or += table.get("oracles")?.get(key)?.correct ?? 0; s.gates += table.get("gates")?.get(key)?.correct ?? 0
        agg.set(id, s)
        if (process.env.SHOW) console.log(`  [${setName} ${id}] ${x.correct} Q: ${r.question}\n     G: ${r.gold}\n     A: ${t}`)
    }
    console.log(setName)
    for (const [id, s] of [...agg].sort()) console.log(`  ${id}: n ${s.n}, ${variant} right ${s.right}, oracle right ${s.or}, gates right ${s.gates}`)
}
