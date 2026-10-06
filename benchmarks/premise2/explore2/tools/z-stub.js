// z: stub check of the z variants (no GPU): fake chatRaw, real email store and stored x1.
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { ensureEmailStore } from "../../agent-run.js"
const dataDir = ".data/premise2"
process.env.Z_SET = process.argv[2] ?? "S300-2"
const ids = (process.argv[3] ?? "z-think1,z-ext1").split(",")
const files = new Set(ids.map((id) => (id.startsWith("z-") ? id : "")))
const mods = await Promise.all([...new Set(process.argv.slice(4).length ? process.argv.slice(4) : ["z-replay.js"])].map((f) => import(`../variants/${f}`)))
const V = Object.assign({}, ...mods.map((m) => m.VARIANTS))
const pool = loadPool(dataDir)
const set = loadSet(dataDir, process.env.Z_SET, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const resources = new Map()
let lastBody = null
const ctx = {
    dataDir, emailOf: emails.emailOf,
    resource: async (n, l) => (resources.has(n) ? resources.get(n) : (resources.set(n, await l()), resources.get(n))),
    chatRaw: async (body) => { lastBody = body; const c = body.format ? JSON.stringify({ email: 1, quote: "xx", answer: "stub" }) : "stub answer"; return { message: { content: c, thinking: body.think ? "hmm" : undefined }, done_reason: "stop", eval_count: 3 } },
    generate: async () => ({ status: "ok", answer: "stub" }),
    search: async () => [], bm25: null,
}
for (const id of ids) {
    const c = {}
    for (const key of set.questionKeys.slice(0, 300)) {
        const r = await V[id].run(ctx, pool.byKey.get(key))
        const k = `${r.x1Step} changed=${r.changed} fb=${r.fallback ?? ""} st=${r.status}`
        c[k] = (c[k] ?? 0) + 1
    }
    console.log(id, c, "lastPromptChars", JSON.stringify(lastBody?.messages ?? "").length, "think", lastBody?.think, "fmt", Boolean(lastBody?.format))
}
process.exit(0)
