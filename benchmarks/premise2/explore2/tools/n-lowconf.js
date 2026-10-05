// Offline: on gates' low-confidence questions (n-lp0 mean logprob < tau), how do other
// stored variants do? (Is there a systematically better action for unsure hits?)
import { pool, loadTable } from "./n-lib.js"
const [setName = "S300-2", tauArg = "-0.13"] = process.argv.slice(2)
const tau = Number(tauArg)
const { table, keys } = loadTable(setName)
const low = keys.filter((q) => { const a = table.get("n-lp0")?.get(q)?.a; if (!a) return false; const l = a.lp.gates.lps; return l.reduce((x, y) => x + y, 0) / Math.max(1, l.length) < tau })
for (const st of ["hit", "miss"]) {
    const qs = low.filter((q) => pool.byKey.get(q).stratum === st)
    const g = table.get("gates")
    const out = []
    for (const [v, m] of table) {
        const l = qs.filter((q) => m.get(q)?.correct != null)
        if (l.length < qs.length) continue
        const plus = l.filter((q) => m.get(q).correct && !g.get(q).correct).length, minus = l.filter((q) => !m.get(q).correct && g.get(q).correct).length
        out.push(`${v} +${plus}/-${minus}`)
    }
    console.log(`${setName} ${st} low-conf n=${qs.length} gates right ${qs.filter((q) => g.get(q).correct).length}: ${out.join(", ")}`)
}
