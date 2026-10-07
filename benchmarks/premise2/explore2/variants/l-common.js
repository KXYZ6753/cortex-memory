// Worker l (self-verification): pointwise YES/NO verification of a proposed answer by e2b,
// scored by the first output token's YES/NO logprobs. Notes: docs/premise-study/explore2/l.md
//
// Prompt forms (all end with a YES/NO question; one output token is generated):
//   after   evidence first, then question + proposed answer (cache-friendly: every candidate
//           of a question shares the prefix up to "Proposed answer:")
//   before  question + proposed answer first, then the evidence, then both again
//   no      as "after", but asks whether the answer has an error or omission (score = NO - YES)
//   plain   as "after", "correct" only (no "complete")
import { clip } from "../../explore/variants.js"
import { generationOptions } from "../../ollama.js"

export const VCLIP = 6000
const block = (emails) => emails.length === 1
    ? `Email:\n<<<EMAIL\n${emails[0]}\nEMAIL>>>`
    : `Emails:\n<<<EMAILS\n${emails.map((e, i) => `[${i + 1}]\n${e}`).join("\n\n")}\nEMAILS>>>`
const src = (emails) => (emails.length === 1 ? "this email" : "these emails")

export function verifyPrompt(form, question, answer, emails) {
    const ev = block(emails), s = src(emails)
    if (form === "after") return `Check a proposed answer to a question about an email archive. Reply with only YES or NO.

${ev}

Question: ${question}
Proposed answer: ${answer}

Is the proposed answer correct and complete according to ${s}? Reply with only YES or NO.`
    if (form === "plain") return `Check a proposed answer to a question about an email archive. Reply with only YES or NO.

${ev}

Question: ${question}
Proposed answer: ${answer}

Is the proposed answer correct according to ${s}? Reply with only YES or NO.`
    if (form === "no") return `Check a proposed answer to a question about an email archive. Reply with only YES or NO.

${ev}

Question: ${question}
Proposed answer: ${answer}

Is anything in the proposed answer wrong, or is part of what the question asks missing, according to ${s}? Reply with only YES or NO.`
    if (form === "before") return `Question: ${question}
Proposed answer: ${answer}

Check the proposed answer against ${s} below. Reply with only YES or NO.

${ev}

Question: ${question}
Proposed answer: ${answer}
Is the proposed answer correct and complete according to ${s}? Reply with only YES or NO.`
    throw new Error(`unknown verify form ${form}`)
}

const lse = (xs) => { const m = Math.max(...xs); return m === -Infinity ? -Infinity : m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0)) }
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

// One verification call (1 output token, top 20 logprobs). Returns { s, pYes, yes, no, reply, ms }:
// s = logP(YES) - logP(NO) over case/space variants of the first token (missing side = the
// smallest listed logprob - 1); for form "no" the sign is flipped so that higher = better.
export async function verify(ctx, { form, question, answer, emails }) {
    const started = performance.now()
    const data = await ctx.chatRaw({ messages: [{ role: "user", content: verifyPrompt(form, question, answer, emails.map((e) => clip(e, VCLIP))) }], truncate: false, logprobs: true, top_logprobs: 20, options: generationOptions({ num_predict: 1 }) })
    const ms = Math.round(performance.now() - started)
    if (data.error) return { s: null, error: String(data.error).slice(0, 200), ms }
    const first = Array.isArray(data.logprobs) && data.logprobs[0] ? data.logprobs[0] : null
    const tops = (first?.top_logprobs ?? []).map((t) => [String(t.token), t.logprob])
    const floor = tops.length ? Math.min(...tops.map((t) => t[1])) - 1 : -20
    const pick = (w) => tops.filter(([t]) => t.replace(/[^A-Za-z]/g, "").toUpperCase() === w).map((t) => t[1])
    const ys = pick("YES"), ns = pick("NO")
    const yes = ys.length ? lse(ys) : floor, no = ns.length ? lse(ns) : floor
    const sign = form === "no" ? -1 : 1
    const s = sign * (yes - no)
    return { s: r3(s), pYes: r3(1 / (1 + Math.exp(-s))), yes: r3(yes), no: r3(no), reply: String(data.message?.content ?? "").trim().slice(0, 8), ms, pt: data.prompt_eval_count ?? null }
}
