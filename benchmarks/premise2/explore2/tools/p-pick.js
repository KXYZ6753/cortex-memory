// Offline (p): how to pick the swapped emails among the unseen candidates (asker's
// mailbox BM25 top N minus the global five), non-switched misses only: AB recall of the
// top 1 / top 2 picks for CE alone vs fusions with BM25 rank, header score, snippet CE.
//   node benchmarks/premise2/explore2/tools/p-pick.js <sets...>

import { join } from "node:path"
import { openAll, SCRATCH, readJsonIf } from "./r-common.js"
import { headerScore } from "../../explore/variants.js"

process.env.R_ALLOW_HELDOUT = "1"
const env = await openAll({ sets: process.argv.slice(2) })
const pce = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
const rce = readJsonIf(join(SCRATCH, "r-ce.json"), {})
const snip = readJsonIf(join(SCRATCH, "p-ce-snip.json"), {})
const methods = {}
let n = 0
const rank = (list, key) => new Map([...list].sort((a, b) => key(b) - key(a)).map((p, i) => [p, i]))
for (const record of env.records) {
    if (record.stratum !== "miss") continue
    const qk = record.questionKey
    const cache = { ...(rce[qk]?.s ?? {}), ...(pce[qk] ?? {}) }
    const global = env.bm25.search(record.question, 5).map((h) => h.path)
    if (!global[0]?.startsWith(`${record.user}/`)) continue
    for (const depth of [30, 50]) {
        const mbox = env.bm25.search(record.question, depth, record.user).map((h) => h.path)
        const cands = mbox.filter((p) => !global.includes(p))
        if (cands.some((p) => cache[p] === undefined)) continue
        if (depth === 30) n++
        const ab = (p) => env.answerBearing(record, p)
        const h = new Map(cands.map((p) => [p, headerScore(record.question, env.emailOf(p))]))
        const ce = (p) => cache[p]
        const rCe = rank(cands, ce), rH = rank(cands, (p) => h.get(p)), rB = new Map(cands.map((p, i) => [p, i]))
        const hasSnip = snip[qk] && cands.every((p) => snip[qk][p] !== undefined)
        const scorers = {
            ce,
            "ce+0.5h": (p) => ce(p) + 0.5 * h.get(p),
            "ce+1h": (p) => ce(p) + h.get(p),
            "rrf(ce,bm25)": (p) => 1 / (10 + rCe.get(p)) + 1 / (10 + rB.get(p)),
            "rrf(2ce,bm25,h)": (p) => 2 / (10 + rCe.get(p)) + 1 / (10 + rB.get(p)) + 1 / (10 + rH.get(p)),
            "ce-0.05rank": (p) => ce(p) - 0.05 * rB.get(p),
            ...(hasSnip ? { snip: (p) => snip[qk][p], "max(ce,snip)": (p) => Math.max(ce(p), snip[qk][p]), "ce+snip": (p) => ce(p) + snip[qk][p] } : {}),
        }
        for (const [name, f] of Object.entries(scorers)) {
            const order = [...cands].sort((a, b) => f(b) - f(a))
            const key = `d${depth} ${name}`
            methods[key] ??= { n: 0, top1: 0, top2: 0, top3: 0 }
            methods[key].n++
            methods[key].top1 += ab(order[0]) ? 1 : 0
            methods[key].top2 += order.slice(0, 2).some(ab) ? 1 : 0
            methods[key].top3 += order.slice(0, 3).some(ab) ? 1 : 0
        }
    }
}
console.log(`non-switched misses: ${n}`)
console.log("| method | n | AB top1 | top2 | top3 |\n|---|---|---|---|---|")
for (const [k, v] of Object.entries(methods)) console.log(`| ${k} | ${v.n} | ${v.top1} | ${v.top2} | ${v.top3} |`)
