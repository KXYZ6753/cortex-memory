// Exact, unweighted agent SEARCH over the frozen BM25 corpus. No gold fields.
import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { contentWords } from "./text.js"

export const OVERLAP_INDEX = "overlap"
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const rowsSql = "SELECT path, subject, sender, recipients, content FROM docs ORDER BY path COLLATE BINARY"
const fields = (row) => [row.subject, row.sender, row.recipients, row.content].join("\n")

export function openAgentOverlap(dbPath) {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const paths = []
    const postings = new Map()
    const digest = createHash("sha256")
    try {
        for (const row of db.prepare(rowsSql).iterate()) {
            const id = paths.length
            paths.push(row.path)
            digest.update(JSON.stringify([row.path, row.subject, row.sender, row.recipients, row.content]) + "\n")
            for (const word of contentWords(fields(row))) {
                let ids = postings.get(word)
                if (!ids) { ids = []; postings.set(word, ids) }
                ids.push(id)
            }
        }
    } finally { db.close() }
    const corpusHash = digest.digest("hex")
    return {
        corpusHash,
        count: paths.length,
        search(query, k = 10) {
            const counts = new Map()
            for (const word of contentWords(query)) {
                for (const id of postings.get(word) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
            }
            // No positive match means no results, as in the BM25 agent tool.
            return [...counts].sort(([a, sa], [b, sb]) => sb - sa || compare(paths[a], paths[b]))
                .slice(0, k).map(([id, score]) => ({ path: paths[id], score }))
        },
        close() { postings.clear() },
    }
}

// Slow reference implementation for the preflight and tests only.
export function directAgentOverlap(dbPath, query, k = 10) {
    const words = new Set(contentWords(query))
    if (!words.size) return []
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = []
    try {
        for (const row of db.prepare(rowsSql).iterate()) {
            const score = contentWords(fields(row)).filter((word) => words.has(word)).length
            if (score) rows.push({ path: row.path, score })
        }
    } finally { db.close() }
    return rows.sort((a, b) => b.score - a.score || compare(a.path, b.path)).slice(0, k)
}
