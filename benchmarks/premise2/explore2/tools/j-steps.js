// Worker j: x1 hit/miss accuracy by step, with the counterfactual "gates' first answer"
// (x1 stores it as gatesAnswer) and the gold-only oracle (FULL-0) on the same questions.
//   node benchmarks/premise2/explore2/tools/j-steps.js S300-2 S300-1 FULL-0
import { pool, loadTable, verdictOf } from "./n-lib.js"

for (const setName of process.argv.slice(2)) {
    const { table, keys } = loadTable(setName, ["x1", "gates", "oracles"])
    const cells = new Map()
    for (const key of keys) {
        const r = pool.byKey.get(key)
        const x = table.get("x1")?.get(key)
        if (!x) continue
        const a = x.a
        const step = a.step ?? "?"
        const id = `${r.stratum} ${step}`
        const c = cells.get(id) ?? { n: 0, x1: 0, gatesAns: 0, gatesAnsN: 0, gates: 0, oracle: 0, oracleN: 0, ungraded: 0 }
        c.n++
        if (x.correct === null) c.ungraded++
        c.x1 += x.correct ?? 0
        const ga = a.gatesAnswer ? verdictOf(r, a.gatesAnswer) : null
        if (ga !== null) { c.gatesAns += ga; c.gatesAnsN++ }
        c.gates += table.get("gates")?.get(key)?.correct ?? 0
        const o = table.get("oracles")?.get(key)?.correct
        if (o !== undefined && o !== null) { c.oracle += o; c.oracleN++ }
        cells.set(id, c)
    }
    console.log(`\n${setName}`)
    console.log("stratum step | n | x1 right | gates' first answer right (graded n) | gates run right | oracle right (n)")
    for (const [id, c] of [...cells].sort()) console.log(`${id} | ${c.n} | ${c.x1}${c.ungraded ? ` (${c.ungraded} ungraded)` : ""} | ${c.gatesAns} (${c.gatesAnsN}) | ${c.gates} | ${c.oracleN ? `${c.oracle} (${c.oracleN})` : "-"}`)
}
