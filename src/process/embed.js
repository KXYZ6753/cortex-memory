import { setTimeout as delay } from "node:timers/promises"

const OLLAMA_URL = "http://localhost:11434/api/embed"
export const EMBEDDING_MODEL = process.env.OLLAMA_EMBED_MODEL;
const EMBEDDING_DIMENSIONS = process.env.OLLAMA_EMBED_DIMENSIONS // must match Entry embedding columns
const MAX_ATTEMPTS = Math.min(5, Math.max(1, Number(process.env.OLLAMA_MAX_ATTEMPTS) || 3))
const TIMEOUT_MS = Math.max(1_000, Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || 30_000)

// Turn text into a 768-dim vector for semantic search. Returns number[].
export async function embed(text, { signal, prefix = "", maxAttempts = MAX_ATTEMPTS, retryDelayMs = 500 } = {}) {
    if (typeof text !== "string" || !text.trim()) throw new TypeError("Embedding input text is required")
    maxAttempts = Math.min(5, Math.max(1, Number(maxAttempts) || 1))
    retryDelayMs = Math.min(10_000, Math.max(0, Number(retryDelayMs) || 0))

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const requestSignal = signal
                ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
                : AbortSignal.timeout(TIMEOUT_MS)
            const res = await fetch(OLLAMA_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: EMBEDDING_MODEL, input: prefix + text, truncate: true, keep_alive: "30m" }),
                signal: requestSignal,
            })
            if (!res.ok) {
                const error = new Error(`Ollama embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
                error.retryable = res.status === 408 || res.status === 429 || res.status >= 500
                throw error
            }
            let data
            try {
                data = await res.json()
            } catch (error) {
                error.retryable = true
                throw error
            }
            const embedding = data.embeddings?.[0]
            if (!Array.isArray(embedding) || !embedding.every(Number.isFinite)) {
                const error = new Error("Ollama returned no embedding array")
                error.retryable = true
                throw error
            }
            if (embedding.length !== EMBEDDING_DIMENSIONS) {
                throw new Error(`${EMBEDDING_MODEL} returned ${embedding.length} dimensions; the database expects ${EMBEDDING_DIMENSIONS}`)
            }
            return embedding
        } catch (error) {
            if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error
            const retryable = error.retryable ?? (error.name === "TimeoutError" || error instanceof TypeError)
            if (!retryable || attempt === maxAttempts) {
                throw new Error(`Ollama embeddings failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${error.message}`, { cause: error })
            }
            await delay(retryDelayMs * 2 ** (attempt - 1), undefined, { signal })
        }
    }
}
