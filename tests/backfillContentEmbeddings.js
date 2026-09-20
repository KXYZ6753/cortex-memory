import { prisma } from "../src/db/client.js"
import { buildSearchText } from "../src/entries.js"
import { embed } from "../src/process/embed.js"

const entries = await prisma.$queryRaw`
    SELECT id, title, author, "occurredAt", metadata, content
    FROM "Entry"
    WHERE "contentEmbedding" IS NULL AND content IS NOT NULL
`

try {
    for (const [index, entry] of entries.entries()) {
        const text = buildSearchText(entry)
        if (!text.trim()) continue
        const vector = await embed(text, { prefix: "search_document: " })
        await prisma.$executeRaw`
            UPDATE "Entry"
            SET "contentEmbedding" = ${`[${vector.join(",")}]`}::vector
            WHERE id = ${entry.id}
        `
        console.log(`${index + 1}/${entries.length}`)
    }
} finally {
    await prisma.$disconnect()
}
