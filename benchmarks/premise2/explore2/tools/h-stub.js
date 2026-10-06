// Worker h (round 4): offline stub run of h7/h8 (no GPU). Probes: W0 emails at the
// positions in `yesAt` (comma list) say YES; gates' answer is unsure (lp -0.3); the
// single read / YES-context read get `lp2` and the text `ans2`; the specificity re-ask
// answers "The Association of Oil Pipe Lines website (AOPL)". Checks routing and that the
// re-ask prompt holds exactly the YES email(s).
//   node benchmarks/premise2/explore2/tools/h-stub.js S300-2 h8 [limit] [yesAt] [lp2] [ans2]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS } from "../variants/h-spec.js"
import { VARIANTS as G } from "../variants/g-agent.js"
const dataDir = ".data/premise2"
const [setName, id, limit = 10, yesAtArg = "0,2", lp2 = "-0.3", ans2 = "It will be on the website."] = process.argv.slice(2)
const yesAt = new Set(yesAtArg.split(",").map(Number))
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
const steps = {}, specs = {}
let g5calls = 0, specPromptOk = 0, specFired = 0, kinds = {}
const realG5 = G.g5
for (const key of set.questionKeys.slice(0, Number(limit))) {
    const record = pool.byKey.get(key)
    let probeN = 0, gatesDone = false
    const tok = (t, l, n = 3) => ({ message: { content: t }, done_reason: "stop", logprobs: Array.from({ length: n }, () => ({ token: "x", logprob: l, top_logprobs: [{ token: t.split(" ")[0], logprob: l }, { token: "NO", logprob: -3 }] })) })
    let lastSpec = null
    const ctx = { dataDir, emailOf: emails.emailOf, bm25, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        chatRaw: async (body) => {
            const p = body.messages[0].content
            const nEmails = (p.match(/^\[\d\]$/gm) ?? []).length
            if (p.startsWith("Does the email below")) { const y = yesAt.has(probeN++); kinds.probe = (kinds.probe ?? 0) + 1; return tok(y ? "YES" : "NO", -0.01) }
            if (p.startsWith("Find the exact detail")) { lastSpec = p; kinds.spec = (kinds.spec ?? 0) + 1; return tok("The Association of Oil Pipe Lines website (AOPL).", -0.2, 6) }
            if (!gatesDone) { gatesDone = true; kinds.gates = (kinds.gates ?? 0) + 1; return tok("Something on the website.", -0.3, 5) }
            kinds[`read${nEmails}`] = (kinds[`read${nEmails}`] ?? 0) + 1
            return tok(ans2, Number(lp2), 5)
        },
        generate: async () => ({ status: "ok", answer: "1" }) }
    G.g5 = { ...realG5, run: async () => { g5calls++; return { status: "ok", answer: "It is something.", contextPaths: [], readPaths: [] } } }
    const out = await VARIANTS[id].run(ctx, record)
    steps[out.step] = (steps[out.step] ?? 0) + 1
    if (out.spec?.fired) {
        specFired++
        const want = out.spec.paths
        if (want.every((p) => lastSpec.includes(emails.emailOf(p))) && (lastSpec.match(/^\[\d\]$/gm) ?? []).length === want.length) specPromptOk++
        specs[`n${want.length} acc${out.spec.accepted}`] = (specs[`n${want.length} acc${out.spec.accepted}`] ?? 0) + 1
    }
    if (process.env.SHOW) console.log(key, out.step, out.h?.yesPaths?.length, out.answer)
}
G.g5 = realG5
console.log({ id, steps, g5calls, specFired, specPromptOk, specs, kinds })
bm25.close(); process.exit(0)
