// Offline: paired flips of a variant vs gates (and vs r5), by stratum and by step.
import { pool, loadTable, same } from "./n-lib.js"
const [setName = "S300-2", v = "n-g5"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, [v, "gates", "r5"])
const m = table.get(v), g = table.get("gates"), r5 = table.get("r5")
const c = {}
const inc = (k) => (c[k] = (c[k] ?? 0) + 1)
for (const q of keys) {
    const x = m.get(q), st = pool.byKey.get(q).stratum, step = x.a.step
    inc(`${step} n`)
    if (x.correct > g.get(q).correct) inc(`${st} +vsGates (${step})`)
    if (x.correct < g.get(q).correct) inc(`${st} -vsGates (${step})`)
    if (step === "r5") { inc(`r5step textSameAsStoredR5 ${same(x.answer, r5.get(q).answer)}`) }
    if (step === "gates") inc(`gates-step textSameAsGates ${same(x.answer, g.get(q).answer)}`)
}
console.log(c)
