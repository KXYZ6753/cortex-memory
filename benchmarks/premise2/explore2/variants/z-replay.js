// Worker z: new reading methods tested as REPLAYS of the champion x1 (diagnostic screening).
// See docs/premise-study/explore2/z.md.
//
// A replay variant reads x1's stored answer for the same set and question. On questions
// where x1 answered confidently from its commit ("commit" step: gates' prompt, ~45%)
// it returns x1's stored answer unchanged (no model call). On every other question
// (commit-g5 handover, found, nofound, nopick: the "unsure" half where nearly all of
// x1's errors are) it re-reads x1's FINAL context (same emails, same order) with a new
// reading method. So each changed verdict is a paired effect of the reading method on an
// identical context; the upstream agent is not re-run (it is not perfectly reproducible
// across runs, see x.md). A real (non-replay) variant follows if a method wins.
//
//   z-think1  thinking mode (think: true) over the sandwich prompt, num_predict 1024
//             (thinking + answer); if the budget runs out before an answer -> x1's answer.
//   z-ext1    structured extraction: JSON-schema output {email, quote, answer}; the quote
//             must occur (near-)verbatim in the named email, else x1's answer is kept.
//
// The set name comes from the CLI (`cli2.js run <set> ...`), since ctx does not carry it.
import { join } from "node:path"
import { sandwichPrompt } from "../../explore/variants.js"
import { latestAnswers } from "../../explore/grade.js"
import { ABSTAIN, isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"

const setName = () => (process.argv[2] === "run" ? process.argv[3] : process.env.Z_SET)
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

async function x1Stored(ctx, record) {
    const index = await ctx.resource(`z-x1-${setName()}`, () => {
        const map = new Map()
        for (const a of latestAnswers(ctx.dataDir)) if (a.variant === "x1" && a.version === "1+cold" && a.set === setName()) map.set(a.questionKey, a)
        return { map, close() {} }
    })
    return index.map.get(record.questionKey) ?? null
}

// x1's final reading context: g5's final read set on a handover, else x1's first context.
export const finalContextOf = (x) => (x.step === "commit-g5" ? x.readPaths : x.contextPaths)

const keep = (x, extra = {}) => ({
    status: x.status, answer: x.answer, contextPaths: x.contextPaths, readPaths: x.readPaths,
    replay: true, x1Step: x.step, x1Wall: x.wallMs, x1Calls: x.calls, changed: false, ...extra,
})

// ---- thinking ----
async function thinkRead(ctx, record, { budget = 1024 } = {}) {
    const x = await x1Stored(ctx, record)
    if (!x) return { status: "http_error", answer: "", error: "no stored x1 answer" }
    if (x.step === "commit") return keep(x)
    const paths = finalContextOf(x)
    const started = performance.now()
    const data = await ctx.chatRaw({ messages: [{ role: "user", content: sandwichPrompt(record.question, paths.map((p) => ctx.emailOf(p))) }], think: true, truncate: false, options: generationOptions({ num_predict: budget }) })
    const ms = Math.round(performance.now() - started)
    const answer = String(data.message?.content ?? "").trim()
    const thinking = String(data.message?.thinking ?? "")
    const diag = { thinkMs: ms, thinkChars: thinking.length, thinkTokens: data.eval_count ?? null, doneReason: data.done_reason ?? null, thinkError: data.error ? String(data.error).slice(0, 200) : undefined, x1Answer: x.answer }
    if (data.error || !answer) return keep(x, { ...diag, fallback: data.error ? "error" : "budget" })
    return { ...keep(x, diag), status: "ok", answer, changed: answer !== x.answer, thinking: thinking.slice(0, 4000) }
}

// ---- structured extraction with a verbatim-quote check ----
const EXTRACT_SCHEMA = {
    type: "object",
    properties: { email: { type: "integer" }, quote: { type: "string" }, answer: { type: "string" } },
    required: ["email", "quote", "answer"],
}
export function extractPrompt(question, emails) {
    return `Find the answer to a question in a person's emails.

Question: ${question}

Emails:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}
EMAILS>>>

Question: ${question}

Reply in JSON with three fields:
- "email": the number of the email that answers the question (0 if none does),
- "quote": the sentence or sentences of that email that contain the answer, copied word for word,
- "answer": the answer to every part of the question in one or two sentences, based on the quote. If no email answers it, "${ABSTAIN}".`
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%./:@-]+/g, " ").replace(/\s+/g, " ").trim()
// Share of the quote's word 4-grams found in the email (1 = verbatim up to punctuation/space).
export function quoteSupport(quote, email) {
    const q = norm(quote).split(" "), e = ` ${norm(email)} `
    if (q.length < 4) return q.join(" ") && e.includes(` ${q.join(" ")} `) ? 1 : 0
    let hit = 0, n = 0
    for (let i = 0; i + 4 <= q.length; i++) { n++; if (e.includes(` ${q.slice(i, i + 4).join(" ")} `)) hit++ }
    return n ? hit / n : 0
}
async function extractRead(ctx, record, { minSupport = 0.8 } = {}) {
    const x = await x1Stored(ctx, record)
    if (!x) return { status: "http_error", answer: "", error: "no stored x1 answer" }
    if (x.step === "commit") return keep(x)
    const paths = finalContextOf(x)
    const emails = paths.map((p) => ctx.emailOf(p))
    const started = performance.now()
    const data = await ctx.chatRaw({ messages: [{ role: "user", content: extractPrompt(record.question, emails) }], format: EXTRACT_SCHEMA, truncate: false, options: generationOptions({ num_predict: 400 }) })
    const ms = Math.round(performance.now() - started)
    let parsed = null
    try { parsed = JSON.parse(data.message?.content ?? "") } catch {}
    const n = Number(parsed?.email)
    const email = n >= 1 && n <= emails.length ? emails[n - 1] : null
    const support = email && parsed?.quote ? quoteSupport(parsed.quote, email) : 0
    const answer = String(parsed?.answer ?? "").trim()
    const diag = { extMs: ms, extEmail: Number.isFinite(n) ? n : null, extPath: email ? paths[n - 1] : null, extQuote: String(parsed?.quote ?? "").slice(0, 600), extAnswer: answer.slice(0, 600), support: r3(support), x1Answer: x.answer, extError: data.error ? String(data.error).slice(0, 200) : undefined }
    if (!parsed || !answer || isAbstain(answer) || support < minSupport) return keep(x, { ...diag, fallback: !parsed ? "parse" : support < minSupport ? "unverified" : "abstain" })
    return { ...keep(x, diag), status: "ok", answer, changed: answer !== x.answer }
}

export const VARIANTS = {
    "z-think1": { version: 1, describe: "REPLAY of x1: keep x1's confident commit answers; re-read x1's final context with thinking mode (num_predict 1024) on all other questions", run: (ctx, record) => thinkRead(ctx, record) },
    "z-ext1": { version: 1, describe: "REPLAY of x1: keep x1's confident commit answers; elsewhere JSON {email, quote, answer} over x1's final context, used only when the quote is verbatim (4-gram support >= 0.8) in the named email", run: (ctx, record) => extractRead(ctx, record) },
}
