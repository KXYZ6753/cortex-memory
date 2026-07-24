import { readFile } from "node:fs/promises"
import { prisma } from "../src/db/client.js"
import { search } from "../src/search.js"

// JSON format: [{ "query": "...", "relevantIds": ["Entry.id or externalId"] }]
const file = process.argv[2]
if (!file) throw new Error("Usage: npm run benchmark:retrieval -- cases.json")
const embedding = process.argv[3] ?? "summary"
if (!["summary", "content"].includes(embedding)) throw new Error('Embedding must be "summary" or "content"')

const cases = JSON.parse(await readFile(file, "utf8"))
if (!Array.isArray(cases) || !cases.length) throw new Error("Benchmark file must contain a non-empty array")

const recall = { 1: 0, 5: 0, 10: 0 }
const latencies = []
let reciprocalRank = 0

try {
    for (const testCase of cases) {
        if (typeof testCase.query !== "string" || !testCase.query.trim() || !Array.isArray(testCase.relevantIds) || !testCase.relevantIds.length) {
            throw new Error("Each case needs a query and at least one relevantId")
        }

        const started = performance.now()
        const results = await search(testCase.query, 10, embedding)
        latencies.push(performance.now() - started)

        const relevant = new Set(testCase.relevantIds)
        const resultIds = results.map((result) => [result.id, result.externalId])
        for (const k of [1, 5, 10]) {
            const found = resultIds.slice(0, k).filter((ids) => ids.some((id) => relevant.has(id))).length
            recall[k] += found / relevant.size
        }
        const rank = resultIds.findIndex((ids) => ids.some((id) => relevant.has(id)))
        if (rank >= 0) reciprocalRank += 1 / (rank + 1)
    }

    latencies.sort((a, b) => a - b)
    const percentile = (p) => Math.round(latencies[Math.ceil(latencies.length * p) - 1])
    console.log(JSON.stringify({
        method: `${embedding}-vector`,
        queries: cases.length,
        recallAt1: Number((recall[1] / cases.length).toFixed(4)),
        recallAt5: Number((recall[5] / cases.length).toFixed(4)),
        recallAt10: Number((recall[10] / cases.length).toFixed(4)),
        mrr: Number((reciprocalRank / cases.length).toFixed(4)),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
    }, null, 2))
} finally {
    await prisma.$disconnect()
}
