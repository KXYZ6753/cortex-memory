//Note to self: Start a new file only when a different noun appears (users.js, settings.js). Avoid a catch-all db.js.
import { prisma } from './db/client.js'
import { processText } from './process/ollama.js'
import { embed } from './process/embed.js'

// Process text through ollama and persist it as an Entry (+ nested events).
// Returns the created entry with events included. Caller owns prisma.$disconnect().
export async function createEntry(content, source = 'manual') {
    const { summary, importance, tags, events } = await processText(content)

    // Embed the summary and insert the row at the same time — both only need `summary`.
    const [vector, entry] = await Promise.all([
        embed(summary),
        prisma.entry.create({
            data: {
                source,
                title: summary,
                content,
                summary,
                importance,
                tags,
                occurredAt: new Date(),
                events: {
                    create: events.map((e) => ({
                        title: e.title,
                        date: new Date(e.date),
                    })),
                },
            },
            include: { events: true },
        }),
    ])

    // Prisma can't write the Unsupported vector type, so set it with a raw cast.
    await prisma.$executeRaw`UPDATE "Entry" SET "summaryEmbedding" = ${`[${vector.join(",")}]`}::vector WHERE id = ${entry.id}`
    return entry
}
