import { prisma } from '../src/db/client.js'
import { search } from '../src/search.js'

// Usage: node tests/searchTest.js "money I owe" [k] [method]
const query = process.argv[2]
const k = Number(process.argv[3]) || 5
const method = process.argv[4] ?? 'embedding'
if (!query) {
    console.error('Usage: node tests/searchTest.js "your query" [k] [method]')
    process.exit(1)
}

console.log(`query: "${query}"\n`)
for (const h of await search(query, k, method)) {
    console.log((h.distance ?? h.score).toFixed(3), '|', h.summary, '|', h, '\n\n\n')
}
await prisma.$disconnect()
