const OLLAMA_URL = "http://localhost:11434/api/embeddings"
const MODEL = "nomic-embed-text" // 768-dim; must match Entry.summaryEmbedding vector(768)

// Turn text into a 768-dim vector for semantic search. Returns number[].
export async function embed(text, { signal, prefix = "" } = {}) {
    let res
    try {
        res = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: MODEL, prompt: prefix + text }),
            signal: signal ?? AbortSignal.timeout(60_000),
        })
    } catch (err) {
        if (err.name === "TimeoutError") {
            throw new Error(`Ollama embeddings timed out after 60s — the model may still be loading. Try again.`)
        }
        throw new Error(`Could not reach Ollama at ${OLLAMA_URL} — is it running? (${err.message})`)
    }

    if (!res.ok) {
        throw new Error(`Ollama embeddings error: ${res.status} ${await res.text()}`)
    }

    const { embedding } = await res.json()
    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error(`Unexpected embeddings response — no embedding array`)
    }
    return embedding
}
