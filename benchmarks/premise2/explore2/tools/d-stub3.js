// Worker d: offline stub of d3's g5-fusion path (no GPU). W0 probe 1 says YES, gates'
// answer is unsure (token logprob -0.5) -> x1 hands over to g5; the stubbed g5 model calls
// search_mailbox("<question words>") once, then answers. Checks that the search g5 saw is
// header-rerank(RRF(BM25 q, BM25 question)) for d3 and plain BM25 for x1, that W0/probes
// are identical, and that explore-only calls are untouched.
//   node benchmarks/premise2/explore2/tools/d-stub3.js S300-1 [limit]
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { byHeaderRank } from "../../explore/variants.js"
import { VARIANTS as D } from "../variants/d-agent.js"
import { VARIANTS as X } from "../variants/x-agent.js"
import { fromB64, QEMB_FILE } from "../variants/d-dense.js"

const dataDir = ".data/premise2"
const [setName, limit = 10, id = "d3"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const qvec = new Map()
for (const line of readFileSync(QEMB_FILE, "utf8").split("\n")) if (line) { const r = JSON.parse(line); qvec.set(r.key, fromB64(r.q)) }
const resources = new Map()
const rrf = (lists, k = 10) => { const s = new Map(); for (const l of lists) l.forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (k + i + 1))); return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p) }
const mk = (record, trace) => {
    let g5turn = 0
    return {
        dataDir, emailOf: emails.emailOf, bm25,
        search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        embedQuery: async () => qvec.get(record.questionKey),
        chatRaw: async (body) => {
            if (body.tools) {
                g5turn++
                if (g5turn === 1) return { message: { content: "", tool_calls: [{ function: { name: "search_mailbox", arguments: { query: trace.g5q } } }] } }
                trace.g5shown = body.messages.at(-1).content
                return { message: { content: "", tool_calls: [{ function: { name: "answer", arguments: { text: "stub" } } }] } }
            }
            const p = body.messages[0].content
            if (p.startsWith("Does the email below")) { trace.probes++; return { message: { content: "YES" }, logprobs: [{ token: "YES", logprob: -0.01, top_logprobs: [{ token: "YES", logprob: -0.01 }] }] } }
            return { message: { content: "stub answer" }, done_reason: "stop", logprobs: [{ token: "stub", logprob: -0.5, top_logprobs: [] }] }
        },
        generate: async () => ({ status: "ok", answer: "stub" }),
    }
}
let n = 0, ok = 0, fused = 0
for (const key of set.questionKeys.slice(0, Number(limit))) {
    const record = pool.byKey.get(key)
    const g5q = record.question.split(/\s+/).slice(2, 7).join(" ")
    const tx = { probes: 0, g5q }, td = { probes: 0, g5q }
    const ox = await X.x1.run(mk(record, tx), record)
    const od = await D[id].run(mk(record, td), record)
    n++
    fused += od.dG5Fused === 1; if (process.env.SHOW) console.log("dG5Fused", od.dG5Fused, Object.keys(od).filter(k => k.startsWith("d")))
    const expectX = byHeaderRank(g5q, bm25.search(g5q, 20, record.user).map((h) => h.path), emails.emailOf)
    const expectD = byHeaderRank(g5q, rrf([bm25.search(g5q, 20, record.user).map((h) => h.path), bm25.search(record.question, 20, record.user).map((h) => h.path)]).slice(0, 20), emails.emailOf)
    const firstFull = (text) => (text.match(/^\[1\]\n([\s\S]{0,300})/m)?.[1] ?? "")
    const good = ox.step === "commit-g5" && od.step === "commit-g5" && tx.probes === td.probes
        && emails.emailOf(expectX[0]).startsWith(firstFull(tx.g5shown).slice(0, 200)) && emails.emailOf(expectD[0]).startsWith(firstFull(td.g5shown).slice(0, 200))
    ok += good
    if (process.env.SHOW) console.log(key, ox.step, od.step, good, expectX[0], expectD[0])
}
console.log({ n, ok, fused })
bm25.close(); process.exit(0)
