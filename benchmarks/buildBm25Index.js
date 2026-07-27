import { mkdir, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { prisma } from "../src/db/client.js"
import { BM25_INDEX_PATH } from "../src/bm25.js"

const temporaryPath = `${BM25_INDEX_PATH}.${process.pid}.tmp`
await mkdir(dirname(BM25_INDEX_PATH), { recursive: true })
await rm(temporaryPath, { force: true })

const database = new DatabaseSync(temporaryPath)
database.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE VIRTUAL TABLE entries USING fts5(
        id UNINDEXED,
        externalId UNINDEXED,
        source UNINDEXED,
        summary UNINDEXED,
        importance UNINDEXED,
        tags UNINDEXED,
        author,
        recipients,
        date,
        title,
        content,
        tokenize='porter unicode61'
    );
`)

const insert = database.prepare(`
    INSERT INTO entries
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

let cursor
let count = 0

try {
    database.exec("BEGIN")
    while (true) {
        const entries = await prisma.entry.findMany({
            take: 1000,
            skip: cursor ? 1 : 0,
            ...(cursor && { cursor: { id: cursor } }),
            orderBy: { id: "asc" },
            select: {
                id: true,
                externalId: true,
                source: true,
                summary: true,
                importance: true,
                tags: true,
                author: true,
                metadata: true,
                occurredAt: true,
                title: true,
                content: true,
            },
        })
        if (!entries.length) break

        for (const entry of entries) {
            insert.run(
                entry.id,
                entry.externalId,
                entry.source,
                entry.summary,
                entry.importance,
                JSON.stringify(entry.tags),
                entry.author,
                String(entry.metadata?.to ?? ""),
                entry.occurredAt?.toISOString() ?? "",
                entry.title,
                entry.content,
            )
        }

        count += entries.length
        cursor = entries.at(-1).id
        console.log(`[bm25] indexed ${count}`)
    }
    database.exec("COMMIT")
    database.exec("INSERT INTO entries(entries) VALUES('optimize')")
    database.close()
    await rename(temporaryPath, BM25_INDEX_PATH)
    console.log(`[bm25] complete: ${count} entries -> ${BM25_INDEX_PATH}`)
} catch (error) {
    try {
        database.exec("ROLLBACK")
        database.close()
    } catch {}
    await rm(temporaryPath, { force: true })
    throw error
} finally {
    await prisma.$disconnect()
}
