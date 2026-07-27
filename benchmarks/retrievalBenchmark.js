import { readFile, writeFile } from "node:fs/promises"
import { prisma } from "../src/db/client.js"
import { search } from "../src/search.js"

// JSON format: [{ "query": "...", "relevantIds": ["Entry.id or externalId"] }]
const file = process.argv[2]
if (!file) throw new Error("Usage: npm run benchmark:retrieval -- cases.json [method] [limit] [output.json]")
const method = process.argv[3] ?? "summary"
if (!["summary", "embedding", "word", "hybrid"].includes(method)) {
    throw new Error('Method must be "summary", "embedding", "word", or "hybrid"')
}
const limit = Number(process.argv[4] ?? Infinity)
if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Error("Limit must be a positive integer")
const outputFile = process.argv[5] ?? `benchmarks/${method}Results.json`

const cases = JSON.parse(await readFile(file, "utf8")).slice(0, limit)
if (!Array.isArray(cases) || !cases.length) throw new Error("Benchmark file must contain a non-empty array")

const recall = { 1: 0, 5: 0, 10: 0 }
const latencies = []
const details = []
let reciprocalRank = 0

try {
    for (const [index, testCase] of cases.entries()) {
        if (typeof testCase.query !== "string" || !testCase.query.trim() || !Array.isArray(testCase.relevantIds) || !testCase.relevantIds.length) {
            throw new Error("Each case needs a query and at least one relevantId")
        }

        const started = performance.now()
        const results = await search(testCase.query, 10, method)
        const latencyMs = performance.now() - started
        latencies.push(latencyMs)

        const relevant = new Set(testCase.relevantIds)
        const resultIds = results.map((result) => [result.id, result.externalId])
        for (const k of [1, 5, 10]) {
            const found = resultIds.slice(0, k).filter((ids) => ids.some((id) => relevant.has(id))).length
            recall[k] += found / relevant.size
        }
        const rank = resultIds.findIndex((ids) => ids.some((id) => relevant.has(id)))
        if (rank >= 0) reciprocalRank += 1 / (rank + 1)
        const retrievedIds = results.map((result) => result.externalId ?? result.id)
        details.push({
            case: index + 1,
            query: testCase.query,
            expectedIds: testCase.relevantIds,
            relevantRank: rank >= 0 ? rank + 1 : null,
            passed: {
                top1: rank >= 0 && rank < 1,
                top5: rank >= 0 && rank < 5,
                top10: rank >= 0 && rank < 10,
            },
            retrievedIds: {
                top1: retrievedIds.slice(0, 1),
                top5: retrievedIds.slice(0, 5),
                top10: retrievedIds,
            },
            latencyMs: Math.round(latencyMs),
        })
        console.log(`[benchmark] ${index + 1}/${cases.length} (${Math.round((index + 1) / cases.length * 100)}%)`)
    }

    latencies.sort((a, b) => a - b)
    const percentile = (p) => Math.round(latencies[Math.ceil(latencies.length * p) - 1])
    const summary = {
        method,
        queries: cases.length,
        recallAt1: Number((recall[1] / cases.length).toFixed(4)),
        recallAt5: Number((recall[5] / cases.length).toFixed(4)),
        recallAt10: Number((recall[10] / cases.length).toFixed(4)),
        mrr: Number((reciprocalRank / cases.length).toFixed(4)),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
    }
    const passedIds = {}
    const failedIds = {}
    for (const top of ["top1", "top5", "top10"]) {
        passedIds[top] = details.filter((item) => item.passed[top]).flatMap((item) => item.expectedIds)
        failedIds[top] = details.filter((item) => !item.passed[top]).flatMap((item) => item.expectedIds)
    }

    await writeFile(outputFile, JSON.stringify({ summary, passedIds, failedIds, cases: details }, null, 2) + "\n")
    console.log(JSON.stringify(summary, null, 2))
    console.log(`[report] ${outputFile}`)
} finally {
    await prisma.$disconnect()
}
