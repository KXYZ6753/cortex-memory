import {prisma} from './db/client.js'
import {embed} from './process/embed.js'
import {searchBm25} from './bm25.js'

// summary: vector search over AI-generated summaries
// embedding: fast vector search over original email content
// word: BM25 search over email metadata and content
// hybrid: BM25 plus content embeddings using reciprocal-rank fusion
export async function search(query, k = 5, method = "embedding") {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("Search query is required")
    if (!Number.isInteger(k) || k < 1) throw new TypeError("Search result count must be a positive integer")
    if (!["summary", "embedding", "word", "hybrid"].includes(method)) {
        throw new Error('Method must be "summary", "embedding", "word", or "hybrid"')
    }

    if (method === "word") return searchBm25(query, k)

    const vector = `[${(await embed(query, {prefix: "search_query: "})).join(",")}]`
    if (method === "summary") {
        return prisma.$queryRaw`
            SELECT id,
                   "externalId",
                   source,
                   summary,
                   importance,
                   tags,
                   "summaryEmbedding" <=> ${vector}::vector AS distance
            FROM "Entry"
            WHERE "summaryEmbedding" IS NOT NULL
            ORDER BY distance
            LIMIT ${k}
        `
    }

    if (method === "embedding") return contentEmbeddingSearch(vector, k)

    const candidateCount = Math.max(k, 100)
    const [vectorResults, wordResults] = await Promise.all([
        contentEmbeddingSearch(vector, candidateCount),
        Promise.resolve(searchBm25(query, candidateCount)),
    ])
    return fuseResults(wordResults, vectorResults).slice(0, k)
}

async function contentEmbeddingSearch(vector, k) {
    const run = (client) => client.$queryRaw`
        SELECT id,
               "externalId",
               source,
               summary,
               importance,
               tags,
               "contentEmbedding" <=> ${vector}::vector AS distance
        FROM "Entry"
        WHERE "contentEmbedding" IS NOT NULL
        ORDER BY distance
        LIMIT ${k}
    `

    return prisma.$transaction(async (tx) => {
        // 400 kept vector Recall@10 within one point of exact search in the EnronQA test.
        await tx.$queryRaw`SELECT set_config('hnsw.ef_search', ${String(Math.max(k, 400))}, true)`
        return run(tx)
    })
}

export function fuseResults(wordResults, vectorResults) {
    const results = new Map()
    const add = (items, weight, rankName) => items.forEach((result, index) => {
        const existing = results.get(result.id) ?? {}
        results.set(result.id, {
            ...existing,
            ...result,
            [rankName]: index + 1,
            score: (existing.score ?? 0) + weight / (10 + index + 1),
        })
    })

    // BM25 was much stronger on EnronQA. Dense retrieval stays as recovery evidence.
    add(wordResults, 1, "wordRank")
    add(vectorResults, 0.25, "vectorRank")
    return [...results.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}
