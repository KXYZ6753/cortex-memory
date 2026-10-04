// Offline: when BM25 and the cross-encoder agree on the top email, how often is it
// answer-bearing, and how often does the rest of the context hold another AB email?
import { join } from "node:path"
import { SCRATCH, readJsonIf } from "./r-common.js"
const MS = 0.06800407113777587
const F = readJsonIf(join(SCRATCH, "r-features.json"), [])
const CE = readJsonIf(join(SCRATCH, "r-ce.json"), {})
const t = {}
for (const f of F) {
    if (!CE[f.key]) continue
    const g = f.global.slice(0, 5).map((x) => x[0])
    if (!g[0].startsWith(`${f.user}/`)) continue
    const ce = (p) => CE[f.key].s[p] ?? -99
    const ceTop = [...g].sort((a, b) => ce(b) - ce(a))[0]
    const margin = ce(ceTop) - Math.max(...g.filter((p) => p !== ceTop).map(ce))
    const key = `${f.stratum} agree=${ceTop === g[0]} margin${margin > 3 ? ">3" : margin > 1 ? "1-3" : "<1"}`
    t[key] ??= { n: 0, ab1: 0 }
    t[key].n++
    t[key].ab1 += f.info[g[0]].ab
}
for (const [k, v] of Object.entries(t).sort()) console.log(k, v.n, (100 * v.ab1 / v.n).toFixed(1))
