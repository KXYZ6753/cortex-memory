// Offline: gates' accuracy by mean-token-logprob bucket (n-lp0 traces), per stratum.
import { pool, loadTable } from "./n-lib.js"
import { HEDGE } from "../variants/n-conf.js"
const [setName = "S300-2"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, ["n-lp0", "gates"])
const rows = []
for (const q of keys) {
    const a = table.get("n-lp0").get(q), g = table.get("gates").get(q)
    if (!a?.a?.lp || g.correct === null) continue
    const l = a.a.lp.gates.lps
    rows.push({ st: pool.byKey.get(q).stratum, m: l.reduce((x, y) => x + y, 0) / Math.max(1, l.length), c: g.correct, inCtx: a.a.contextPaths.includes(pool.byKey.get(q).path), hedge: HEDGE.test(a.a.lp.gates.answer) })
}
const qs = [...rows].map((r) => r.m).sort((a, b) => a - b)
const cuts = [0.1, 0.2, 0.3, 0.5].map((p) => qs[Math.floor(p * qs.length)])
console.log("quantile cuts (10/20/30/50%):", cuts.map((x) => x.toFixed(3)).join(" "))
const edges = [-Infinity, ...cuts, Infinity]
for (let i = 0; i < edges.length - 1; i++) {
    const b = rows.filter((r) => r.m >= edges[i] && r.m < edges[i + 1])
    const s = (st) => { const x = b.filter((r) => r.st === st); return `${st} n=${x.length} acc ${(100 * x.reduce((s, r) => s + r.c, 0) / Math.max(1, x.length)).toFixed(0)} gold-in-ctx ${x.filter((r) => r.inCtx).length}` }
    console.log(`[${edges[i].toFixed(3)}, ${edges[i + 1].toFixed(3)})  ${s("hit")} | ${s("miss")}`)
}
