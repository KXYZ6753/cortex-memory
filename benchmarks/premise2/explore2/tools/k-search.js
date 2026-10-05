// Worker k: recall of the sender-filtered mailbox search (k1's SEARCH tool) on S300-2
// misses, with FROM/TO filled heuristically from capitalised names in the question
// (an upper bound proxy for what the model writes). Compares AB in top 10 vs raw BM25.
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { toBm25Query } from "../../../../src/bm25.js"
const setName = process.argv[2] ?? "S300-2"
const { graded, bearing } = await openAll()
const bm25 = openBm25(join(".data/premise2", "corpus.sqlite"))
const db = new DatabaseSync(join(".data/premise2", "corpus.sqlite"), { readOnly: true })
const stmt = db.prepare("SELECT path FROM docs WHERE docs MATCH ? AND user = ? ORDER BY rank LIMIT ?")
const t = { n: 0, raw10: 0, raw30: 0, from10: 0, to10: 0, either10: 0, union: 0, raw20: 0 }
for (const g of graded("gates@1+cold", setName)) {
    if (g.record.stratum !== "miss") continue
    const q = g.record.question, user = g.record.user, isAB = bearing(g.record)
    const raw = bm25.search(q, 30, user).map((h) => h.path)
    const names = [...q.matchAll(/\b([A-Z][a-z]+)(?:\s+[A-Z]\.)?\s+([A-Z][a-z]+)/g)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()])
    const run = (col) => { const out = []; for (const [a, b] of names) { try { out.push(...stmt.all(`(${col} : "${a}" AND ${col} : "${b}") AND (${toBm25Query(q)})`, user, 10).map((r) => r.path)) } catch {} } return out.slice(0, 10) }
    const f = run("sender"), to = run("recipients")
    t.n++; t.raw10 += raw.slice(0, 10).some(isAB); t.raw30 += raw.some(isAB); t.from10 += f.some(isAB); t.to10 += to.some(isAB); t.either10 += [...f, ...to].some(isAB); t.raw20 += raw.slice(0, 20).some(isAB); t.union += [...raw.slice(0, 20), ...f, ...to].some(isAB)
}
console.log(t)
