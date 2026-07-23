
import { setTimeout as delay } from "node:timers/promises"

const OLLAMA_URL = "http://localhost:11434/api/chat"
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:2b"
const MAX_ATTEMPTS = Math.min(5, Math.max(1, Number(process.env.OLLAMA_MAX_ATTEMPTS) || 3))
const REQUEST_TIMEOUT_MS = Math.max(1_000, Number(process.env.OLLAMA_TIMEOUT_MS) || 60_000)
const TOTAL_TIMEOUT_MS = Math.max(REQUEST_TIMEOUT_MS, Number(process.env.OLLAMA_TOTAL_TIMEOUT_MS) || 150_000)
/*
Benchmarked on and results on Macbook AirM4/16 GB:
 -> qwen3.5:2b  ~2.2s after initial load; 4/5 checks
 -> gemma4:e4b  ~8.6s after initial load; 5/5 checks
 -> gemma4:e2b-mlx did obey the JSON schema.
*/

export const schema = {
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
                    title: { type: "string" },
                    date:  { type: "string" },
                },
                required: ["title", "date"],
            },
        },
    },
    required: ["summary", "importance", "tags", "events"],
}

// todo: give / pass the type of entry it is such as an email or a message etc
export function buildPrompt(text, now = new Date()) {
    const today = now.toISOString().slice(0, 10) // example: "2026-06-21"
    const dateAfter = (days) => {
        const date = new Date(now)
        date.setUTCDate(date.getUTCDate() + days)
        return date.toISOString().slice(0, 10)
    }
    // Not 100% accurate but best attempt to provide context for the dates that are not known - appends the calculated date after the phrases like "tomorrow"
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const annotatedText = text
        .replace(/\b(today|tomorrow)\b/gi, (phrase) => `${phrase} [date: ${dateAfter(phrase.toLowerCase() === "tomorrow" ? 1 : 0)}]`)
        .replace(/\b(?:(next|this)\s+)?(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b(?!,?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b)/gi, (phrase, modifier, weekday) => {
            let days = (weekdays.indexOf(weekday[0].toUpperCase() + weekday.slice(1).toLowerCase()) - now.getUTCDay() + 7) % 7
            if (modifier?.toLowerCase() === "next" && days === 0) days = 7
            return `${phrase} [date: ${dateAfter(days)}]`
        })
        .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\b/gi, (phrase, month, day, year) => {
            const date = `${year}-${String(months.findIndex((name) => name.toLowerCase() === month.toLowerCase()) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            return `${phrase} [date: ${date}]`
        })
    return `Today: ${today}

Read the message and fill the required JSON fields.
- summary: One short factual sentence. Do not start with "This email" or "This message".
- importance: Impact on the recipient: 1=junk, advertisement, scam, or phishing; 2=routine information; 3=useful or actionable; 4=important; 5=urgent or critical. Scam/phishing is always 1 even when it claims urgency.
- tags: 2-5 short, lowercase topic words. No duplicates.
- events: Record every real occurrence with a date: past or future appointments, meetings, deadlines, due dates, reservations, trips, and completed activities. Never filter by whether its date is past or future.
  - Copy each provided [date: YYYY-MM-DD] annotation exactly into event.date. Resolve other relative dates using Today. Never invent a date.
  - "Immediately", "soon", and "urgent" are not dates. An action without a stated date is not an event.
  - Give each event a self-contained title describing what happens. Bad: "Appointment". Good: "Attend dentist appointment". Bad: "Payment due". Good: "Pay car insurance premium".
  - Ignore dates that are only in footers, signatures, identifiers, or unrelated background information.
  - If there is no dated event, return an empty array.

Message:
"""${annotatedText}"""`
}

const MAX_CHARS = 4000 // Cutoff to keep model efficient since they have relatively small context
// todo: look into if a lot of info is lost after cutting that many characters and see if there is an efficient way to handle this

function retryableError(message, code, cause) {
    return Object.assign(new Error(message, { cause }), { code, retryable: true })
}

function debugBlock(title, content) {
    if (process.env.OLLAMA_DEBUG !== "true") return
    console.log(`\n${"=".repeat(72)}\n${title}\n${"-".repeat(72)}\n${content}\n${"=".repeat(72)}\n`)
}

function validateExtraction(value) {
    if (!value || typeof value !== "object") return "response is not an object"
    if (typeof value.summary !== "string" || !value.summary.trim()) return "summary is missing"
    if (!Number.isInteger(value.importance) || value.importance < 1 || value.importance > 5) return "importance must be an integer from 1 to 5"
    if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) return "tags must be strings"
    if (!Array.isArray(value.events)) return "events must be an array"
    if (!value.events.every((event) => event && typeof event.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date))) return "events have an invalid shape"
    return null
}

async function attemptProcess(text, attempt, signal, referenceDate) {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    const retryInstruction = attempt > 1
        ? `\nRetry ${attempt}: the previous response was invalid or incomplete. Return one complete, concise JSON object only.`
        : ""
    const prompt = buildPrompt(text.slice(0, MAX_CHARS), referenceDate) + retryInstruction
    debugBlock(`OLLAMA INPUT | ${MODEL} | ATTEMPT ${attempt}`, prompt)
    let res
    try {
        res = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: "user", content: prompt }],
                format: schema,
                stream: false,
                think: false,
                keep_alive: "30m",
                options: { temperature: 0, num_ctx: 2048, num_predict: attempt === 1 ? 512 : 1024 },
            }),
            signal: requestSignal,
        })
    } catch (error) {
        if (signal.aborted) throw error
        throw retryableError(`Ollama request failed: ${error.message}`, "OLLAMA_NETWORK", error)
    }

    if (!res.ok) {
        const detail = (await res.text()).slice(0, 500)
        const error = new Error(`Ollama HTTP ${res.status}: ${detail}`)
        error.code = "OLLAMA_HTTP"
        error.retryable = res.status === 408 || res.status === 429 || res.status >= 500
        throw error
    }

    let data
    try {
        data = await res.json()
    } catch (error) {
        throw retryableError("Ollama returned an unreadable response", "OLLAMA_BAD_RESPONSE", error)
    }

    const content = data?.message?.content
    if (typeof content !== "string") {
        throw retryableError("Ollama response did not contain message.content", "OLLAMA_BAD_RESPONSE")
    }

    let value
    try {
        value = JSON.parse(content)
    } catch (error) {
        debugBlock(`OLLAMA RAW OUTPUT | ${MODEL} | ATTEMPT ${attempt}`, content)
        const preview = content.replace(/\s+/g, " ").slice(0, 240)
        throw retryableError(`Model returned invalid JSON${data.done_reason ? ` (${data.done_reason})` : ""}: ${preview}`, "OLLAMA_INVALID_JSON", error)
    }
    debugBlock(`OLLAMA JSON OUTPUT | ${MODEL} | ATTEMPT ${attempt}`, JSON.stringify(value, null, 2))

    const issue = validateExtraction(value)
    if (issue) throw retryableError(`Model returned invalid structured data: ${issue}`, "OLLAMA_INVALID_DATA")
    return value
}

export async function processText(text, { signal, referenceDate = new Date(), maxAttempts = MAX_ATTEMPTS, retryDelayMs = 500 } = {}) {
    if (typeof text !== "string" || !text.trim()) throw new TypeError("Ollama input text is required")
    referenceDate = new Date(referenceDate)
    if (Number.isNaN(referenceDate.valueOf())) throw new TypeError("Ollama reference date is invalid")
    const processStartTime = Date.now()
    if (process.env.DEBUG_LOGGING === 'true') {console.log("Ollama - processText, PROCESS START")}
    const totalTimeout = AbortSignal.timeout(TOTAL_TIMEOUT_MS)
    const totalSignal = signal ? AbortSignal.any([signal, totalTimeout]) : totalTimeout
    maxAttempts = Math.min(5, Math.max(1, Number(maxAttempts) || 1))
    retryDelayMs = Math.min(10_000, Math.max(0, Number(retryDelayMs) || 0))

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const value = await attemptProcess(text, attempt, totalSignal, referenceDate)
            if (process.env.DEBUG_LOGGING === 'true') console.log(`Ollama - processText, COMPLETE attempt ${attempt}/${maxAttempts} - ${((Date.now() - processStartTime) / 1000).toFixed(2)}s`)
            return value
        } catch (error) {
            if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error
            if (totalTimeout.aborted) throw new Error(`Ollama processing exceeded ${TOTAL_TIMEOUT_MS / 1000}s total`, { cause: error })
            if (!error.retryable || attempt === maxAttempts) {
                throw new Error(`Ollama failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${error.message}`, { cause: error })
            }
            if (process.env.DEBUG_LOGGING === 'true') console.warn(`Ollama - retrying after ${error.code}: attempt ${attempt}/${maxAttempts}`)
            try {
                await delay(retryDelayMs * 2 ** (attempt - 1), undefined, { signal: totalSignal })
            } catch (abortError) {
                if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError
                throw new Error(`Ollama processing exceeded ${TOTAL_TIMEOUT_MS / 1000}s total`, { cause: abortError })
            }
        }
    }
}
