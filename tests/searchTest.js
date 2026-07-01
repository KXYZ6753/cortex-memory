import { prisma } from '../src/db/client.js'
import { search } from '../src/search.js'

// Usage: node tests/searchTest.js "money I owe" [k]
// [k] is number of entries to list
const query = process.argv[2]
const k = Number(process.argv[3]) || 5
if (!query) {
    console.error('Usage: node tests/searchTest.js "your query" [k]')
    process.exit(1)
}

console.log(`query: "${query}"\n`)
for (const h of await search(query, k)) {
    console.log(h.distance.toFixed(3), '|', h.summary)
}
await prisma.$disconnect()
