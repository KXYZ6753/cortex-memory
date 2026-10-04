// Offline: MiniLM cross-encoder scores (CPU) for each dev question's mailbox top 30
// union global top 10, cached in <SCRATCH>/r-ce.json (resumable). Also records ms/question.
//   node benchmarks/premise2/explore2/tools/r-ce.js [limit]

import { join } from "node:path"
import { loadReranker, rerankText } from "../../rerank.js"
import { openAll, SCRATCH, readJsonIf, writeJsonFile, DATA_DIR } from "./r-common.js"

const limit = Number(process.argv[2] ?? Infinity)
const tag = process.env.R_TAG ?? ""
const features = readJsonIf(join(SCRATCH, `r-features${tag}.json`), [])
const file = join(SCRATCH, `r-ce${tag}.json`)
const cache = readJsonIf(file, {})
// Scores already computed for the untagged candidates are reused (same model, same text).
const base = tag ? readJsonIf(join(SCRATCH, "r-ce.json"), {}) : {}
const env = await openAll()
const reranker = await loadReranker(join(DATA_DIR, "..", "models"))
let done = 0
let ms = 0
// Misses first: they matter most for recall, and a partial run is still informative.
const order = [...features].sort((a, b) => (a.stratum === b.stratum ? 0 : a.stratum === "miss" ? -1 : 1))
for (const f of order) {
    if (cache[f.key]) continue
    if (done >= limit) break
    const paths = [...new Set([...f.mailbox.map((x) => x[0]).slice(0, 30), ...f.global.map((x) => x[0]).slice(0, 10)])]
    const known = base[f.key]?.s ?? {}
    const todo = paths.filter((path) => known[path] === undefined)
    const started = performance.now()
    const scores = todo.length ? await reranker.score(f.question, todo.map((path) => rerankText(env.emailOf(path)))) : []
    const took = performance.now() - started
    ms += took
    const fresh = Object.fromEntries(todo.map((path, i) => [path, +scores[i].toFixed(3)]))
    cache[f.key] = { ms: Math.round(took), s: Object.fromEntries(paths.map((path) => [path, known[path] ?? fresh[path]])) }
    done++
    if (done % 50 === 0) {
        writeJsonFile(file, cache)
        console.log(`${done} done, mean ${Math.round(ms / done)} ms/question (${paths.length} pairs)`)
    }
}
writeJsonFile(file, cache)
console.log(`finished ${done}, mean ${Math.round(ms / Math.max(done, 1))} ms`)
