// Offline: for questions the confidence trigger fires on (n-lp0 first answer: abstain,
// hedge or mean logprob < tau), is an answer-bearing (gold) email in the retry context?
// fresh = other context then header-ranked mailbox, unseen only; ce = MiniLM over unseen
// mailbox BM25 top 30 + global 6-20.
import { join } from "node:path"
import { pool, loadTable, dataDir } from "./n-lib.js"
import { ensureEmailStore } from "../../agent-run.js"
import { openBm25 } from "../../bm25.js"
import { byHeaderRank } from "../../explore/variants.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { HEDGE } from "../variants/n-conf.js"
import { isAbstain } from "../../prompts.js"
const [setName = "S300-2", tauArg = "-0.2"] = process.argv.slice(2)
const tau = Number(tauArg)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const ce = await loadReranker(join(dataDir, "..", "models"))
const { table, keys } = loadTable(setName, ["n-lp0", "gates"])
const S = { hit: {}, miss: {} }
const inc = (st, k) => (S[st][k] = (S[st][k] ?? 0) + 1)
for (const q of keys) {
    const r = pool.byKey.get(q), a = table.get("n-lp0").get(q).a
    const l = a.lp.gates.lps, m = l.reduce((x, y) => x + y, 0) / Math.max(1, l.length)
    if (!(isAbstain(a.lp.gates.answer) || m < tau || HEDGE.test(a.lp.gates.answer))) continue
    const ab = new Set([r.path, ...(r.twins ?? [])])
    const has = (paths) => paths.some((p) => ab.has(p))
    inc(r.stratum, "trig"); if (table.get("gates").get(q).correct) inc(r.stratum, "gatesRight")
    const ctx0 = a.contextPaths
    if (has(ctx0)) inc(r.stratum, "goldInFirst")
    const global = bm25.search(r.question, 20, null).map((h) => h.path)
    const mbox = bm25.search(r.question, 30, r.user).map((h) => h.path)
    const switched = a.switched
    const hdr = byHeaderRank(r.question, mbox.slice(0, 20), emails.emailOf)
    const other = switched ? global.slice(0, 5) : hdr.slice(0, 5)
    const fresh = [...new Set([...other, ...hdr])].filter((p) => !ctx0.includes(p)).slice(0, 5)
    if (has(fresh)) inc(r.stratum, "goldInFresh")
    const cands = [...new Set([...mbox, ...global.slice(5)])].filter((p) => !ctx0.includes(p))
    const sc = await ce.score(r.question, cands.map((p) => rerankText(emails.emailOf(p))))
    const ceTop = cands.map((p, i) => [p, sc[i]]).sort((x, y) => y[1] - x[1]).map((x) => x[0]).slice(0, 5)
    if (has(ceTop)) inc(r.stratum, "goldInCE5")
    if (has([...new Set([...ceTop.slice(0, 3), ...fresh])].slice(0, 5))) inc(r.stratum, "goldInMix")
}
console.log(`tau ${tau}`, S)
bm25.close(); emails.close()
