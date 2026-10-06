// e: offline stub run of e1 (no GPU): forces the commit-g5 disagreement path to exercise the code.
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS } from "../variants/e-ens.js"
const dataDir = ".data/premise2"
const pool = loadPool(dataDir)
const set = loadSet(dataDir, "S300-2", pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
const msg = (t, l = -0.01, tops = null) => ({ message: { content: t }, done_reason: "stop", logprobs: t.split(" ").map((w, i) => ({ token: w, logprob: l, top_logprobs: i === 0 && tops ? tops : [{ token: w, logprob: l }] })) })
for (const key of set.questionKeys.slice(0, 6)) {
    const record = pool.byKey.get(key)
    let calls = []
    const ctx = { dataDir, emailOf: emails.emailOf, bm25, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        chatRaw: async (body) => {
            const p = body.messages?.[0]?.content ?? ""
            calls.push(body.tools ? "tools" : p.slice(0, 20))
            if (body.tools) return { message: { content: "Lunch with Bob on Friday at noon." }, done_reason: "stop" }
            if (p.startsWith("Decide which")) return msg("A", -0.2, [{ token: "A", logprob: -0.2 }, { token: "B", logprob: -1.7 }])
            if (p.startsWith("You answer")) return msg("The meeting is on Tuesday in room 5.", -1)
            return msg("YES", -0.01, [{ token: "YES", logprob: -0.01 }, { token: "NO", logprob: -4 }])
        },
        generate: async ({ prompt }) => { calls.push("gen:" + (prompt ?? "").slice(0, 20)); return { status: "ok", answer: prompt.includes("\nEmails:\n") && prompt.indexOf("Rules") > prompt.indexOf("Emails:") ? "It is on Tuesday, room 5." : "Lunch with Bob on Friday at noon." } } }
    const out = await VARIANTS.e1.run(ctx, record)
    console.log(key, out.step, out.eStep, out.pick, "|", out.answer, "| o4:", out.o4Answer, "| r5:", out.r5Answer, JSON.stringify(out.choose?.o1), out.choose?.g5Score, "calls", calls.length)
}
bm25.close(); process.exit(0)
