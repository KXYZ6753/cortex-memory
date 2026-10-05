// Offline: can a deterministic sentence scorer find the answer sentence in gates' context?
// Proxy answer sentence = sentence of the gold email with the most novel gold-answer words.
// node benchmarks/premise2/explore2/tools/n-evrecall.js S300-2 [ce]
import { join } from "node:path"
import { pool, loadTable, dataDir } from "./n-lib.js"
import { ensureEmailStore } from "../../agent-run.js"
import { contentWords, novelAnswerWords, splitFile } from "../../text.js"
import { loadReranker } from "../../rerank.js"
import { splitSentences, lexScore } from "../variants/n-evidence.js"
const [setName = "S300-2", useCe = ""] = process.argv.slice(2)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const { table, keys } = loadTable(setName, ["gates"])
const ce = useCe ? await loadReranker(join(dataDir, "..", "models")) : null
const stats = { n: 0, goldIn: 0, top1: 0, top3: 0, top5: 0, top8: 0, sents: 0, ansFound: 0 }
const byCorrect = { 1: { n: 0, top3: 0 }, 0: { n: 0, top3: 0 } }
let ceMs = 0
for (const q of keys) {
    const r = pool.byKey.get(q)
    if (r.stratum !== "hit") continue
    const g = table.get("gates").get(q)
    const paths = g.a.contextPaths
    stats.n++
    if (!paths.includes(r.path)) continue
    stats.goldIn++
    const novel = novelAnswerWords([r.gold], r.question)
    if (novel.length < 2) continue
    const all = paths.flatMap((p, i) => splitSentences(emails.emailOf(p)).map((s) => ({ s, i, p })))
    stats.sents += all.length
    const goldSents = all.filter((x) => x.p === r.path)
    const cov = (s) => { const w = new Set(contentWords(s)); return novel.filter((x) => w.has(x)).length / novel.length }
    const best = goldSents.reduce((a, b) => (cov(b.s) > cov(a.s) ? b : a), goldSents[0])
    if (!best || cov(best.s) < 0.5) continue
    stats.ansFound++
    let scored = all.map((x) => ({ ...x, score: lexScore(r.question, x.s) }))
    if (ce) {
        const pre = [...scored].sort((a, b) => b.score - a.score).slice(0, 40)
        const t = performance.now()
        const sc = await ce.score(r.question, pre.map((x) => x.s))
        ceMs += performance.now() - t
        scored = pre.map((x, i) => ({ ...x, score: sc[i] }))
    }
    scored.sort((a, b) => b.score - a.score)
    const rank = scored.findIndex((x) => x.p === best.p && x.s === best.s)
    // any gold-email sentence with coverage >= 0.5 counts
    const okRank = scored.findIndex((x) => x.p === r.path && cov(x.s) >= 0.5)
    for (const [k, name] of [[1, "top1"], [3, "top3"], [5, "top5"], [8, "top8"]]) if (okRank >= 0 && okRank < k) stats[name]++
    byCorrect[g.correct].n++; if (okRank >= 0 && okRank < 3) byCorrect[g.correct].top3++
}
console.log(stats, byCorrect, ce ? `ce ms/q ${(ceMs / stats.ansFound).toFixed(0)}` : "")
