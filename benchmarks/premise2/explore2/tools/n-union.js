// Offline: union (oracle-select) of gates with subsets of other variants, hits/misses.
import { pool, loadTable, weightedOf } from "./n-lib.js"
const [setName = "S300-2", list = "o4,o5,pb"] = process.argv.slice(2)
const vs = list.split(",")
const { table, keys } = loadTable(setName, ["gates", ...vs])
const subsets = [[]]
for (const v of vs) for (const s of [...subsets]) subsets.push([...s, v])
for (const s of subsets) {
    const items = keys.map((q) => ({ stratum: pool.byKey.get(q).stratum, v: Math.max(table.get("gates").get(q).correct, ...s.map((v) => table.get(v).get(q)?.correct ?? 0)) }))
    const w = weightedOf(items)
    console.log(`gates+${s.join("+") || "-"}: ${w.w.toFixed(1)} miss ${w.miss.toFixed(0)} hit ${w.hit.toFixed(1)}`)
}
