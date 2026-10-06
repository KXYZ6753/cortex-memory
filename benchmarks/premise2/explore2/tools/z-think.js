// z: offline look at phase-1 thinking (pbuthink vs pbu, same contexts) and decode speed.
import { loadTable, weightedOf, pool } from "./n-lib.js"
const set = process.argv[2] ?? "S100-3"
const { table, keys } = loadTable(set, ["pbu", "pbuthink", "pbrep", "pb"])
for (const [v, m] of table) {
    const items = keys.filter((k) => m.has(k) && m.get(k).correct !== null).map((k) => ({ stratum: pool.byKey.get(k).stratum, v: m.get(k).correct }))
    const a = [...m.values()].map((x) => x.a)
    const mean = (f) => a.reduce((s, x) => s + (f(x) ?? 0), 0) / a.length
    console.log(v, a[0].version, items.length, weightedOf(items), "wall", mean((x) => x.wallMs).toFixed(0), "outTok", mean((x) => x.outputTokens).toFixed(0), "genMs", mean((x) => x.genMs).toFixed(0), "thinkChars", mean((x) => x.thinkingChars).toFixed(0), "status", JSON.stringify(a.reduce((o, x) => (o[x.status] = (o[x.status] ?? 0) + 1, o), {})))
}
const A = table.get("pbu"), B = table.get("pbuthink")
if (A && B) {
    const c = { hit: [0, 0, 0, 0], miss: [0, 0, 0, 0] }
    for (const k of keys) { const a = A.get(k)?.correct, b = B.get(k)?.correct; if (a == null || b == null) continue; c[pool.byKey.get(k).stratum][a * 2 + b]++ }
    console.log("pbu/pbuthink [00,01(think only),10(pbu only),11]", c)
    // speed: tokens per second
    const t = [...B.values()].map((x) => x.a).filter((x) => x.outputTokens > 50)
    console.log("think tok/s", (t.reduce((s, x) => s + x.outputTokens, 0) / t.reduce((s, x) => s + x.genMs, 0) * 1000).toFixed(1), "n", t.length)
    const lens = [...B.values()].map((x) => x.a.outputTokens).sort((a, b) => a - b)
    console.log("think out tokens p10/50/90/max", lens[10], lens[50], lens[90], lens.at(-1))
}
