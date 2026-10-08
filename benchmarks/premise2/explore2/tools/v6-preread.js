// v6 (aux): pre-compute QA reads on i-det-gates' read emails for the det test sets (answer-independent).
//   node v6-preread.js <sets> [hit|all]
import { join } from "node:path"
import { openV6, readCache, appendCache, OUT } from "./v6-lib.js"
import { loadQA, QA_MODEL } from "../variants/v6-common.js"
const [setsArg = "S300-4,S300-5,FULL-2,FULL-3", which = "hit"] = process.argv.slice(2)
const env = await openV6()
const file = join(OUT, "v6-qa.jsonl")
const cache = readCache(file)
const qa = await loadQA({ threads: Number(process.env.V6_THREADS ?? 4) })
let n = 0, reads = 0
const t0 = performance.now()
for (const set of setsArg.split(",")) {
    for (const key of env.setKeys(set)) {
        const rec = env.pool.byKey.get(key)
        if (which === "hit" && rec.stratum !== "hit") continue
        const g = env.bySet.get(set)?.get(key)?.["i-det-gates"]
        if (!g) continue
        for (const path of new Set([...(g.readPaths ?? g.contextPaths ?? [])])) {
            const k = `${key}|${path}`
            if (cache.has(k)) continue
            const t = performance.now()
            const r = await qa.read(rec.question, [env.emails.emailOf(path) ?? ""])
            const out = { k, model: QA_MODEL, ms: Math.round(performance.now() - t), windows: r.windows, null: Math.max(...r.nulls), spans: r.spans.slice(0, 40).map((s) => [s.text, Math.round(s.score * 1000) / 1000]) }
            appendCache(file, out)
            cache.set(k, out)
            reads++
        }
        if (++n % 100 === 0) console.log(`${set} ${n} questions, ${reads} reads, ${((performance.now() - t0) / 1000).toFixed(0)} s`)
    }
}
console.log(`done ${n} questions, ${reads} reads`)
