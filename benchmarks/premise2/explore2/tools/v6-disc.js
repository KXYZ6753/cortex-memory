// v6 (aux): discrimination on parent-vs-alternative discordant pairs (one right, one wrong).
// Pool A: parent = gates, alternatives = every same-context prompt variant (distinct texts).
// Reports the AUC of score(alt) - score(parent) for "the alternative is right", overall and split by
// gates' own answer confidence (mean token logprob, from an x1-family commit with the same text;
// n.md: unsure < -0.1). Hits and misses separately. Question-clustered bootstrap for the AUC.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OUT } from "./v6-lib.js"
import { mulberry32 } from "./rng.js"
import { features } from "./v6-feat.js"

const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const onlyT2 = process.argv[2] === "t2"
const evK = Number(process.argv[3] ?? 99) // evidence = gates' first evK context emails
const rows = []
for (const q of pools.A) {
    const par = q.cands.find((c) => c.text === q.parent)
    const alts = onlyT2 ? q.cands.filter((c) => c.text === q.t2) : q.cands.filter((c) => c.text !== q.parent)
    const disc = alts.filter((a) => a.correct !== par.correct)
    if (!disc.length) continue
    const f = features(q, q.evidence.slice(0, evK), [par.text, ...disc.map((a) => a.text)])
    if (!f) continue
    disc.forEach((a, i) => rows.push({ q: q.key, stratum: q.stratum, conf: q.conf, altRight: a.correct, d: Object.fromEntries(Object.keys(f[0]).map((k) => [k, f[i + 1][k] - f[0][k]])) }))
}
const auc = (items, k) => {
    const pos = items.filter((r) => r.altRight).map((r) => r.d[k]), neg = items.filter((r) => !r.altRight).map((r) => r.d[k])
    if (!pos.length || !neg.length) return NaN
    let w = 0
    for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0
    return w / (pos.length * neg.length)
}
const ci = (items, k, B = 2000) => {
    const byQ = new Map()
    for (const r of items) { if (!byQ.has(r.q)) byQ.set(r.q, []); byQ.get(r.q).push(r) }
    const groups = [...byQ.values()]
    const rnd = mulberry32(6008)
    const d = []
    for (let b = 0; b < B; b++) {
        const s = []
        for (let i = 0; i < groups.length; i++) s.push(...groups[Math.floor(rnd() * groups.length)])
        const a = auc(s, k)
        if (!Number.isNaN(a)) d.push(a)
    }
    d.sort((x, y) => x - y)
    return `${auc(items, k).toFixed(3)} [${d[Math.floor(0.025 * d.length)].toFixed(3)}, ${d[Math.floor(0.975 * d.length)].toFixed(3)}]`
}
for (const st of ["hit", "miss"]) {
    for (const [label, filt] of [["all", () => true], ["gates unsure (conf < -0.1)", (r) => r.conf !== null && r.conf < -0.1], ["gates confident (conf >= -0.1)", (r) => r.conf !== null && r.conf >= -0.1], ["conf unknown", (r) => r.conf === null]]) {
        const it = rows.filter((r) => r.stratum === st && filt(r))
        if (!it.length) continue
        const nr = it.filter((r) => r.altRight).length
        console.log(`${st} ${label}: pairs ${it.length} (alt right ${nr}, gates right ${it.length - nr}, ${new Set(it.map((r) => r.q)).size} q)`)
        for (const k of ["ef", "ef5", "max", "top1", "lex", "prox", "len"]) console.log(`   AUC ${k.padEnd(5)} ${ci(it, k)}`)
    }
}
