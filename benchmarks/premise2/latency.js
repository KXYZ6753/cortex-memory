// Full-pipeline retrieval latency on the generation machine: one query at a time,
// as a deployed assistant would run it. The report adds these component times to
// the generation time of B (BM25) and E* (whatever E* uses) for the cost ratio.
//
// Runs as its own process (npm run premise2 -- latency), so the corpus, the dense
// matrix and the reranker are freed before any generator is loaded.

import { join } from "node:path"
import { readFileSync } from "node:fs"
import { openBm25 } from "./bm25.js"
import { loadDense, denseSearch, embedBatch, readJson, writeJson, QUERY_PREFIX } from "./dense.js"
import { rrf, LIST_DEPTH } from "./retrieve.js"
import { loadReranker, rerankText, rerankOrder } from "./rerank.js"
import { loadRaw } from "./dataset.js"

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null)
const summary = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return { n: sorted.length, meanMs: sorted.length ? Number((sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(2)) : null, p50Ms: quantile(sorted, 0.5), p95Ms: quantile(sorted, 0.95) }
}

export async function measureLatency({ dataDir, ollamaUrl = "http://localhost:11434", n = 100, log = console.log }) {
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const records = pools.dev.slice(0, n)
    const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
    const docs = readJson(join(dataDir, "dense-docs.json"))
    const loadStarted = performance.now()
    const dense = loadDense(join(dataDir, "dense.f32"), docs.paths, docs.users)
    const denseLoadMs = performance.now() - loadStarted
    const raw = await loadRaw(join(dataDir, "hf"))
    const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
    let reranker = null
    let rerankError = null
    try {
        reranker = await loadReranker(join(dataDir, "..", "models"))
    } catch (error) {
        rerankError = error.message.slice(0, 300)
        log(`[latency] reranker unavailable: ${rerankError}`)
    }
    // Warm-up: first embed loads nomic, first rerank compiles the ONNX graph.
    await embedBatch([QUERY_PREFIX + "warm up"], { ollamaUrl })
    if (reranker) await reranker.score("warm up", ["warm up"])

    const times = { bm25: [], embed: [], dense: [], rrf: [], rerank: [], rerankPairs: [] }
    for (const [index, record] of records.entries()) {
        let started = performance.now()
        const bm25List = bm25.search(record.question, 100)
        times.bm25.push(performance.now() - started)
        started = performance.now()
        const [vector] = await embedBatch([QUERY_PREFIX + record.question], { ollamaUrl })
        times.embed.push(performance.now() - started)
        started = performance.now()
        const denseList = denseSearch(dense, vector, 100)
        times.dense.push(performance.now() - started)
        started = performance.now()
        const fused = rrf([bm25List, denseList])
        times.rrf.push(performance.now() - started)
        if (reranker) {
            const union = [...new Set([...bm25List.slice(0, LIST_DEPTH), ...denseList.slice(0, LIST_DEPTH), ...fused.slice(0, LIST_DEPTH)].map((hit) => hit.path))]
            started = performance.now()
            const scores = await reranker.score(record.question, union.map((path) => rerankText(emailByPath.get(path) ?? "")))
            rerankOrder(union, scores)
            times.rerank.push(performance.now() - started)
            times.rerankPairs.push(union.length)
        }
        if ((index + 1) % 25 === 0) log(`[latency] ${index + 1}/${records.length}`)
    }
    await reranker?.dispose()
    bm25.close()
    const result = {
        measuredAt: new Date().toISOString(),
        platform: `${process.platform} ${process.arch}`,
        n: records.length,
        denseLoadMs: Math.round(denseLoadMs),
        components: {
            bm25: summary(times.bm25),
            queryEmbed: summary(times.embed),
            denseSearch: summary(times.dense),
            rrf: summary(times.rrf),
            rerank: reranker ? { ...summary(times.rerank), meanPairs: Number((times.rerankPairs.reduce((s, v) => s + v, 0) / times.rerankPairs.length).toFixed(1)) } : { error: rerankError },
        },
    }
    writeJson(join(dataDir, "latency.json"), result)
    log(`[latency] ${JSON.stringify(result.components)}`)
    return result
}
