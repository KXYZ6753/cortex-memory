// Worker l: dry run of a variant with a fake model (no GPU): checks code paths and counts
// verification calls per question. chatRaw returns a random YES/NO first-token distribution.
//   node benchmarks/premise2/explore2/tools/l-stub.js <variant> <set> [n]
import { join } from "node:path"
import { loadVariants } from "../registry.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { ensureEmailStore } from "../../agent-run.js"
import { openBm25 } from "../../bm25.js"
import { mulberry32 } from "./rng.js"

const [id, setName, n = "10"] = process.argv.slice(2)
const dataDir = ".data/premise2"
const V = await loadVariants()
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
const rnd = mulberry32(7)
const prompts = []
for (const key of set.questionKeys.slice(0, Number(n))) {
    const record = pool.byKey.get(key)
    let calls = 0, chars = 0
    const ctx = {
        dataDir, emailOf: emails.emailOf, emailMap: { get: emails.emailOf }, bm25,
        search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path),
        resource: async (name, loader) => { if (!resources.has(name)) resources.set(name, await loader()); return resources.get(name) },
        chatRaw: async (body) => { calls++; const c = body.messages.map((m) => m.content).join(""); chars += c.length; prompts.push(c); const y = -rnd() * 3, no = -rnd() * 3; return { message: { content: y > no ? "YES" : "NO" }, logprobs: [{ token: y > no ? "YES" : "NO", logprob: Math.max(y, no), top_logprobs: [{ token: "YES", logprob: y }, { token: "NO", logprob: no }, { token: "Yes", logprob: y - 3 }] }], prompt_eval_count: Math.round(c.length / 3.5) } },
        generate: async ({ prompt }) => { calls++; chars += prompt?.length ?? 0; prompts.push(prompt); return { status: "ok", answer: "stub answer" } },
    }
    const r = await V[id].run(ctx, record)
    console.log(key, record.stratum, r.step, r.skipped ? "skipped" : `picked ${r.picked} unique ${r.uniqueCalls}`, `calls ${calls} kchars ${(chars / 1000).toFixed(1)}`, String(r.answer).slice(0, 60))
}
console.log("--- last prompt ---\n" + prompts.at(-1)?.slice(-700))
bm25.close(); emails.close()
