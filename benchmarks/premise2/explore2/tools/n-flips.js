// Offline: hit flips vs gates of every stored variant, split by gates' confidence
// (n-lp0 mean logprob >= tau = confident). Tests "perturbing confident hits only loses".
import { pool, loadTable } from "./n-lib.js"
const [setName = "S300-2", tauArg = "-0.1"] = process.argv.slice(2)
const tau = Number(tauArg)
const { table, keys } = loadTable(setName)
const g = table.get("gates")
const conf = new Map(keys.map((q) => { const l = table.get("n-lp0").get(q).a.lp.gates.lps; return [q, l.reduce((x, y) => x + y, 0) / Math.max(1, l.length) >= tau] }))
const T = { conf: [0, 0, 0], unsure: [0, 0, 0] }
const rows = []
for (const [v, m] of table) {
    if (["gates", "n-lp0", "oracle", "oracles", "pbrep"].includes(v) || v.startsWith("n-")) continue
    const r = { v, conf: [0, 0], unsure: [0, 0] }
    for (const q of keys) {
        if (pool.byKey.get(q).stratum !== "hit") continue
        const x = m.get(q); if (!x || x.correct == null) continue
        const k = conf.get(q) ? "conf" : "unsure"
        T[k][2]++
        if (x.correct > g.get(q).correct) { r[k][0]++; T[k][0]++ }
        if (x.correct < g.get(q).correct) { r[k][1]++; T[k][1]++ }
    }
    rows.push(`${v} conf +${r.conf[0]}/-${r.conf[1]} unsure +${r.unsure[0]}/-${r.unsure[1]}`)
}
console.log(rows.join("\n"))
console.log(`${setName} TOTAL over variants: confident hits +${T.conf[0]}/-${T.conf[1]} (of ${T.conf[2]} variant-question pairs); unsure hits +${T.unsure[0]}/-${T.unsure[1]} (of ${T.unsure[2]})`)
