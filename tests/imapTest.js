import "dotenv/config";
import { prisma } from '../src/db/client.js'
import { run } from '../src/connectors/connector-imap.js'

// Ingests the newest 10 inbox emails via the connector (Ollama + DB writes, dedupes on re-run).
run({ recent: 30 })
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error(e)
        prisma.$disconnect()
    })
