import { prisma } from '../src/db/client.js'
import { processText } from '../src/process/ollama.js'
// Old import system made for testing creating entries please use: src/
const sample = `Confirming the dentist next Tuesday at 3pm.
Also car insurance is due Friday.`


async function main() {

    const result = await processText(sample)
    const summary = result.summary //str
    const sentiment = result.sentiment //str
    const tags = result.tags //list of str
    const events = result.events // list of or arrays, ex: events: [{ title: 'dentist appointment', date: '2026-06-29' },{ title: 'car insurance due', date: '2026-06-28' }]

    const entry = await prisma.entry.create({
        data: {
            source: 'manual',
            title: summary,
            content: sample,
            summary: summary,
            sentiment: sentiment,
            tags: tags,
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

    console.log('Created entry:', entry)

    // Read all entries back
    const all = await prisma.entry.findMany({ include: { events: true } })
    console.log(`\nTotal entries in DB: ${all.length}`)


}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error(e)
        prisma.$disconnect()
    })