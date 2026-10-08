// v6 (aux): run the extractive QA encoder (CPU) over the evidence emails of pool questions and cache
// the top spans per (questionKey, email path) in .data/premise2/explore/v6-qa.jsonl.
//   node v6-read.js <A|B> <mixed|differ|all> [limit] [sets]
// "differ" = questions whose candidate texts differ (>= 2 candidates); "mixed" = some right, some wrong.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { openV6, readCache, appendCache, OUT } from "./v6-lib.js"
import { loadQA, QA_MODEL } from "../variants/v6-common.js"

const [poolName = "A", which = "mixed", limitArg, setsArg] = process.argv.slice(2)
const limit = limitArg ? Number(limitArg) : Infinity
const sets = setsArg ? setsArg.split(",") : null
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const cacheFile = join(OUT, "v6-qa.jsonl")
const cache = readCache(cacheFile)
const env = await openV6()
const qa = await loadQA()
let qs = pools[poolName].filter((q) => (!sets || sets.includes(q.set)))
if (which === "mixed") qs = qs.filter((q) => q.cands.some((c) => c.correct) && q.cands.some((c) => !c.correct))
else if (which === "differ") qs = qs.filter((q) => q.cands.length >= 2)
qs = qs.slice(0, limit)
let done = 0, reads = 0, ms = 0, windows = 0
const t0 = performance.now()
for (const q of qs) {
    for (const path of q.evidence) {
        const k = `${q.key}|${path}`
        if (cache.has(k)) continue
        const text = env.emails.emailOf(path) ?? ""
        const t = performance.now()
        const r = await qa.read(q.question, [text])
        const dt = performance.now() - t
        const rec = { k, model: QA_MODEL, ms: Math.round(dt), windows: r.windows, null: Math.max(...r.nulls), spans: r.spans.slice(0, 40).map((s) => [s.text, Math.round(s.score * 1000) / 1000]) }
        appendCache(cacheFile, rec)
        cache.set(k, rec)
        reads++; ms += dt; windows += r.windows
    }
    done++
    if (done % 25 === 0) console.log(`${done}/${qs.length} questions, ${reads} reads, ${(ms / Math.max(1, reads)).toFixed(0)} ms/read, ${(ms / Math.max(1, windows)).toFixed(0)} ms/window, elapsed ${((performance.now() - t0) / 1000).toFixed(0)} s`)
}
console.log(`done ${done} questions, ${reads} new reads, ${(ms / Math.max(1, reads)).toFixed(0)} ms/read, ${(windows / Math.max(1, reads)).toFixed(1)} windows/read`)
env.emails.close?.()
