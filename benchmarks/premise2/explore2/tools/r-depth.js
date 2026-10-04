// Offline: rank of the first answer-bearing email in the asker's mailbox BM25 list
// (depth 100) for dev-set misses, to size the cross-encoder candidate depth.
import { openAll } from "./r-common.js"
const env = await openAll()
const buckets = { "1-5": 0, "6-10": 0, "11-20": 0, "21-30": 0, "31-50": 0, "51-100": 0, ">100": 0 }
let n = 0
for (const record of env.records.filter((r) => r.stratum === "miss")) {
    const list = env.bm25.search(record.question, 100, record.user).map((h) => h.path)
    const rank = list.findIndex((p) => env.answerBearing(record, p)) + 1
    const b = rank === 0 ? ">100" : rank <= 5 ? "1-5" : rank <= 10 ? "6-10" : rank <= 20 ? "11-20" : rank <= 30 ? "21-30" : rank <= 50 ? "31-50" : "51-100"
    buckets[b]++
    n++
}
console.log(n, buckets)
