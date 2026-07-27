import {prisma} from './db/client.js'
import {embed} from './process/embed.js'

// summary: vector search over AI-generated summaries
// embedding: vector search over original email content
// word: PostgreSQL word search over email subjects and content
export async function search(query, k = 5, method = "summary") {
    if (typeof query !== "string" || !query.trim()) throw new TypeError("Search query is required")
    if (!["summary", "embedding", "word"].includes(method)) {
        throw new Error('Method must be "summary", "embedding", or "word"')
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
                       to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')),
                       websearch_to_tsquery('english', ${words})
                   ) AS score
            FROM "Entry"
            WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
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
