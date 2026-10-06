// Worker m: dry-run a variant with a stubbed model (no Ollama): checks code paths offline.
//   node benchmarks/premise2/explore2/tools/m-dry.js <variant> <set> [n]
import { join } from "node:path"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { loadSet } from "../../explore/sets.js"
import { loadVariants } from "../registry.js"
const [id, set = "S100-0", n = "3"] = process.argv.slice(2)
const { pool, emails } = await openAll()
const V = await loadVariants()
const bm25 = openBm25(".data/premise2/corpus.sqlite")
const resources = new Map()
let calls = 0
const fake = (prompt) => {
    calls++
    const yes = Math.random() < 0.3
    const ans = /YES or NO/.test(prompt) ? (yes ? "YES" : "NO") : /1 or 2/.test(prompt) ? "1" : /^\d/.test("") ? "" : (Math.random() < 0.5 ? "3" : "Some answer text.")
    return { message: { content: ans }, done_reason: "stop", logprobs: [{ token: ans.split(" ")[0], logprob: -0.1, top_logprobs: [{ token: "YES", logprob: -0.2 }, { token: "NO", logprob: -1.7 }, { token: "1", logprob: -0.3 }, { token: "2", logprob: -1.5 }] }] }
}
const ctx = {
    dataDir: ".data/premise2", bm25, emailOf: emails.emailOf, emailMap: { get: emails.emailOf },
    search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path),
    resource: async (name, loader) => { if (!resources.has(name)) resources.set(name, await loader()); return resources.get(name) },
    chatRaw: async (body) => fake(body.messages?.at(-1)?.content ?? ""),
    generate: async ({ prompt, messages }) => { const d = fake(prompt ?? messages?.at(-1)?.content ?? ""); return { status: "ok", answer: d.message.content } },
}
const keys = loadSet(".data/premise2", set, pool).questionKeys.slice(0, +n)
for (const key of keys) {
    const t = performance.now()
    const r = id.startsWith("fn:") ? await (await import("../variants/m-agent.js")).mAgent(ctx, pool.byKey.get(key), JSON.parse(id.slice(3), (k, v) => (typeof v === "string" && v.startsWith("=>") ? eval(v.slice(2)) : v))) : await V[id].run(ctx, pool.byKey.get(key))
    console.log(key, Math.round(performance.now() - t), "ms", calls, "calls", r.step ?? "", r.recovered ?? "", JSON.stringify(r.contextPaths), JSON.stringify(r).slice(0, 300))
}
process.exit(0)
