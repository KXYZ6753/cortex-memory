// Offline (no GPU): runs an h-variant with a stub generator (first call returns the stored
// s1 answer, probes say NO) to check that its first context equals s1's stored contextPaths.
//   node benchmarks/premise2/explore2/tools/h-check.js S300-2 h1 [limit]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers } from "../../explore/grade.js"
import { VARIANTS } from "../variants/h-hybrid.js"

const dataDir = ".data/premise2"
const [setName, id, limit = 300, ref = "s1"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const s1 = new Map(latestAnswers(dataDir).filter((a) => a.set === setName && a.variant === ref).map((a) => [a.questionKey, a]))
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
let same = 0, diff = 0, ms = 0, n = 0
for (const key of set.questionKeys.slice(0, Number(limit))) {
    const record = pool.byKey.get(key)
    const stored = s1.get(key)
    let calls = 0
    const ctx = { dataDir, emailOf: emails.emailOf, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        generate: async () => (calls++ === 0 ? { status: "ok", answer: stored?.answer ?? "stub" } : { status: "ok", answer: "NO" }) }
    const t = performance.now()
    const out = await VARIANTS[id].run(ctx, record)
    ms += performance.now() - t; n++
    if (stored) (JSON.stringify(stored.contextPaths) === JSON.stringify(out.contextPaths) ? same++ : (diff++, console.log("diff", key, out.swapped)))
}
console.log({ id, n, sameAsS1: same, diff, meanMs: Math.round(ms / n) })
bm25.close(); emails.close()
