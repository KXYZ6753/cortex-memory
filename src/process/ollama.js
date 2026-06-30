
const OLLAMA_URL = "http://localhost:11434/api/chat"
const MODEL = "gemma4:e4b" // non-thinking; honors `format`. Failed models: qwen3.5

// Constrained decoding: the model is forced to match this exact shape.
// additionalProperties:false stops the model sneaking in extra keys.
const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        summary:    { type: "string" },
        importance: { type: "integer", minimum: 1, maximum: 5 },
        tags:       { type: "array", items: { type: "string" } },
        events: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    title:       { type: "string" },
                    date:        { type: ["string", "null"] }, // YYYY-MM-DD, or null when unknown
                    description: { type: ["string", "null"] },
                },
                required: ["title", "date"],
            },
        },
    },
    required: ["summary", "importance", "tags", "events"],
}

// The instructions to the model. This is the part you'll tune the most.
function buildPrompt(text) {
    const today = new Date().toISOString().slice(0, 10) // e.g. "2026-06-21"
    return `
Today's date is ${today}.
Extract structured info from the text below.
- summary: one short sentence.
- importance: 1 to 5, how much this matters to the person. Use 1 for spam (unsolicited ads, phishing, mass-mail, or other junk), use 5 for critical.
- tags: a few short, lowercase keywords for searching later.
- events: anything with a future date or deadline. Resolve relative dates (e.g. "next Friday") against today's date and output them as YYYY-MM-DD. Use null for date if unclear. Return an empty array if there are no events.
Text:
"""
${text}
"""
`
}

export async function processText(text, { signal } = {}) {
    let res
    try {
        res = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: "user", content: buildPrompt(text) }],
                format: schema,             // constrained decoding does the real work
                stream: false,
                // Think: false silently disables the format grammar on old thinking models, so the model returns prose, not JSON. Leave it out.
                options: { temperature: 0 }, // deterministic extraction
            }),
            signal: signal ?? AbortSignal.timeout(60_000), // don't hang forever
        })
    } catch (err) {
        if (err.name === "TimeoutError") {
            throw new Error(`Ollama timed out after 60s — the model may still be loading. Try again.`)
        }
        throw new Error(`Could not reach Ollama at ${OLLAMA_URL} — is it running? (${err.message})`)
    }

    if (!res.ok) {
        throw new Error(`Ollama error: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    const content = data?.message?.content // chat endpoint -> message.content
    if (typeof content !== "string") {
        throw new Error(`Unexpected Ollama response shape: ${JSON.stringify(data)}`)
    }

    try {
        return JSON.parse(content)
    } catch {
        throw new Error(`Model did not return valid JSON: ${content.slice(0, 500)}`)
    }
}