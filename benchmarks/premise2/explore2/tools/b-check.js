// Worker b: stub check of the demo wrapper (no GPU, no model calls). Runs a b-* variant
// with a fake generator on a few questions and prints which calls got demos, the demo
// questions next to the real one, and the prompt sizes.
//   node benchmarks/premise2/explore2/tools/b-check.js <variant> [set=S300-2] [n=5] [quiet]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { loadVariants } from "../registry.js"
import { recordsOf, emails, dataDir } from "./b-lib.js"

const [id = "b-x4s", setName = "S300-2", n = "5", quiet] = process.argv.slice(2)
const VARIANTS = await loadVariants()
const store = await emails()
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
const stats = { calls: 0, demoCalls: 0, chars: [], demoChars: [] }
for (const record of recordsOf(setName).slice(0, Number(n))) {
    const calls = []
    const note = (kind, messages) => {
        const chars = messages.reduce((s, m) => s + m.content.length, 0)
        calls.push({ kind, turns: messages.length, chars, demoQs: messages.length > 1 ? messages.filter((m, i) => m.role === "user" && i < messages.length - 1).map((m) => m.content.split("\n")[2]) : [] })
        stats.calls++
        if (messages.length > 1 || messages[0].content.startsWith("Here are solved")) { stats.demoCalls++; stats.demoChars.push(chars) } else stats.chars.push(chars)
    }
    const ctx = {
        dataDir, bm25, emailOf: store.emailOf, emailMap: { get: store.emailOf },
        search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path),
        resource: async (name, loader) => { if (!resources.has(name)) resources.set(name, await loader()); return resources.get(name) },
        embedQuery: async () => { throw new Error("no embeddings in the stub") },
        generate: async ({ prompt, messages }) => { const m = messages ?? [{ role: "user", content: prompt }]; note("generate", m); return { status: "ok", answer: "Stub answer." } },
        chatRaw: async (body) => {
            if (body.tools) { note("tools", body.messages); return { message: { content: "", tool_calls: [{ function: { name: "answer", arguments: { text: "stub" } } }] } } }
            note("chatRaw", body.messages)
            return { message: { content: "YES" }, done_reason: "stop", logprobs: [{ token: "YES", logprob: Number(process.env.B_STUB_LP ?? -0.01), top_logprobs: [{ token: "YES", logprob: -0.01 }, { token: "NO", logprob: -5 }] }] }
        },
    }
    const out = await VARIANTS[id].run(ctx, record)
    if (quiet) continue
    console.log(`\n# ${record.questionKey} (${record.user}) Q: ${record.question}`)
    console.log(`  step ${out.step ?? "-"} demos ${JSON.stringify(out.bDemo)}`)
    for (const c of calls) {
        console.log(`  ${c.kind} turns ${c.turns} chars ${c.chars}`)
        for (const q of c.demoQs) console.log(`     demo ${q}`)
    }
}
const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
console.log(`\n${id}: calls ${stats.calls}, with demos ${stats.demoCalls}; chars median with demos ${med(stats.demoChars)} max ${Math.max(...stats.demoChars)}; without ${med(stats.chars)}`)
bm25.close()
