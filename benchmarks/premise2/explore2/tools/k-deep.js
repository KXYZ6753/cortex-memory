// Worker k: where is the answer-bearing email for explore-arena misses whose AB email
// is outside w7's 20 candidates? (mailbox BM25 rank for the raw question; header).
import { join } from "node:path"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { splitFile, parseFileHeader } from "../../text.js"
const setName = process.argv[2] ?? "S300-2"
const { graded, bearing, emails } = await openAll()
const bm25 = openBm25(join(".data/premise2", "corpus.sqlite"))
const w7 = new Map(graded("w7@1+cold", setName).map((i) => [i.record.questionKey, i]))
for (const g of graded("gates@1+cold", setName)) {
    const w = w7.get(g.record.questionKey)
    const yes = new Set(w.answer.yes)
    if (g.answer.contextPaths.some((p) => yes.has(p))) continue
    const isAB = bearing(g.record)
    if (w.answer.candidates.some(isAB)) continue
    const mb = bm25.search(g.record.question, 300, g.record.user).map((h) => h.path)
    const rank = mb.findIndex(isAB)
    const h = parseFileHeader(splitFile(emails.emailOf(g.record.path)).header)
    console.log(`${g.record.stratum} mbRank=${rank} | Q: ${g.record.question}\n   gold: ${h.sender} | ${h.subject} | ref: ${String(g.record.gold).slice(0, 100)}`)
}
