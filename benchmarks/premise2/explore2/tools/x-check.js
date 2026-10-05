// Worker x: offline stub run of x2/x3 (no GPU): first probe says YES with logprob `lp`,
// others NO; checks that the committed context equals stored p3 contextPaths.
//   node benchmarks/premise2/explore2/tools/x-check.js S300-2 x2 [limit] [lp]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers } from "../../explore/grade.js"
import { VARIANTS } from "../variants/x-agent.js"
const dataDir = ".data/premise2"
const [setName, id, limit = 300, lp = "-0.01"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const ref = new Map(latestAnswers(dataDir).filter((a) => a.set === setName && a.variant === "p3").map((a) => [a.questionKey, a]))
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
let same = 0, diff = 0, ms = 0, n = 0
const steps = {}
for (const key of set.questionKeys.slice(0, Number(limit))) {
    const record = pool.byKey.get(key)
    let probes = 0
    const tok = (t, l) => ({ message: { content: t }, done_reason: "stop", logprobs: [{ token: t, logprob: l, top_logprobs: [{ token: t, logprob: l }, { token: t === "YES" ? "NO" : "YES", logprob: -3 }] }] })
    const ctx = { dataDir, emailOf: emails.emailOf, bm25, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        chatRaw: async () => (probes++ === 0 ? tok("YES", Number(lp)) : tok("NO", -0.01)),
        generate: async () => ({ status: "ok", answer: "1" }) }
    const t = performance.now()
    const out = await VARIANTS[id].run(ctx, record)
    ms += performance.now() - t; n++
    steps[out.step] = (steps[out.step] ?? 0) + 1
    const stored = ref.get(key)
    if (stored && out.step === "commit") (JSON.stringify(stored.contextPaths) === JSON.stringify(out.contextPaths) ? same++ : (diff++, console.log("diff", key, out.swapped)))
}
console.log({ id, n, sameAsP3: same, diff, steps, meanMs: Math.round(ms / n) })
bm25.close(); process.exit(0)
