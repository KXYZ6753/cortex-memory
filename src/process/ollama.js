
const OLLAMA_URL = "http://localhost:11434/api/chat"
const MODEL = "gemma4:e4b"
/*
Notes about past models:
*  Thiking with some models didn't work, for that reason it is disabled.
*  Failed models: qwen3.5, gemma4:e4b-mlx
   * MLX took too long to load, try again later with a different setup (maybe)
*/

const schema = { // Format the LLM must follow
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

// todo: give / pass the type of entry it is such as an email or a message etc
function buildPrompt(text) {
    const today = new Date().toISOString().slice(0, 10) // example: "2026-06-21"
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

const MAX_CHARS = 4000 // Cutoff to keep model efficient since they have relatively small context
// todo: look into if a lot of info is lost after cutting that many characters and see if there is an efficient way to handle this

export async function processText(text, { signal } = {}) {
    const processStartTime = Date.now()
    if (process.env.DEBUG_LOGGING === 'true') {console.log("Ollama - processText, PROCESS START")}
    let res
    try {
        res = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: "user", content: buildPrompt(text.slice(0, MAX_CHARS)) }],
                format: schema,
                stream: false,
                // Think: false // Had some issues with not responding in JSON when thinking is on
                options: { temperature: 0 }, // deterministic extraction
            }),
            signal: signal ?? AbortSignal.timeout(120_000), // Longer wait times for cold loads or initial start up times (compared to 60)
        })
    } catch (err) {
        if (err.name === "TimeoutError") {
            throw new Error(`Ollama process timed out after 120s — the model may still be loading. Try again.`)
        }
        throw new Error(`Could not reach Ollama at ${OLLAMA_URL} — is it running? (${err.message})`)
    }

    if (!res.ok) {
        throw new Error(`Ollama error: ${res.status} ${await res.text()}`)
    } else {
        if (process.env.DEBUG_LOGGING === 'true') {console.log("Ollama - processText, PROCESS COMPLETE - " +((Date.now() - processStartTime)/1000) + "s - "+ (Date.now() - processStartTime) + "ms");}
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