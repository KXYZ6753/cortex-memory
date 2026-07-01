import { prisma } from './db/client.js'
import { embed } from './process/embed.js'

// Semantic search: return the k entries whose summary is closest in meaning to 'query'.
// Ordered by cosine distance (0 = identical meaning, 2 = opposite). Skips un-embedded rows.
export async function search(query, k = 5) {
    const vector = `[${(await embed(query)).join(",")}]`
    return prisma.$queryRaw`
        SELECT id, source, summary, importance, tags,
               "summaryEmbedding" <=> ${vector}::vector AS distance
        FROM "Entry"
        WHERE "summaryEmbedding" IS NOT NULL
        ORDER BY distance
        LIMIT ${k}
    `
}
