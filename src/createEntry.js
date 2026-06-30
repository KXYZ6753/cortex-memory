// NOTE: when a 2nd entry function shows up (deleteOldEntries, getEntry, ...),
// rename this file to entries.js and add them here — group by domain noun, not by "it touches the DB".
// Start a new file only when a different noun appears (users.js, settings.js). Avoid a catch-all db.js.
import { prisma } from './db/client.js'
import { processText } from './process/ollama.js'

// Process text through ollama and persist it as an Entry (+ nested events).
// Returns the created entry with events included. Caller owns prisma.$disconnect().
export async function createEntry(content, source = 'manual') {
    const { summary, importance, tags, events } = await processText(content)

    return prisma.entry.create({
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
    })
}
