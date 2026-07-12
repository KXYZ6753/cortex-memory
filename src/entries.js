import { prisma } from './db/client.js'
import { processText } from './process/ollama.js'
import { embed } from './process/embed.js'

// Process text through ollama and persist it as an Entry (+ nested events).
// Returns the created entry with events included. Caller owns prisma.$disconnect().
//
// This is if you want to develop custom connectors! Please do!
//
// The connector contract: every input source builds one of these objects and calls createEntry.
// Only `content` is required; everything else is optional.
//   await createEntry({ content: "Don't forget the dentist Friday" }) // Minimum use, highly suggested to provide much info as possible if you are creating a connector
//   await createEntry({
//     content: body,
//     source: "email",
//     externalId: messageId,        // enables dedupe via @@unique([source, externalId]), highly suggested if you are creating a connector to keep the program efficient
//     title: subject,
//     author: fromAddress,
//     occurredAt: receivedDate,     // Date object or ISO string, example: "2026-07-03T12:34:56.000Z"
//     metadata: { folder: "inbox" },
//     additionalTags: ["gmail", "mail", "work", "etc..."],     // merged with the AI-generated tags, (AI tags + additionalTags)
//   })
export async function createEntry({ content, source = 'unknown', externalId = null, occurredAt = null, title = null, metadata = null, author = null, additionalTags = [] }) {

    if (externalId) { // skip processes if item already exist
        const existing = await prisma.entry.findUnique({
            where: { source_externalId: { source, externalId } },
        })
        if (existing) return existing
    }

    const { summary, importance, tags, events } = await processText(content)

    // Embed the summary and insert the row at the same time — both only need `summary`.
    const [vector, entry] = await Promise.all([
        embed(summary, { prefix: "search_document: " }),
        prisma.entry.create({
            data: {
                source,
                externalId,
                author,
                title,
                content,
                summary,
                importance,
                tags: [...tags, ...additionalTags],
                metadata,
                occurredAt, //future note, format: new Date() OR 2026-07-03T12:34:56.000Z
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

    // note: Prisma can't write the Unsupported vector type, so set it with a raw cast.
    await prisma.$executeRaw`UPDATE "Entry" SET "summaryEmbedding" = ${`[${vector.join(",")}]`}::vector WHERE id = ${entry.id}`
    return entry
}
