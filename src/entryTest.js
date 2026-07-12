// This entry test for testing if entry creation works without any AI processing, all manual entry
import { prisma } from './db/client.js'

async function main() {
    // Create a manual entry
    const entry = await prisma.entry.create({
        data: {
            source: 'manual',
            title: 'Dentist reminder',
            content: 'Dentist appointment next Tuesday at 3pm',
            tags: ['health', 'appointment'],
            occurredAt: new Date(),
            events: {
                create: [
                    {
                        title: 'Dentist appointment',
                        date: new Date('2026-06-23T15:00:00'),
                    },
                ],
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