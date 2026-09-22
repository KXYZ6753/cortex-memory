// Answer prompts for premise2. One template per cell, byte-identical for every
// model. T2 is V2's primary template: it asks for every part of the question
// (V1's "one short sentence" under-answered multi-part questions, and the judge
// then marked those answers incomplete). T1 is V1's template verbatim, kept for the
// bridge replay and the format-sensitivity cell.

import { render } from "./represent.js"
import { goldInformedSelect } from "./contexts.js"
import { sha256 } from "./text.js"

export const ABSTAIN = "NOT IN EMAILS"
export const TEMPLATE_VERSION = "premise2-prompts-v1"

// The largest prompt any cell may send, in tokens. With num_ctx 16384 for every
// model this leaves room for 320 output tokens plus the chat-template wrapper.
export const TOKEN_CAP = 15_500
// Worst observed Gemma chars/token in V1 was 2.21, so chars / 2.2 is an upper bound.
export const CONSERVATIVE_CHARS_PER_TOKEN = 2.2
export const TEMPLATE_TOKEN_ALLOWANCE = 64

export const tokenUpperBound = (text) => Math.ceil(text.length / CONSERVATIVE_CHARS_PER_TOKEN) + TEMPLATE_TOKEN_ALLOWANCE

const T2_RULES = `Rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ${ABSTAIN}`

function emailBlock(emails, variant) {
    if (variant === "null") {
        // Answer-neutral byte change: different labels and delimiters, same content.
        // Its flips measure the prompt-perturbation noise floor.
        return `<<<MAILS\n${emails.map((email, index) => `Email ${index + 1}:\n${email}`).join("\n\n")}\nMAILS>>>`
    }
    return `<<<EMAILS\n${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}\nEMAILS>>>`
}

export function buildT2(question, emails, variant = "standard") {
    return `You answer questions about a person's email archive using only the emails below.

${T2_RULES}

Emails:
${emailBlock(emails, variant)}

Question: ${question}
Answer:`
}

export function buildT2Floor(question) {
    return `You answer questions about a person's email archive. You have not been given any emails.

Rules:
- Answer every part of the question in one or two sentences. No preamble.
- If you do not know the answer, reply with exactly: ${ABSTAIN}

Question: ${question}
Answer:`
}

// V1's buildAnswerPrompt, verbatim (benchmarks/premiseBenchmark.js).
export function buildT1(question, emails) {
    const block = emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")
    return `You answer questions about a person's email archive using only the emails below.

Rules:
- Answer with one short sentence. No preamble, no explanation, no restating the question.
- Copy names, dates, numbers and amounts exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: NOT IN EMAILS

Emails:
<<<EMAILS
${block}
EMAILS>>>

Question: ${question}
Answer:`
}

export function buildT1Floor(question) {
    return `You answer questions about a person's email archive. You have not been given any emails.

Rules:
- Answer with one short sentence. No preamble, no explanation, no restating the question.
- If you do not know the answer, reply with exactly: NOT IN EMAILS

Question: ${question}
Answer:`
}

// Renders one cell item to its final prompt text.
export function buildPrompt({ question, paths, representation, template, variant = "standard", emailByPath, record, goldSelect = false }) {
    const emails = paths.map((path) => {
        const email = emailByPath.get(path)
        if (email === undefined) throw new Error(`email ${path} is not in the corpus`)
        return goldSelect ? goldInformedSelect(email, record) : render(email, representation)
    })
    if (!paths.length) return template === "T1" ? buildT1Floor(question) : buildT2Floor(question)
    return template === "T1" ? buildT1(question, emails) : buildT2(question, emails, variant)
}

export function promptRecord(text) {
    return { sha: sha256(text), chars: text.length, tokensUpper: tokenUpperBound(text), text }
}

// Fingerprint of every template, for the manifest and the resume guard.
export const TEMPLATE_HASH = sha256([
    TEMPLATE_VERSION,
    buildT2("Q", ["E"]), buildT2("Q", ["E"], "null"), buildT2Floor("Q"), buildT1("Q", ["E"]), buildT1Floor("Q"),
].join("\n--8<--\n"))

export function isAbstain(answer) {
    return typeof answer === "string" && answer.trim().replace(/[.!]+$/, "").toUpperCase() === ABSTAIN
}
