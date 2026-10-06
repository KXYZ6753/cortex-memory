// Worker j: offline estimate of "re-read the YES email alone" on x1's committed questions.
// On FULL-0 the gold-only oracle (sandwich prompt over [gold]) is exactly that answer
// whenever x1's first YES email is the gold email. Reports, per step and stratum, how
// often the YES email is the gold / a twin, and x1 vs oracle accuracy where it is.
//   node benchmarks/premise2/explore2/tools/j-yesalone.js FULL-0
import { pool, loadTable, weightedOf } from "./n-lib.js"

const setName = process.argv[2] ?? "FULL-0"
const { table, keys } = loadTable(setName, ["x1", "oracles", "gates"])
const cells = new Map()
const sim = { a: [], b: [], c: [] }
for (const key of keys) {
    const r = pool.byKey.get(key)
    const x = table.get("x1").get(key)
    const o = table.get("oracles")?.get(key)
    const step = x.a.step
    const yes = (x.a.log ?? []).find((l) => l.act === "check" && l.yes)?.path
    const rel = !yes ? "none" : yes === r.path ? "gold" : (r.twins ?? []).includes(yes) ? "twin" : "other"
    const id = `${r.stratum} ${step} yes=${rel}`
    const c = cells.get(id) ?? { n: 0, x1: 0, or: 0 }
    c.n++; c.x1 += x.correct ?? 0; c.or += o?.correct ?? 0
    cells.set(id, c)
    // policies: a = x1; b = commit-g5 & YES is gold -> oracle; c = any commit & YES is gold -> oracle
    sim.a.push({ stratum: r.stratum, v: x.correct ?? 0 })
    sim.b.push({ stratum: r.stratum, v: step === "commit-g5" && rel === "gold" && o ? o.correct ?? 0 : x.correct ?? 0 })
    sim.c.push({ stratum: r.stratum, v: step.startsWith("commit") && rel === "gold" && o ? o.correct ?? 0 : x.correct ?? 0 })
}
console.log("stratum step yes | n | x1 | oracle(gold alone)")
for (const [id, c] of [...cells].sort()) console.log(`${id} | ${c.n} | ${c.x1} | ${c.or}`)
for (const [name, items] of Object.entries(sim)) { const w = weightedOf(items); console.log(name, w.w.toFixed(2), "miss", w.miss.toFixed(1), "hit", w.hit.toFixed(2)) }
