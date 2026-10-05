// Offline (p): trigger for a reverse swap on SWITCHED questions (gates reads the
// mailbox context first): slot 5 of the mailbox context <- best unseen CE email of the
// asker's mailbox BM25 top 30, only if b1 - (max CE of the mailbox context) > t.
// Reports hit fires (hit prompts changed), miss fires, gains (AB brought in where the
// mailbox context had none), losses (AB at mailbox slot 5 only, dropped).
//   node benchmarks/premise2/explore2/tools/p-trigger-sw.js <sets...>

import { join } from "node:path"
import { openAll, SCRATCH, readJsonIf } from "./r-common.js"
import { byHeaderRank } from "../../explore/variants.js"

process.env.R_ALLOW_HELDOUT = "1"
const env = await openAll({ sets: process.argv.slice(2) })
const pce = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
const rce = readJsonIf(join(SCRATCH, "r-ce.json"), {})
const rows = []
for (const record of env.records) {
    const qk = record.questionKey
    const cache = { ...(rce[qk]?.s ?? {}), ...(pce[qk] ?? {}) }
    const global = env.bm25.search(record.question, 5).map((h) => h.path)
    if (global[0]?.startsWith(`${record.user}/`)) continue
    const mbox = env.bm25.search(record.question, 30, record.user).map((h) => h.path)
    const ctx = byHeaderRank(record.question, mbox.slice(0, 20), env.emailOf, { k: 5 })
    const cands = mbox.filter((p) => !ctx.includes(p))
    if ([...cands, ...ctx].some((p) => cache[p] === undefined)) continue
    const b = [...cands].sort((x, y) => cache[y] - cache[x])[0]
    const ab = (p) => env.answerBearing(record, p)
    rows.push({ stratum: record.stratum, d: cache[b] - Math.max(...ctx.map((p) => cache[p])), gain: !ctx.some(ab) && ab(b), loss: ab(ctx[4]) && !ctx.slice(0, 4).some(ab) })
}
console.log(`switched: ${rows.filter((r) => r.stratum === "hit").length} hits, ${rows.filter((r) => r.stratum === "miss").length} misses`)
console.log("| t | hit fires | miss fires | gains | losses |\n|---|---|---|---|---|")
for (const t of [-Infinity, -2, -1, 0, 1, 2]) {
    const f = rows.filter((r) => r.d > t)
    console.log(`| ${t} | ${f.filter((r) => r.stratum === "hit").length} | ${f.filter((r) => r.stratum === "miss").length} | ${f.filter((r) => r.gain).length} | ${f.filter((r) => r.loss).length} |`)
}
