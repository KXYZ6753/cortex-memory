// Offline (p): MiniLM cross-encoder scores (CPU) per question for the asker's mailbox
// BM25 top 50 + global BM25 top 10 (+ dense candidates from pdense diagnostics when
// present), cached in <SCRATCH>/p-ce-<mode>.json (resumable). Reuses r's r-ce.json for
// the standard text. Pool records only.
//   node benchmarks/premise2/explore2/tools/p-ce.js <mode std|snip> <sets...>
// mode std  = rerank.js rerankText (Subject + Sender + body start, 1600 chars)
// mode snip = Subject + Sender + the 1600-char body window covering the most question
//             content words (only differs for bodies > 1600 chars)

import { join } from "node:path"
import { loadReranker, rerankText } from "../../rerank.js"
import { openAll, SCRATCH, readJsonIf, writeJsonFile, DATA_DIR } from "./r-common.js"
import { snippetText, denseLists } from "./p-common.js"

const [mode = "std", ...sets] = process.argv.slice(2)
process.env.R_ALLOW_HELDOUT = "1" // S300-2 is the screening set: offline simulation of contexts only, no tuning there
const env = await openAll({ sets })
const file = join(SCRATCH, `p-ce-${mode}.json`)
const cache = readJsonIf(file, {})
const base = mode === "std" ? readJsonIf(join(SCRATCH, "r-ce.json"), {}) : readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
const dense = denseLists()
const textOf = mode === "snip" ? snippetText : (question, email) => rerankText(email)
const reranker = await loadReranker(join(DATA_DIR, "..", "models"))
let done = 0, pairs = 0
const started = performance.now()
for (const record of env.records) {
    const q = record.question
    const d = dense.get(record.questionKey)
    const paths = [...new Set([...env.bm25.search(q, 50, record.user).map((h) => h.path), ...env.bm25.search(q, 10).map((h) => h.path),
        ...(d ? [...d.mailbox.slice(0, 30), ...d.global.slice(0, 10)].map((x) => x[0]) : [])])]
    const have = cache[record.questionKey] ?? {}
    const known = mode === "std" ? base[record.questionKey]?.s ?? {} : base[record.questionKey] ?? {}
    const todo = []
    for (const path of paths) {
        if (have[path] !== undefined) continue
        if (mode === "std" && known[path] !== undefined) { have[path] = known[path]; continue }
        if (mode === "snip") {
            const text = snippetText(q, env.emailOf(path))
            if (text === rerankText(env.emailOf(path)) && known[path] !== undefined) { have[path] = known[path]; continue }
        }
        todo.push(path)
    }
    if (todo.length) {
        const scores = await reranker.score(q, todo.map((path) => textOf(q, env.emailOf(path))))
        todo.forEach((path, i) => { have[path] = +scores[i].toFixed(3) })
        pairs += todo.length
    }
    cache[record.questionKey] = have
    if (++done % 100 === 0) {
        writeJsonFile(file, cache)
        console.log(`${done}/${env.records.length}, ${pairs} pairs scored, ${Math.round((performance.now() - started) / 1000)} s`)
    }
}
writeJsonFile(file, cache)
console.log(`finished ${done}, ${pairs} pairs, ${Math.round((performance.now() - started) / 1000)} s`)
