// Worker c: run a c-* variant with a stub generator (no GPU) and check prompts.
//   node .../c-stub.js <variant> <set> [n] [show] [yes=first|none|sure|unsure]
// The stub answers YES/NO probes ("yes" mode: YES on the first probe, or never), and
// answers everything else with a fixed text whose logprobs make it sure / unsure (x1's
// routing). For c-x*/c-g* it also runs the base variant (x1 / gates) on the same stub and
// reports, per question, how many prompts differ and whether every differing prompt is a
// sandwich answer prompt that parses back (parseSandwich) to the same emails.
import { VARIANTS as R } from "../variants/c-render.js"
import { VARIANTS as A, parseSandwich } from "../variants/c-agent.js"
import { VARIANTS as X } from "../variants/x-agent.js"
import { VARIANTS as BASE, sandwichPrompt } from "../../explore/variants.js"
import { loadSet } from "../../explore/sets.js"
import { openBm25 } from "../../bm25.js"
import { join } from "node:path"
import { pool, dataDir, emails, closeEmails } from "./c-lib.js"
const [id, setName, nArg = "5", show = "", yesMode = "first"] = process.argv.slice(2)
const all = { ...R, ...A, x1: X.x1, gates: BASE.gates }
const store = await emails()
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
function makeCtx(log) {
    let probes = 0
    const reply = (prompt) => {
        if (/^Does the email below contain the information/.test(prompt)) { probes++; return yesMode === "none" ? "NO" : probes === 1 ? "YES" : "NO" }
        return "The stub answer."
    }
    const ctx = {
        dataDir, bm25, emailOf: store.emailOf, emailMap: { get: store.emailOf },
        search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path),
        resource: async (name, loader) => { if (!resources.has(name)) resources.set(name, await loader()); return resources.get(name) },
        generate: async ({ prompt, messages }) => { const p = prompt ?? JSON.stringify(messages); log.push(p); return { status: "ok", answer: reply(p) } },
        chatRaw: async (body) => {
            const p = body.messages?.length === 1 ? body.messages[0].content : JSON.stringify(body.messages)
            log.push(p)
            if (body.tools) return { message: { content: "", tool_calls: [{ function: { name: "answer", arguments: { text: "stub" } } }] }, done_reason: "stop" }
            const text = reply(p)
            const lp = yesMode === "unsure" ? -0.5 : -0.01
            return { message: { content: text }, done_reason: "stop", logprobs: [{ token: text.split(" ")[0], logprob: lp, top_logprobs: [{ token: text.split(" ")[0], logprob: lp }] }] }
        },
    }
    return ctx
}
const baseOf = { "c-gT": "gates", "c-xT": "x1" }
let k = 0
for (const key of loadSet(dataDir, setName, pool).questionKeys) {
    const r = pool.byKey.get(key)
    if (id.startsWith("c-gold") && r.stratum !== "hit") continue
    if (k++ >= Number(nArg)) break
    const log = []
    const out = await all[id].run(makeCtx(log), r)
    let line = `${key} calls=${log.length} step=${out.step ?? "-"} c=${JSON.stringify(out.c ?? {})}`
    const base = baseOf[id] ?? (id.startsWith("c-g") && !id.startsWith("c-gold") ? "gates" : id.startsWith("c-x") ? "x1" : null)
    if (base) {
        const blog = []
        await all[base].run(makeCtx(blog), r)
        const diff = log.map((p, i) => [p, blog[i]]).filter(([a, b]) => a !== b)
        const okDiff = diff.every(([, b]) => parseSandwich(b) !== null)
        line += ` | vs ${base}: calls ${blog.length}, differing prompts ${diff.length}, all differing are sandwich answers: ${okDiff}`
    }
    if (out.renders) line += ` renders=${Object.entries(out.renders).map(([n, v]) => `${n}:${v.copied ? "copy" : "call"}`).join(",")}`
    console.log(line)
    if (show) for (const p of log) console.log(`-----\n${p.length > 5000 ? p.slice(0, 1200) + "\n...\n" + p.slice(-2500) : p}`)
}
bm25.close(); closeEmails(); for (const v of resources.values()) v?.close?.()
process.exit(0)
