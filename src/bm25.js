import { existsSync, statSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

export const BM25_INDEX_PATH = process.env.BM25_INDEX_PATH
    ?? fileURLToPath(new URL("../.data/bm25.sqlite", import.meta.url))

const STOP_WORDS = new Set(`
    a an and are as at be been but by can could did do does for from had has have
    how i if in into is it its may more most not of on or our should so than that
    the their them then there these they this those to was we were what when where
    which who why will with would you your
`.trim().split(/\s+/))

let database
let statement
let indexModifiedAt

export function toBm25Query(query) {
    const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    const usefulWords = words.filter((word) => !STOP_WORDS.has(word))
    return (usefulWords.length ? usefulWords : words)
        .map((word) => `"${word.replaceAll('"', '""')}"`)
        .join(" OR ")
}

function openIndex() {
    let modifiedAt
    try {
        modifiedAt = statSync(BM25_INDEX_PATH).mtimeMs
    } catch {
        throw new Error(`BM25 index not found. Run "npm run index:bm25" first.`)
    }

    if (database && modifiedAt === indexModifiedAt) return
    database?.close()
    database = new DatabaseSync(BM25_INDEX_PATH, { readOnly: true })
    statement = database.prepare(`
        SELECT id,
               externalId AS "externalId",
               source,
               summary,
               importance,
               tags,
               -bm25(entries, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1) AS score
        FROM entries
        WHERE entries MATCH ?
        ORDER BY bm25(entries, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1)
        LIMIT ?
    `)
    indexModifiedAt = modifiedAt
}

export function searchBm25(query, k) {
    const bm25Query = toBm25Query(query)
    if (!bm25Query) return []
    openIndex()
    return statement.all(bm25Query, k).map((result) => ({
        ...result,
        tags: JSON.parse(result.tags || "[]"),
        score: Number(result.score),
        wordScore: Number(result.score),
    }))
}

export function indexBm25Entry(entry) {
    if (!existsSync(BM25_INDEX_PATH)) return

    database?.close()
    database = undefined
    statement = undefined
    indexModifiedAt = undefined

    const writer = new DatabaseSync(BM25_INDEX_PATH)
    try {
        writer.prepare("DELETE FROM entries WHERE id = ?").run(entry.id)
        writer.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
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
    } finally {
        writer.close()
    }
}
