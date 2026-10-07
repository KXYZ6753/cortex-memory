// Worker d: offline stub run of the d variants (no GPU, no Ollama). Every W0 probe says
// NO (forces x1's explore path), picks answer "1", the plan search is fixed, answers are
// "stub". Query vectors come from <scratch>/d-qemb.jsonl (the vectors ctx.embedQuery
// returns). Checks: (1) the d variant's W0 / commit probes are x1's; (2) its first pick
// list is the CE top 15 of W1 ∪ BM25 top 30 ∪ extras (W0 excluded), i.e. the lab's list;
// (3) the extras were computed once per question.
//   node benchmarks/premise2/explore2/tools/d-stub.js S300-1 d1 [limit]
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS as D } from "../variants/d-agent.js"
import { VARIANTS as X } from "../variants/x-agent.js"
import { fromB64, QEMB_FILE } from "../variants/d-dense.js"

const dataDir = ".data/premise2"
const [setName, id, limit = 20] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const qvec = new Map()
for (const line of readFileSync(QEMB_FILE, "utf8").split("\n")) if (line) { const r = JSON.parse(line); qvec.set(r.key, fromB64(r.q)) }
const resources = new Map()
const tok = (t) => ({ message: { content: t }, done_reason: "stop", logprobs: [{ token: t, logprob: -0.01, top_logprobs: [{ token: t, logprob: -0.01 }] }] })
const mkCtx = (record, trace) => ({
    dataDir, emailOf: emails.emailOf, bm25,
    search: async (q, k, u = null) => { trace.searches.push([q === record.question ? "Q" : q.slice(0, 20), k, u]); return bm25.search(q, k, u).map((h) => h.path) },
    resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
    embedQuery: async (text) => { trace.embeds++; if (text !== record.question) throw new Error("unexpected embed text"); return qvec.get(record.questionKey) },
    chatRaw: async (body) => { const p = body.messages[0].content; if (p.startsWith("Does the email below")) { trace.probes.push(p.length); return tok("NO") } return tok("stub") },
    generate: async ({ prompt }) => {
        if (prompt.includes("Write a search for it")) return { status: "ok", answer: "FROM: | TO: | ABOUT: contract" }
        if (prompt.includes("Email number:")) { trace.picks.push(prompt); return { status: "ok", answer: "1" } }
        return { status: "ok", answer: "stub" }
    },
})
let same = 0, n = 0, oneEmbed = 0, firstListSame = 0
for (const key of set.questionKeys.slice(0, Number(limit))) {
    const record = pool.byKey.get(key)
    const tx = { searches: [], probes: [], picks: [], embeds: 0 }, td = { searches: [], probes: [], picks: [], embeds: 0 }
    const ox = await X.x1.run(mkCtx(record, tx), record)
    const od = await D[id].run(mkCtx(record, td), record)
    n++
    if (JSON.stringify(tx.probes.slice(0, 5)) === JSON.stringify(td.probes.slice(0, 5)) && JSON.stringify(ox.contextPaths.slice(0, 4)) === JSON.stringify(od.contextPaths.slice(0, 4))) same++
    if (td.embeds === 1) oneEmbed++
    const lx = ox.log.find((l) => l.act === "pick")?.listed ?? [], ld = od.log.find((l) => l.act === "pick")?.listed ?? []
    if (JSON.stringify(lx) === JSON.stringify(ld)) firstListSame++
    if (process.env.SHOW) console.log(key, "added", od.dAdded?.length, "extraMs", od.dExtraMs, "first list changed", JSON.stringify(lx) !== JSON.stringify(ld), "AB-free check: x1 list", lx.length, "d list", ld.length)
}
console.log({ id, n, sameProbesAndW0top4: same, oneEmbed, firstListUnchanged: firstListSame })
bm25.close(); process.exit(0)
