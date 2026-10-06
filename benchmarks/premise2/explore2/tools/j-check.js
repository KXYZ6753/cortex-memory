// Worker j: offline stub run of j1/j2 (no GPU). The first probe says YES; gates' answer
// gets logprob `lp` (unsure if < -0.1); the single-email answer gets `lp2`. Checks the
// routing and that the single-email prompt holds exactly the YES email.
//   node benchmarks/premise2/explore2/tools/j-check.js S300-2 j1 [limit] [lp] [lp2]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS } from "../variants/j-reread.js"
import { VARIANTS as G } from "../variants/g-agent.js"
const dataDir = ".data/premise2"
const [setName, id, limit = 20, lp = "-0.3", lp2 = "-0.05"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
const steps = {}
let g5calls = 0, singleOk = 0
const realG5 = G.g5
for (const key of set.questionKeys.slice(0, Number(limit))) {
    const record = pool.byKey.get(key)
    let call = 0
    const tok = (t, l, n = 1) => ({ message: { content: t }, done_reason: "stop", logprobs: Array.from({ length: n }, () => ({ token: "x", logprob: l, top_logprobs: [{ token: t, logprob: l }, { token: t === "YES" ? "NO" : "YES", logprob: -3 }] })) })
    let lastSinglePrompt = null
    const ctx = { dataDir, emailOf: emails.emailOf, bm25, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        chatRaw: async (body) => {
            call++
            if (call === 1) return tok("YES", -0.01)
            if (call === 2) return tok("gates answer", Number(lp), 5)
            lastSinglePrompt = body.messages[0].content
            return tok("single answer", Number(lp2), 5)
        },
        generate: async () => ({ status: "ok", answer: "1" }) }
    G.g5 = { ...realG5, run: async () => { g5calls++; return { status: "ok", answer: "g5 answer", contextPaths: [], readPaths: [] } } }
    const out = await VARIANTS[id].run(ctx, record)
    steps[out.step] = (steps[out.step] ?? 0) + 1
    if (out.step === "commit-single" && lastSinglePrompt.includes(emails.emailOf(out.j.yesPath)) && (lastSinglePrompt.match(/^\[\d\]$/gm) ?? []).length === 1) singleOk++
}
G.g5 = realG5
console.log({ id, steps, g5calls, singleOk })
bm25.close(); process.exit(0)
