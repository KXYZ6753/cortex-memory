// Worker m: CPU time of recoveryLists (CE std + snippet over mailbox 50 + global 10) per question.
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { loadSet } from "../../explore/sets.js"
import { recoveryLists, x1Contexts } from "../variants/m-agent.js"
const { pool, emails } = await openAll()
const bm25 = openBm25(".data/premise2/corpus.sqlite")
const resources = new Map()
const ctx = { dataDir: ".data/premise2", emailOf: emails.emailOf, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
    resource: async (n, l) => { if (!resources.has(n)) resources.set(n, await l()); return resources.get(n) } }
const keys = loadSet(".data/premise2", "S100-1", pool).questionKeys.slice(0, 40)
const ts = []
for (const k of keys) { const r = pool.byKey.get(k); const { W0 } = await x1Contexts(ctx, r); const t = performance.now(); await recoveryLists(ctx, r, W0); ts.push(performance.now() - t) }
ts.shift(); ts.sort((a, b) => a - b)
console.log(`recoveryLists ms: mean ${Math.round(ts.reduce((a, b) => a + b) / ts.length)}, median ${Math.round(ts[ts.length >> 1])}, p90 ${Math.round(ts[Math.floor(ts.length * 0.9)])}`)
process.exit(0)
