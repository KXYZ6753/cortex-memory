// Offline (p): for misses where r5's first context has no answer-bearing (AB) email,
// where is the AB email? Switched or not, rank in mailbox BM25 top 50, best CE rank
// among the swap candidates (mailbox top 50 + dense top 30 not shown), dense rank.
//   node benchmarks/premise2/explore2/tools/p-where.js <sets...>

import { join } from "node:path"
import { openAll, SCRATCH, readJsonIf } from "./r-common.js"
import { denseLists } from "./p-common.js"
import { buildContexts } from "../variants/p-perfect.js"

process.env.R_ALLOW_HELDOUT = "1"
const sets = process.argv.slice(2)
const env = await openAll({ sets })
const text = process.env.P_TEXT ?? "std"
const ce = readJsonIf(join(SCRATCH, `p-ce-${text}.json`), {})
const dense = denseLists()
const tally = {}
const inc = (k) => { tally[k] = (tally[k] ?? 0) + 1 }
const bucket = (r) => (r < 0 ? "none" : r < 5 ? "1-5" : r < 10 ? "6-10" : r < 20 ? "11-20" : r < 30 ? "21-30" : "31-50")
for (const record of env.records) {
    if (record.stratum !== "miss") continue
    const qk = record.questionKey
    const global = env.bm25.search(record.question, 20).map((h) => h.path)
    const mailbox = env.bm25.search(record.question, 50, record.user).map((h) => h.path)
    const d = dense.get(qk)?.mailbox.map((x) => x[0]) ?? []
    const cache = ce[qk] ?? {}
    const { contexts, switched } = await buildContexts({ question: record.question, user: record.user, lists: { global, mailbox, dense: null }, emailOf: env.emailOf, scoreCe: async (ps) => new Map(ps.map((p) => [p, cache[p] ?? -99])), opts: {} })
    const isAb = (p) => env.answerBearing(record, p)
    if (contexts[0].some(isAb)) { inc(`in ctx0 (${switched ? "sw" : "nsw"})`); continue }
    const shown = new Set(contexts[0])
    const pool = [...new Set([...mailbox, ...d.slice(0, 30)])].filter((p) => !shown.has(p))
    const byCe = [...pool].sort((a, b) => (cache[b] ?? -99) - (cache[a] ?? -99))
    const ceRank = byCe.findIndex(isAb)
    inc(`not in ctx0 ${switched ? "sw" : "nsw"} | bm25 ${bucket(mailbox.findIndex(isAb))} | dense ${bucket(d.findIndex(isAb))} | ce-in-pool ${bucket(ceRank)}`)
}
for (const [k, v] of Object.entries(tally).sort()) console.log(String(v).padStart(4), k)
