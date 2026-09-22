// Grading for premise2: reference-based judges (J1, J2), an evidence-grounded
// adjudicator from a third model family, deterministic abstention/failure handling,
// and machine verification of every supporting quote.
//
// No human labels exist, so correctness rests on: two judges from different
// families, blind adjudication in BOTH directions (disagreements, consensus-
// INCORRECT answers, and a random 10% of consensus-CORRECT answers), quotes that
// must occur verbatim in an answer-bearing email (never a distractor), and a
// non-LLM critical-span score as an anchor.

import { setTimeout as delay } from "node:timers/promises"
import { chat } from "./ollama.js"
import { sha256, normaliseForMatch, keyedRandom, criticalSpans, spanHaystack, spanPresent } from "./text.js"
import { isAbstain } from "./prompts.js"
import { JUDGES } from "./cells.js"

export const RUBRIC_VERSION = "premise2-rubric-v1"

export class JudgePaused extends Error {}
// Not signed in / key rejected: retrying will not help until a human acts. It is a
// JudgePaused, so the in-run DEV grading keeps waiting (the user may sign in again),
// while the post-run grading stops the pass and says what to do.
export class JudgeAuthError extends JudgePaused {}

// Pinned judge configurations, shared by the in-run DEV grading, TEST grading and
// the report. Every verdict key includes model, provider and think setting, so
// switching any of them (e.g. J2 to OpenRouter after running out of cloud credits)
// re-judges instead of silently mixing verdicts.
export function judgeConfig(role) {
    if (role === "j1") return { role, provider: "ollama", model: process.env.POC2_J1_MODEL ?? JUDGES.j1.model, think: process.env.POC2_J1_THINK ?? "low" }
    if (role === "j2") return { role, provider: process.env.POC2_J2_PROVIDER ?? "ollama", model: process.env.POC2_J2_MODEL ?? JUDGES.j2.model, think: false }
    if (role === "adj") return { role, provider: process.env.POC2_ADJ_PROVIDER ?? "ollama", model: process.env.POC2_ADJ_MODEL ?? JUDGES.adjudicator.model, think: false }
    throw new Error(`unknown judge role ${role}`)
}

const VERDICT_SCHEMA = {
    type: "object",
    properties: {
        verdict: { type: "string", enum: ["CORRECT", "INCORRECT"] },
        partsAsked: { type: "integer" },
        partsCorrect: { type: "integer" },
        missing: { type: "string" },
        reason: { type: "string" },
    },
    required: ["verdict", "partsAsked", "partsCorrect", "missing", "reason"],
}

const ADJUDICATION_SCHEMA = {
    type: "object",
    properties: {
        verdict: { type: "string", enum: ["CORRECT", "INCORRECT"] },
        quotes: { type: "array", items: { type: "object", properties: { text: { type: "string" }, supports: { type: "string" } }, required: ["text", "supports"] } },
        missing: { type: "string" },
        referenceError: { type: "boolean" },
        reason: { type: "string" },
    },
    required: ["verdict", "quotes", "missing", "referenceError", "reason"],
}

export function referencePrompt({ question, references, candidate }) {
    return `You grade a candidate answer to a question about an email.

Question: ${question}

Reference answers (any one of these counts as fully correct):
${references.map((reference, index) => `${index + 1}. ${reference}`).join("\n")}

Candidate answer: ${candidate}

Rules:
- Judge only what the question asks. The candidate is CORRECT if it states the same fact(s) as a reference, even if worded differently, much longer, or quoting the email literally.
- If the question asks for several things, every requested part must be present for CORRECT.
- Extra correct detail is fine. Extra detail that contradicts a reference makes it INCORRECT.
- INCORRECT if it states a different fact, omits a requested part, refuses, or says the information is not available.
- Ignore style, length and formatting.

Reply with JSON only: {"verdict": "CORRECT" or "INCORRECT", "partsAsked": <integer>, "partsCorrect": <integer>, "missing": "<the missing or contradicted reference fact, or empty>", "reason": "<at most 15 words>"}`
}

export function adjudicationPrompt({ question, references, candidate, emails }) {
    return `You check whether a candidate answer to a question about emails is correct. You see the emails the answerer saw and reference answers written by another model.

Question: ${question}

Reference answers:
${references.map((reference, index) => `${index + 1}. ${reference}`).join("\n")}

Emails the answerer saw:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}
EMAILS>>>

Candidate answer: ${candidate}

Decide CORRECT if the candidate answers everything the question asks and agrees with the facts in the emails; the references may be worded differently or be incomplete. Decide INCORRECT if it states a different fact, misses a requested part, relies on the wrong email, or is not supported by the emails.
For a CORRECT verdict, give 1 to 3 short quotes (each under 200 characters) copied exactly, character for character, from the emails, each supporting a fact in the candidate. If you believe the reference answers are themselves wrong, set referenceError to true.

Reply with JSON only: {"verdict": "CORRECT" or "INCORRECT", "quotes": [{"text": "<exact quote>", "supports": "<fact>"}], "missing": "<what is missing or wrong, or empty>", "referenceError": false, "reason": "<at most 20 words>"}`
}

export const RUBRIC_HASH = sha256([RUBRIC_VERSION, referencePrompt({ question: "Q", references: ["R"], candidate: "C" }), adjudicationPrompt({ question: "Q", references: ["R"], candidate: "C", emails: ["E"] })].join("\n--8<--\n"))

export const normaliseAnswer = (answer) => String(answer ?? "").trim().replace(/\s+/g, " ")
const referencesHash = (references) => sha256(references.join("\n"))

export function verdictKey({ questionKey, references, answer, judge, promptSha = null }) {
    return sha256([questionKey, referencesHash(references), normaliseAnswer(answer), judge.model, judge.provider, judge.think ?? "", RUBRIC_HASH, promptSha ?? ""].join("|"))
}

function parseJson(text) {
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        const match = text.match(/\{[\s\S]*\}/)
        if (!match) return null
        try {
            return JSON.parse(match[0])
        } catch {
            return null
        }
    }
}

const LIMIT = /usage limit|rate limit|quota|subscription|upgrade|too many requests|credits|payment/i

// One judge call against Ollama (cloud or local) or OpenRouter. Throws JudgePaused
// on usage-limit errors so the caller can checkpoint and stop cleanly.
export async function callJudge(judge, prompt, schema, { ollamaUrl = "http://localhost:11434", timeoutMs = 180_000 } = {}) {
    if (judge.provider === "openrouter") {
        const key = process.env.OPENROUTER_API_KEY
        if (!key) throw new JudgePaused("OPENROUTER_API_KEY is not set")
        for (let attempt = 1; attempt <= 4; attempt++) {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
                body: JSON.stringify({ model: judge.model, messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: 1024, response_format: { type: "json_object" } }),
                signal: AbortSignal.timeout(timeoutMs),
            }).catch((error) => ({ ok: false, status: 0, text: async () => error.message }))
            if (response.ok) {
                const data = await response.json()
                return { text: data.choices?.[0]?.message?.content ?? "", usage: data.usage ?? null }
            }
            const body = await response.text()
            if (response.status === 401 || response.status === 403) throw new JudgeAuthError(`OpenRouter ${response.status}: ${body.slice(0, 200)}. Check OPENROUTER_API_KEY.`)
            if (response.status === 402 || response.status === 429 || LIMIT.test(body)) throw new JudgePaused(`OpenRouter ${response.status}: ${body.slice(0, 200)}`)
            await delay(3000 * attempt)
        }
        throw new Error("OpenRouter judge failed after retries")
    }
    const result = await chat({
        url: ollamaUrl,
        model: judge.model,
        prompt,
        format: schema,
        think: judge.think ?? false,
        options: { temperature: 0, top_p: 1, seed: 42, num_predict: judge.numPredict ?? 1536 },
        keepAlive: "30m",
        timeoutMs,
        attempts: 4,
    })
    if (result.status === "ok" || result.status === "output_limit") return { text: result.answer, usage: { prompt: result.promptEvalCount, completion: result.evalCount }, thinkingChars: result.thinkingChars }
    const text = String(result.error ?? "")
    if (result.httpStatus === 401 || result.httpStatus === 403) throw new JudgeAuthError(`${judge.model}: HTTP ${result.httpStatus} ${text.slice(0, 200)}. Run "ollama signin", then rerun.`)
    if (result.httpStatus === 402 || result.httpStatus === 429 || LIMIT.test(text)) {
        throw new JudgePaused(`${judge.model}: HTTP ${result.httpStatus ?? "?"} ${text.slice(0, 200)}. For cloud models run "ollama signin" or wait for the usage window; then rerun the judge stage.`)
    }
    throw new Error(`${judge.model} failed: ${result.status} ${text.slice(0, 200)}`)
}

export async function referenceVerdict(judge, item, options) {
    const { text } = await callJudge(judge, referencePrompt(item), VERDICT_SCHEMA, options)
    const parsed = parseJson(text)
    const verdict = parsed?.verdict === "CORRECT" || parsed?.verdict === "INCORRECT" ? parsed.verdict : null
    return {
        verdict,
        parseFailed: verdict === null,
        partsAsked: Number.isInteger(parsed?.partsAsked) ? parsed.partsAsked : null,
        partsCorrect: Number.isInteger(parsed?.partsCorrect) ? parsed.partsCorrect : null,
        missing: typeof parsed?.missing === "string" ? parsed.missing.slice(0, 300) : null,
        reason: typeof parsed?.reason === "string" ? parsed.reason.slice(0, 200) : null,
        raw: verdict === null ? String(text ?? "").slice(0, 300) : undefined,
    }
}

const quoteNormal = (text) => normaliseForMatch(text).replace(/\s+/g, " ").replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,;:]+$/g, "").trim()

// A quote counts only if it occurs verbatim (after whitespace/QP/case
// normalisation) in an email that is allowed to support the answer: the gold,
// one of its twins, or an email that carries the answer. Quotes found only in a
// distractor never count, so an answer copied from a distractor cannot be
// "verified" by quoting that distractor.
export function verifyQuotes(quotes, supportingEmails) {
    const haystacks = supportingEmails.map((email) => quoteNormal(email))
    const results = (quotes ?? []).slice(0, 3).map((quote) => {
        const needle = quoteNormal(quote?.text ?? "")
        const verified = needle.length >= 8 && haystacks.some((hay) => hay.includes(needle))
        return { text: String(quote?.text ?? "").slice(0, 240), supports: String(quote?.supports ?? "").slice(0, 200), verified }
    })
    return { quotes: results, verifiedCount: results.filter((quote) => quote.verified).length }
}

export async function adjudicate(judge, item, supportingEmails, options) {
    const { text } = await callJudge(judge, adjudicationPrompt(item), ADJUDICATION_SCHEMA, options)
    const parsed = parseJson(text)
    const raw = parsed?.verdict === "CORRECT" || parsed?.verdict === "INCORRECT" ? parsed.verdict : null
    const { quotes, verifiedCount } = verifyQuotes(parsed?.quotes, supportingEmails)
    // An unverified CORRECT is downgraded: the adjudicator must show its evidence.
    const verdict = raw === "CORRECT" && verifiedCount === 0 ? "INCORRECT" : raw
    return {
        verdict,
        rawVerdict: raw,
        parseFailed: raw === null,
        quotes,
        verifiedCount,
        unverifiedCorrect: raw === "CORRECT" && verifiedCount === 0,
        referenceError: parsed?.referenceError === true,
        missing: typeof parsed?.missing === "string" ? parsed.missing.slice(0, 300) : null,
        reason: typeof parsed?.reason === "string" ? parsed.reason.slice(0, 200) : null,
    }
}

// Deterministic non-LLM anchor: when the gold has critical spans (URLs, dates,
// numbers, contacts), is every one of them in the answer? null when not applicable.
export function spanScore(answer, gold) {
    const spans = criticalSpans(gold)
    if (!spans.length) return null
    const hay = spanHaystack(answer ?? "")
    return spans.every((span) => spanPresent(span, hay)) ? 1 : 0
}

// Deterministic pre-grading: technical failures and exact abstentions never reach
// an LLM judge.
export function preGrade(answerRecord) {
    if (answerRecord.status !== "ok" && answerRecord.status !== "output_limit") return { final: "INCORRECT", source: "technical", technical: answerRecord.status }
    if (isAbstain(answerRecord.answer)) return { final: "INCORRECT", source: "abstain", abstain: true }
    return null
}

// Whether a consensus-CORRECT answer is in the seeded 10% audit sample.
export const inCorrectAudit = (key, seed = 42, rate = 0.1) => keyedRandom(seed, `audit:${key}`)() < rate
