// Offline (no GPU): where gold sits in gates' candidate lists on FULL-0, by gates outcome.
// node benchmarks/premise2/explore2/tools/w-ranks.js <failures.json from o-failures.js>
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { byHeaderRank } from "../../explore/variants.js"
const dataDir = ".data/premise2"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const tally = {}
const add = (k) => (tally[k] = (tally[k] ?? 0) + 1)
for (const r of rows) {
    if (!r.gates) continue
    const gold = (p) => p === r.path || (r.twins ?? []).includes(p)
    const global = bm25.search(r.question, 20, null).map((h) => h.path)
    const mbox = bm25.search(r.question, 50, r.user).map((h) => h.path)
    const hdr = byHeaderRank(r.question, mbox.slice(0, 20), emails.emailOf)
    const switched = !global[0]?.startsWith(`${r.user}/`)
    const ctx0 = switched ? hdr.slice(0, 5) : global.slice(0, 5)
    const ctx1 = switched ? global.slice(0, 5) : hdr.slice(0, 5)
    const cand10 = [...new Set([...ctx0, ...ctx1])]
    const posIn = (list) => list.findIndex(gold)
    const g = r.gates.correct ? "ok" : "wrong"
    const where = posIn(ctx0) >= 0 ? `ctx0@${posIn(ctx0)}` : posIn(cand10) >= 0 ? "ctx1only" : posIn(hdr) >= 0 ? `hdr6-20` : posIn(mbox) >= 0 ? `mbox21-50` : "none"
    add(`${r.stratum} ${g} ${where.replace(/@\d/, (m) => (m === "@0" ? "@0" : "@1-4"))}`)
}
console.log(Object.entries(tally).sort().map((e) => e.join(": ")).join("\n"))
bm25.close(); emails.close()
