import {prisma} from './db/client.js'
import {embed} from './process/embed.js'

// Semantic search: return the k entries whose summary or content is closest in meaning to 'query'.
// todo: allow k number of entries and add an option to return all (and less than or equal to k number of entries) under a threshold
// Ordered by cosine distance (0 = identical meaning, 2 = opposite). Skips un-embedded rows.
export async function search(query, k = 5, embedding = "summary") {
    const vector = `[${(await embed(query, {prefix: "search_query: "})).join(",")}]`
    if (embedding === "content") {

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
    } else if (embedding === "summary") {

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
    } else {
        throw new Error('Embedding must be "summary" or "content"')
    }
}
