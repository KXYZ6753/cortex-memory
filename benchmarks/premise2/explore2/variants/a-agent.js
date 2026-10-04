// Worker `a` agents for e2b: the harness drives a short loop and every model step is
// one tiny constrained choice (a number, or MORE/NONE), never a free-form tool call.
// Why: the frozen tool agent (agent@1, FULL-0) answered from snippets without opening
// anything in 202/600 episodes (13 correct), and left the evidence shown-but-unopened
// in 277; when it did open the evidence it was right 171/215 (80%). So: never let the
// model answer from snippets, never let it write queries; let it only point.
//
//   a2  list picker: one line per candidate (sender | subject | the body window that
//       best matches the question), candidates = gates' two contexts + the asker's
//       mailbox BM25 top 20 (<= 15 lines). The model picks one number; the harness
//       opens that email alone and asks the question (sandwich). On NOT IN EMAILS it
//       picks again (the tried email is marked); after 2 reads it answers from gates'
//       first context.
//   a3  read-and-point: the model reads gates' first context (5 full emails) and
//       replies with the number of the email that answers, or MORE (then the second
//       context). The pointed email is then read alone. MORE twice: answer from the
//       first context.
import { sandwichPrompt, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { splitFile, parseFileHeader, decodeQuotedPrintable, hasQuotedPrintable, contentWords, normaliseForMatch } from "../../text.js"
import { ok } from "./a-common.js"

const PICK_OPTIONS = () => generationOptions({ num_predict: 12 })

// Body window (about `chars` long) with the most question content words.
export function focusSnippet(email, question, chars = 260) {
    const { header, body } = splitFile(email ?? "")
    const parsed = parseFileHeader(header)
    const flat = (hasQuotedPrintable(body) ? decodeQuotedPrintable(body) : body).replace(/\s+/g, " ").trim()
    const words = new Set(contentWords(question))
    let best = { score: -1, start: 0 }
    const lower = normaliseForMatch(flat)
    for (let start = 0; start < Math.max(1, lower.length - chars / 2); start += 60) {
        const window = new Set(contentWords(lower.slice(start, start + chars)))
        let score = 0
        for (const word of words) if (window.has(word)) score++
        if (score > best.score) best = { score, start }
    }
    let text = flat.slice(best.start, best.start + chars)
    if (best.start > 0) text = `… ${text.replace(/^\S*\s/, "")}`
    if (best.start + chars < flat.length) text = `${text.replace(/\s\S*$/, "")} …`
    return { subject: parsed.subject, sender: parsed.sender, text }
}

export function pickPrompt(question, lines, tried = []) {
    return `You help answer a question about a person's email archive. A search found the emails listed below (sender, subject and a short excerpt of each).

Question: ${question}

Emails:
${lines.join("\n")}
${tried.length ? `\nAlready opened, did not contain the answer: ${tried.map((n) => `[${n}]`).join(", ")}\n` : ""}
Which email most likely contains the answer? Reply with only its number${tried.length ? ", or NONE if no other email could contain it" : ""}.

Question: ${question}
Email number:`
}

export function parsePick(text, n, exclude = []) {
    const reply = String(text ?? "")
    if (/^\s*none\b/i.test(reply)) return null
    for (const match of reply.matchAll(/\d+/g)) {
        const value = Number(match[0])
        if (value >= 1 && value <= n && !exclude.includes(value)) return value
    }
    return null
}

const readAlone = (ctx, record, path) => ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(path)]) })
const answered = (result) => ok(result) && !isAbstain(result.answer) && String(result.answer ?? "").trim()

export async function candidates(ctx, record) {
    const global = (await ctx.search(record.question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(record.question, 20, record.user)
    const mailbox = byHeaderRank(record.question, mailboxRanked, ctx.emailOf, { k: 20 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const first = switched ? mailbox.slice(0, 5) : global
    const second = switched ? global : mailbox.slice(0, 5)
    return { first, second, switched, mailbox, list: [...new Set([...first, ...second, ...mailbox])] }
}

export const listLines = (ctx, record, paths) => paths.map((path, index) => {
    const s = focusSnippet(ctx.emailOf(path), record.question)
    return `[${index + 1}] From: ${s.sender || "(unknown)"} | Subject: ${s.subject || "(none)"} | ${s.text}`
})

async function listPicker(ctx, record, { maxLines = 15, maxReads = 2 } = {}) {
    const { first, switched, list } = await candidates(ctx, record)
    const shown = list.slice(0, maxLines)
    const lines = listLines(ctx, record, shown)
    const tried = []
    const picks = []
    for (let read = 0; read < maxReads; read++) {
        const pick = await ctx.generate({ prompt: pickPrompt(record.question, lines, tried), options: PICK_OPTIONS() })
        picks.push(pick.answer)
        const n = parsePick(pick.answer, shown.length, tried)
        if (!n) break
        tried.push(n)
        const result = await readAlone(ctx, record, shown[n - 1])
        if (answered(result)) {
            return { status: result.status, answer: result.answer, contextPaths: first, shownPaths: shown, openedPaths: tried.map((i) => shown[i - 1]), readPaths: [shown[n - 1]], picks, switched, step: `read${read + 1}` }
        }
    }
    const result = await ctx.generate({ prompt: sandwichPrompt(record.question, first.map((path) => ctx.emailOf(path))) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: first, shownPaths: shown, openedPaths: [...tried.map((i) => shown[i - 1]), ...first], readPaths: first, picks, switched, step: "fallback" }
}

export function pointPrompt(question, emails) {
    return `You answer questions about a person's email archive using only the emails below.

Question: ${question}

Emails:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}
EMAILS>>>

Which email contains the answer to the question? Reply with only its number, or MORE if none of these emails contains it.

Question: ${question}
Email number:`
}

async function readAndPoint(ctx, record) {
    const { first, second, switched } = await candidates(ctx, record)
    const picks = []
    for (const context of [first, second]) {
        if (!context.length) continue
        const pick = await ctx.generate({ prompt: pointPrompt(record.question, context.map((path) => ctx.emailOf(path))), options: PICK_OPTIONS() })
        picks.push(pick.answer)
        const n = /^\s*more\b/i.test(String(pick.answer ?? "")) ? null : parsePick(pick.answer, context.length)
        if (!n) continue
        const result = await readAlone(ctx, record, context[n - 1])
        if (answered(result)) return { status: result.status, answer: result.answer, contextPaths: first, readPaths: [context[n - 1]], openedPaths: [...first, ...(context === second ? second : [])], picks, switched, step: context === first ? "first" : "second" }
        // The pointed email alone did not answer: answer from the whole context.
        const whole = await ctx.generate({ prompt: sandwichPrompt(record.question, context.map((path) => ctx.emailOf(path))) })
        return { status: whole.status, answer: whole.answer ?? "", contextPaths: first, readPaths: context, picks, switched, step: "whole" }
    }
    const result = await ctx.generate({ prompt: sandwichPrompt(record.question, first.map((path) => ctx.emailOf(path))) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: first, readPaths: first, picks, switched, step: "fallback" }
}

export const VARIANTS = {
    a2: { version: 1, describe: "Agent: pick 1 of <=15 listed emails (sender|subject|focused excerpt), read it alone; on abstain pick again (2 reads), else gates' first context", run: (ctx, record) => listPicker(ctx, record) },
    a3: { version: 1, describe: "Agent: read gates' first context, point to the answering email or MORE (second context); read the pointed email alone", run: readAndPoint },
}
