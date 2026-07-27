import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { prisma } from "../src/db/client.js"
import { search } from "../src/search.js"
import { EMBEDDING_MODEL } from "../src/process/embed.js"

// JSON format: [{ "query": "...", "relevantIds": ["Entry.id or externalId"] }]
const file = process.argv[2]
if (!file) throw new Error("Usage: npm run benchmark:retrieval -- cases.json [method] [limit] [output.json] [seed] [topK]")

const method = process.argv[3] ?? "embedding"
if (!["summary", "embedding", "word", "hybrid"].includes(method)) {
    throw new Error('Method must be "summary", "embedding", "word", or "hybrid"')
}

const limit = Number(process.argv[4] ?? 500)
if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Error("Limit must be a positive integer")

const outputFile = process.argv[5] ?? `benchmarks/${method}Results.json`
const seed = Number(process.argv[6] ?? 42)
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be a 32-bit unsigned integer")

const topK = Number(process.argv[7] ?? 100)
if (!Number.isInteger(topK) || topK < 1) throw new Error("topK must be a positive integer")
const cutoffs = [1, 5, 10, 20, 50, 100].filter((cutoff) => cutoff <= topK)

const inputCases = JSON.parse(await readFile(file, "utf8"))
if (!Array.isArray(inputCases) || !inputCases.length) throw new Error("Benchmark file must contain a non-empty array")

let randomState = seed
const random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 2 ** 32)
const cases = inputCases.map((testCase, index) => ({ ...testCase, inputCase: index + 1 }))
for (let index = cases.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[cases[index], cases[swapIndex]] = [cases[swapIndex], cases[index]]
}
cases.length = Math.min(cases.length, limit)

const recall = Object.fromEntries(cutoffs.map((cutoff) => [cutoff, 0]))
const latencies = []
const details = []
let reciprocalRank = 0

try {
    const coldStarted = performance.now()
    await search(cases[0].query, topK, method)
    const coldStartMs = performance.now() - coldStarted

    for (const [index, testCase] of cases.entries()) {
        if (typeof testCase.query !== "string" || !testCase.query.trim() || !Array.isArray(testCase.relevantIds) || !testCase.relevantIds.length) {
            throw new Error("Each case needs a query and at least one relevantId")
        }

        const started = performance.now()
        const results = await search(testCase.query, topK, method)
        const latencyMs = performance.now() - started
        latencies.push(latencyMs)

        const relevant = new Set(testCase.relevantIds)
        const resultIds = results.map((result) => [result.id, result.externalId])
        for (const cutoff of cutoffs) {
            const found = resultIds.slice(0, cutoff).filter((ids) => ids.some((id) => relevant.has(id))).length
            recall[cutoff] += found / relevant.size
        }

        const rank = resultIds.findIndex((ids) => ids.some((id) => relevant.has(id)))
        if (rank >= 0) reciprocalRank += 1 / (rank + 1)
        const retrievedIds = results.map((result) => result.externalId ?? result.id)
        details.push({
            case: index + 1,
            inputCase: testCase.inputCase,
            query: testCase.query,
            expectedIds: testCase.relevantIds,
            relevantRank: rank >= 0 ? rank + 1 : null,
            passed: Object.fromEntries(cutoffs.map((cutoff) => [`top${cutoff}`, rank >= 0 && rank < cutoff])),
            retrievedIds: Object.fromEntries(cutoffs.map((cutoff) => [`top${cutoff}`, retrievedIds.slice(0, cutoff)])),
            results: results.map((result) => ({
                id: result.externalId ?? result.id,
                entryId: result.id,
                externalId: result.externalId,
                score: result.score == null ? undefined : Number(result.score),
                distance: result.distance == null ? undefined : Number(result.distance),
                wordScore: result.wordScore == null ? undefined : Number(result.wordScore),
                wordRank: result.wordRank,
                vectorRank: result.vectorRank,
            })),
            latencyMs: Number(latencyMs.toFixed(2)),
        })
        console.log(`[benchmark] ${index + 1}/${cases.length} (${Math.round((index + 1) / cases.length * 100)}%)`)
    }

    latencies.sort((a, b) => a - b)
    const percentile = (p) => Math.round(latencies[Math.ceil(latencies.length * p) - 1])
    const summary = {
        method,
        embeddingModel: method === "word" ? null : EMBEDDING_MODEL,
        queries: cases.length,
        seed,
        topK,
        recall: Object.fromEntries(cutoffs.map((cutoff) => [cutoff, Number((recall[cutoff] / cases.length).toFixed(4))])),
        mrr: Number((reciprocalRank / cases.length).toFixed(4)),
        coldStartMs: Math.round(coldStartMs),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        meanMs: Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length),
    }
    for (const cutoff of cutoffs) summary[`recallAt${cutoff}`] = summary.recall[cutoff]

    const passedIds = {}
    const failedIds = {}
    for (const top of cutoffs.map((cutoff) => `top${cutoff}`)) {
        passedIds[top] = details.filter((item) => item.passed[top]).flatMap((item) => item.expectedIds)
        failedIds[top] = details.filter((item) => !item.passed[top]).flatMap((item) => item.expectedIds)
    }

    const rankHistogram = {}
    for (const item of details) {
        const rank = item.relevantRank ?? "missed"
        rankHistogram[rank] = (rankHistogram[rank] ?? 0) + 1
    }

    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, JSON.stringify({ summary, rankHistogram, passedIds, failedIds, cases: details }, null, 2) + "\n")
    console.log(JSON.stringify(summary, null, 2))
    console.log(`[report] ${outputFile}`)
} finally {
    await prisma.$disconnect()
}
