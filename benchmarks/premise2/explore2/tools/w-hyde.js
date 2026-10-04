// Offline (no GPU): does gates' stored draft answer help retrieval? Gold rank in the
// asker's mailbox for BM25(question) vs BM25(question + draft answer), FULL-0.
// node benchmarks/premise2/explore2/tools/w-hyde.js <failures.json>
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
const dataDir = ".data/premise2"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const clean = (s) => String(s).replace(/[^\p{L}\p{N}\s]/gu, " ")
const tally = {}
const bucket = (rank) => (rank < 0 ? "none" : rank === 0 ? "1" : rank < 5 ? "2-5" : rank < 20 ? "6-20" : "21-50")
for (const r of rows) {
    if (!r.gates) continue
    const gold = (p) => p === r.path || (r.twins ?? []).includes(p)
    const q = bm25.search(r.question, 50, r.user).map((h) => h.path).findIndex(gold)
    const qa = bm25.search(`${r.question} ${clean(r.gates.answer)}`, 50, r.user).map((h) => h.path).findIndex(gold)
    const k = `${r.stratum} gates=${r.gates.correct} q:${bucket(q)} -> qa:${bucket(qa)}`
    tally[k] = (tally[k] ?? 0) + 1
}
console.log(Object.entries(tally).sort().map((e) => e.join(": ")).join("\n"))
bm25.close()
