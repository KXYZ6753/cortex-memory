// Dense retrieval: nomic-embed-text through Ollama /api/embed (batched), unit-norm
// Float32 vectors on disk, brute-force dot product (fast enough at ~100k x 768).
//
// nomic-embed-text has a 2048-token context in Ollama and truncate:true keeps the
// start of longer inputs; this affects well under 1% of emails and is disclosed.

import { existsSync, openSync, readSync, writeSync, closeSync, statSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

export const EMBED_MODEL = "nomic-embed-text"
export const EMBED_DIM = 768
export const DOC_PREFIX = "search_document: "
export const QUERY_PREFIX = "search_query: "

function normalise(vector) {
    let norm = 0
    for (const value of vector) norm += value * value
    norm = Math.sqrt(norm) || 1
    const out = new Float32Array(vector.length)
    for (let index = 0; index < vector.length; index++) out[index] = vector[index] / norm
    return out
}

export async function embedBatch(texts, { ollamaUrl = "http://localhost:11434", model = EMBED_MODEL, timeoutMs = 300_000, attempts = 4 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch(`${ollamaUrl}/api/embed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // Embeddings keep truncate:true (nomic's 2048-token window); chat calls
                // use truncate:false so oversize prompts fail loudly instead.
                body: JSON.stringify({ model, input: texts, truncate: true, keep_alive: "30m" }),
                signal: AbortSignal.timeout(timeoutMs),
            })
            if (!response.ok) throw Object.assign(new Error(`embed HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`), { retryable: response.status >= 500 || response.status === 429 })
            const data = await response.json()
            const vectors = data.embeddings
            if (!Array.isArray(vectors) || vectors.length !== texts.length) throw Object.assign(new Error("embed returned the wrong number of vectors"), { retryable: true })
            return vectors.map((vector) => {
                if (vector.length !== EMBED_DIM) throw new Error(`embedding has ${vector.length} dimensions, expected ${EMBED_DIM}`)
                return normalise(vector)
            })
        } catch (error) {
            const retryable = error.retryable ?? (error.name === "TimeoutError" || error instanceof TypeError)
            if (!retryable || attempt === attempts) throw error
            await delay(1000 * 2 ** (attempt - 1))
        }
    }
}

// Resumable: vectors are appended to `${path}.part` in doc order; a restart skips
// the rows already written. The finished file is renamed into place atomically.
export async function buildDenseIndex(docs, path, { textOf, batchSize = 32, ollamaUrl, onProgress } = {}) {
    const bytesPerRow = EMBED_DIM * 4
    const part = `${path}.part`
    if (existsSync(path) && statSync(path).size === docs.length * bytesPerRow) return
    let done = existsSync(part) ? Math.floor(statSync(part).size / bytesPerRow) : 0
    const fd = openSync(part, done ? "r+" : "w")
    try {
        const started = performance.now()
        for (let start = done; start < docs.length; start += batchSize) {
            const batch = docs.slice(start, start + batchSize)
            const vectors = await embedBatch(batch.map((doc) => DOC_PREFIX + textOf(doc)), { ollamaUrl })
            const buffer = Buffer.alloc(batch.length * bytesPerRow)
            vectors.forEach((vector, row) => Buffer.from(vector.buffer).copy(buffer, row * bytesPerRow))
            writeSync(fd, buffer, 0, buffer.length, start * bytesPerRow)
            done = start + batch.length
            if (onProgress) onProgress(done, docs.length, (performance.now() - started) / 1000)
        }
    } finally {
        closeSync(fd)
    }
    renameSync(part, path)
}

export function loadDense(path, paths, users) {
    const bytes = readFileSync(path)
    const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    if (vectors.length !== paths.length * EMBED_DIM) throw new Error(`dense index has ${vectors.length / EMBED_DIM} rows, expected ${paths.length}`)
    const byUser = new Map()
    users.forEach((user, row) => {
        if (!byUser.has(user)) byUser.set(user, [])
        byUser.get(user).push(row)
    })
    return { paths, vectors, byUser }
}

// Top-k by dot product (vectors are unit norm, so this is cosine). Optional
// restriction to one mailbox's rows for per-user retrieval.
export function denseSearch(index, query, k, user = null) {
    const rows = user ? index.byUser.get(user) ?? [] : null
    const count = rows ? rows.length : index.paths.length
    const topScores = new Float32Array(k).fill(-Infinity)
    const topRows = new Int32Array(k).fill(-1)
    const { vectors } = index
    for (let position = 0; position < count; position++) {
        const row = rows ? rows[position] : position
        const offset = row * EMBED_DIM
        let score = 0
        for (let d = 0; d < EMBED_DIM; d++) score += vectors[offset + d] * query[d]
        if (score <= topScores[k - 1]) continue
        let slot = k - 1
        while (slot > 0 && topScores[slot - 1] < score) {
            topScores[slot] = topScores[slot - 1]
            topRows[slot] = topRows[slot - 1]
            slot--
        }
        topScores[slot] = score
        topRows[slot] = row
    }
    const out = []
    for (let slot = 0; slot < k; slot++) if (topRows[slot] >= 0) out.push({ path: index.paths[topRows[slot]], score: topScores[slot] })
    return out
}

export function writeJson(path, value) {
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(value) + "\n")
    renameSync(temporary, path)
}

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))
export { readSync }
