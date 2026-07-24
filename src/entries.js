import {prisma} from './db/client.js'
import {processText} from './process/ollama.js'
import {embed} from './process/embed.js'

export function normalizeEvents(events) {
    return events.flatMap(({title, date}) => {
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
        const parsed = new Date(`${date}T00:00:00.000Z`)
        return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? [{
            title,
            date: parsed
        }] : []
    })
}

export function buildSearchText({title, author, content}) {
    // todo: add chunking only if it shows to be useful, nomic-embed-text has 4000 char context window
    return [title && `Subject: ${title}`, author && `From: ${author}`, content].filter(Boolean).join("\n").slice(0, 4000)
}

// Process text through ollama and persist it as an Entry (+ nested events).
// Returns the created entry with events included. Caller owns prisma.$disconnect().
//
// This is if you want to develop custom connectors! Please do!
//
// The connector contract: every input source builds one of these objects and calls createEntry.
// Only `content` is required; everything else is optional. `processingContent`
// can hold a cleaned runtime copy while `content` remains the original stored text.
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
export async function createEntry({
                                      content,
                                      processingContent = content,
                                      source = 'unknown',
                                      externalId = null,
                                      occurredAt = null,
                                      title = null,
                                      metadata = null,
                                      author = null,
                                      additionalTags = []
                                  }) {

    if (externalId) { // skip processes if item already exist
        const existing = await prisma.entry.findUnique({
            where: {source_externalId: {source, externalId}},
        })
        if (existing) return existing
    }

    const {summary, importance, tags, events} = process.env.LLM_PROCESSING_ENABLED !== "false"
        ? await processText(processingContent, {referenceDate: occurredAt ?? new Date()})
        : {summary: null, importance: null, tags: [], events: []}

    const summaryVector = (process.env.LLM_PROCESSING_ENABLED !== "false" && process.env.EMBEDDING_PROCESSING_ENABLED !== "false")
        ? await embed(summary, {prefix: "search_document: "})
        : null

    const contentVector = process.env.EMBEDDING_PROCESSING_ENABLED !== "false"
        ? await embed(buildSearchText({title, author, content}), {prefix: "search_document: "})
        : null

    return prisma.$transaction(async (tx) => {
        const entry = await tx.entry.create({
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
                    create: normalizeEvents(events),
                },
            },
            include: {events: true},
        })

        // Prisma can't write the Unsupported vector type, so set it with a raw cast.
        if (summaryVector || contentVector) {
            await tx.$executeRaw`
                UPDATE "Entry"
                SET "summaryEmbedding" = ${
                        summaryVector ? `[${summaryVector.join(",")}]` : null
                }::vector,
            "contentEmbedding" = ${
                        contentVector ? `[${contentVector.join(",")}]` : null
                }::vector
                WHERE id = ${entry.id}
            `
        }
        return entry
    })
}
