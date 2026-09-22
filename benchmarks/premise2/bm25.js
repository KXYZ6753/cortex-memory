// BM25 over the premise2 corpus: node:sqlite FTS5, the same tokenizer as
// benchmarks/buildBm25Index.js, and toBm25Query from src/bm25.js. Queries run in a
// pool of worker threads (one OR-query over ~100k emails takes ~70 ms).

import { DatabaseSync } from "node:sqlite"
import { Worker } from "node:worker_threads"
import { mkdirSync, rmSync, renameSync } from "node:fs"
import { dirname } from "node:path"
import { cpus } from "node:os"
import { toBm25Query } from "../../src/bm25.js"
import { parseFileHeader, splitFile } from "./text.js"

// path and user are stored but not searched; subject, sender, recipients and body
// are weighted equally (as in V1).
export const BM25_RANK = "bm25(0, 0, 1, 1, 1, 1)"

export function buildBm25Index(docs, dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true })
    const temporary = `${dbPath}.${process.pid}.tmp`
    rmSync(temporary, { force: true })
    const db = new DatabaseSync(temporary)
    db.exec(`
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        CREATE VIRTUAL TABLE docs USING fts5(
            path UNINDEXED, user UNINDEXED, subject, sender, recipients, content,
            tokenize='porter unicode61'
        );
    `)
    const insert = db.prepare("INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)")
    db.exec("BEGIN")
    for (const doc of docs) {
        const { header, body } = splitFile(doc.email)
        const parsed = parseFileHeader(header)
        insert.run(doc.path, doc.user, parsed.subject, parsed.sender, parsed.recipients.join(", ") || parsed.rawRecipients, body)
    }
    db.exec("COMMIT")
    db.exec(`INSERT INTO docs(docs, rank) VALUES('rank', '${BM25_RANK}')`)
    db.exec("INSERT INTO docs(docs) VALUES('optimize')")
    db.close()
    renameSync(temporary, dbPath)
}

export function openBm25(dbPath) {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    // Memory-mapped reads share the OS page cache across worker connections instead
    // of each connection re-reading pages into its own small cache.
    db.exec("PRAGMA mmap_size = 1073741824; PRAGMA cache_size = -65536")
    const global = db.prepare("SELECT path, -rank AS score FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?")
    const perUser = db.prepare("SELECT path, -rank AS score FROM docs WHERE docs MATCH ? AND user = ? ORDER BY rank LIMIT ?")
    return {
        search(query, k, user = null) {
            const match = toBm25Query(query)
            if (!match) return []
            return (user ? perUser.all(match, user, k) : global.all(match, k)).map((row) => ({ path: row.path, score: Number(row.score) }))
        },
        close: () => db.close(),
    }
}

// Worker-thread pool over the read-only index. search() resolves in call order is
// not guaranteed; results are matched back by request id.
export class Bm25Pool {
    // 4 workers measured fastest on an M4 (4 performance cores); more contend.
    constructor(dbPath, size = Math.max(1, Math.min(4, cpus().length - 1))) {
        this.workers = []
        this.pending = new Map()
        this.next = 0
        this.id = 0
        for (let index = 0; index < size; index++) {
            // --input-type is only valid for stdin/eval entry points; workers must not inherit it.
            const execArgv = process.execArgv.filter((arg) => !arg.startsWith("--input-type"))
            const worker = new Worker(new URL("./bm25-worker.js", import.meta.url), { workerData: { dbPath }, execArgv })
            worker.on("message", ({ id, results, error }) => {
                const entry = this.pending.get(id)
                if (!entry) return
                this.pending.delete(id)
                if (error) entry.reject(new Error(error))
                else entry.resolve(results)
            })
            worker.on("error", (error) => {
                for (const entry of this.pending.values()) entry.reject(error)
                this.pending.clear()
            })
            this.workers.push(worker)
        }
    }

    search(query, k, user = null) {
        const id = ++this.id
        const worker = this.workers[this.next++ % this.workers.length]
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            worker.postMessage({ id, query, k, user })
        })
    }

    async close() {
        await Promise.all(this.workers.map((worker) => worker.terminate()))
    }
}

// Runs `task(item)` over items with at most `limit` in flight; keeps input order.
export async function mapLimit(items, limit, task, onProgress) {
    const results = new Array(items.length)
    let cursor = 0
    let done = 0
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await task(items[index], index)
            done++
            if (onProgress) onProgress(done, items.length)
        }
    })
    await Promise.all(lanes)
    return results
}
