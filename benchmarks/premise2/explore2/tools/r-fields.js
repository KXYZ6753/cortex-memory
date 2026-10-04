// Offline: AB recall of global top 5 / mailbox top 5,10,30 for BM25 column weightings
// (subject, sender, recipients, body) on the dev misses and a hit sample.
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { openAll, DATA_DIR } from "./r-common.js"
const env = await openAll()
const W = { base: null, s3b2: [0, 0, 3, 2, 1, 1], s2: [0, 0, 2, 1, 1, 1], s2r0: [0, 0, 2, 1, 0.3, 1], r0: [0, 0, 1, 1, 0.3, 1], s5: [0, 0, 5, 2, 1, 1] }
const MS = 0.068
for (const [name, weights] of Object.entries(W)) {
    const bm = weights ? openBm25(join(DATA_DIR, "corpus.sqlite"), { weights }) : env.bm25
    const acc = { miss: { g5: 0, g1: 0, m5: 0, m10: 0, m30: 0, n: 0 }, hit: { g5: 0, g1: 0, m5: 0, m10: 0, m30: 0, n: 0 } }
    for (const r of env.records) {
        const a = acc[r.stratum]
        const ab = (p) => env.answerBearing(r, p)
        const g = bm.search(r.question, 5).map((h) => h.path)
        const m = bm.search(r.question, 30, r.user).map((h) => h.path)
        a.n++
        a.g1 += ab(g[0] ?? "") ? 1 : 0
        a.g5 += g.some(ab) ? 1 : 0
        const first = m.findIndex(ab) + 1
        a.m5 += first && first <= 5 ? 1 : 0
        a.m10 += first && first <= 10 ? 1 : 0
        a.m30 += first ? 1 : 0
    }
    const p = (s, k) => (100 * acc[s][k] / acc[s].n).toFixed(1)
    console.log(name.padEnd(6), ["g1", "g5", "m5", "m10", "m30"].map((k) => `${k} miss ${p("miss", k)} hit ${p("hit", k)}`).join(" | "))
}
