import {prisma} from './db/client.js'
import {embed} from './process/embed.js'

// summary: vector search over AI-generated summaries
// embedding: vector search over original email content
// word: PostgreSQL word search over email metadata and content
// hybrid: content embedding with a small bonus for word-search matches
export async function search(query, k = 5, method = "hybrid") {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("Search query is required")
    if (!["summary", "embedding", "word", "hybrid"].includes(method)) {
        throw new Error('Method must be "summary", "embedding", "word", or "hybrid"')
    }

    if (method === "word") {
        const words = query.trim().split(/\s+/).join(" OR ")
        return prisma.$queryRaw`
            SELECT id,
                   "externalId",
                   source,
                   summary,
                   importance,
                   tags,
                   ts_rank_cd(
                       to_tsvector('english',
                           coalesce(author, '') || ' ' ||
                           coalesce(metadata->>'to', '') || ' ' ||
                           coalesce(title, '') || ' ' ||
                           coalesce(content, '')
                       ),
                       websearch_to_tsquery('english', ${words})
                   ) AS score
            FROM "Entry"
            WHERE to_tsvector('english',
                      coalesce(author, '') || ' ' ||
                      coalesce(metadata->>'to', '') || ' ' ||
                      coalesce(title, '') || ' ' ||
                      coalesce(content, '')
                  )
                  @@ websearch_to_tsquery('english', ${words})
            ORDER BY score DESC
            LIMIT ${k}
        `
    }

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

    if (method === "embedding") {
        return prisma.$queryRaw`
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
    }

    const words = query.trim().split(/\s+/).join(" OR ")
    const candidateCount = Math.max(k, 20)
    const [vectorResults, wordResults] = await Promise.all([
        prisma.$queryRaw`
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
            LIMIT ${candidateCount}
        `,
        prisma.$queryRaw`
            SELECT id,
                   "externalId",
                   source,
                   summary,
                   importance,
                   tags,
                   "contentEmbedding" <=> ${vector}::vector AS distance,
                   ts_rank_cd(
                       to_tsvector('english',
                           coalesce(author, '') || ' ' ||
                           coalesce(metadata->>'to', '') || ' ' ||
                           coalesce(title, '') || ' ' ||
                           coalesce(content, '')
                       ),
                       websearch_to_tsquery('english', ${words})
                   ) AS "wordScore"
            FROM "Entry"
            WHERE "contentEmbedding" IS NOT NULL
              AND to_tsvector('english',
                      coalesce(author, '') || ' ' ||
                      coalesce(metadata->>'to', '') || ' ' ||
                      coalesce(title, '') || ' ' ||
                      coalesce(content, '')
                  )
                  @@ websearch_to_tsquery('english', ${words})
            ORDER BY "wordScore" DESC
            LIMIT ${candidateCount}
        `,
    ])

    const results = new Map()
    for (const result of vectorResults) {
        const vectorScore = 1 - Number(result.distance)
        results.set(result.id, {...result, vectorScore, lexicalBonus: 0, score: vectorScore})
    }
    for (const result of wordResults) {
        const vectorScore = 1 - Number(result.distance)
        const combined = results.get(result.id) ?? {...result, vectorScore}
        combined.wordScore = Number(result.wordScore)
        combined.lexicalBonus = 0.05
        combined.score = vectorScore + combined.lexicalBonus
        results.set(result.id, combined)
    }

    return [...results.values()].sort((a, b) => b.score - a.score).slice(0, k)
}
