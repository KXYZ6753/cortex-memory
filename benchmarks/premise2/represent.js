// Reader-side email representations for premise2.
//
// R0  original      the email verbatim
// R1  safe-clean    lossless cleanup: drop File:, shorten separators, collapse
//                   whitespace, decode quoted-printable leftovers, strip ">" quoting
// R2  msgseg        thread segmented into messages, each introduced by one bracketed
//                   attribution line that keeps every original field value, with
//                   additive readable names and ISO dates. Body lines are untouched.
// Controls (exploratory, lossy by design):
// RL  latest-only   newest message only (what reply-stripping email cleaners do)
// RV1 v1-lossy      V1's preprocessing, which deleted Sent: lines and URLs
//
// Retrieval always indexes R0, so the representation factor isolates reading.

import { SEPARATOR, splitFile, parseFileHeader, decodeQuotedPrintable, contentWords, criticalSpans, spanHaystack, spanPresent, novelAnswerWords } from "./text.js"
import { segmentBody, withReadableName, withIsoDate } from "./segment.js"

export const REPRESENTATIONS = ["R0", "R1", "R2", "RL", "RV1"]
export const LOSSLESS = new Set(["R0", "R1", "R2"])
export const REPRESENTATION_VERSION = "premise2-represent-v1"

export function renderR0(email) {
    return email.trim()
}

export function renderR1(email) {
    const { header, body } = splitFile(email)
    const head = header.split("\n").filter((line) => !/^File:/i.test(line)).join("\n")
    const cleaned = decodeQuotedPrintable(body)
        .split("\n")
        .map((line) => line.replace(/^(?:\s*>)+ ?/, "").replace(/[ \t]+/g, " ").replace(/\s+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    return `${head}\n---\n${cleaned}`.trim()
}

// One bracketed line per message. Field values are copied verbatim; readable
// names and ISO dates are appended beside them, never substituted.
function attributionLine(message, total, header) {
    const parts = [`Message ${message.index} of ${total}${message.index === 1 ? " (newest)" : ""}`]
    const f = message.fields
    if (message.index === 1) {
        // The file header's own labels are kept so no word of it disappears.
        if (header.sender) parts.push(`Sender: ${withReadableName(header.sender)}`)
        if (header.recipients.length) parts.push(`Recipients: ${header.recipients.map(withReadableName).join(", ")}`)
        else if (header.rawRecipients) parts.push(`Recipients: ${header.rawRecipients}`)
        if (header.subject) parts.push(`Subject: ${header.subject}`)
        parts.push("Date: not recorded")
        return `[${parts.join(" | ")}]`
    }
    if (message.kind === "outlook") parts.push("Original Message")
    if (f.forwardedBy) parts.push(`forwarded by ${withReadableName(f.forwardedBy)} on ${withIsoDate(f.forwardedOn)}`)
    if (f.from) parts.push(`From: ${withReadableName(f.from)}`)
    if (f.sentBy) parts.push(`Sent by: ${withReadableName(f.sentBy)}`)
    if (f.sent) parts.push(`Sent: ${withIsoDate(f.sent)}`)
    if (f.date) parts.push(`Date: ${withIsoDate(f.date)}`)
    if (f.to) parts.push(`To: ${f.to}`)
    if (f.cc) parts.push(`Cc: ${f.cc}`)
    if (f.bcc) parts.push(`Bcc: ${f.bcc}`)
    if (f.subject !== undefined) parts.push(`Subject: ${f.subject}`)
    if (f.importance) parts.push(`Importance: ${f.importance}`)
    if (f.attachments) parts.push(`Attachments: ${f.attachments}`)
    return `[${parts.join(" | ")}]`
}

export function renderR2(email) {
    const { header, body } = splitFile(email)
    const parsed = parseFileHeader(header)
    const segmented = segmentBody(body)
    const total = segmented.messages.length
    const out = []
    for (const message of segmented.messages) {
        out.push(attributionLine(message, total, parsed))
        const lines = segmented.lines.slice(message.bodyStart, message.bodyEnd + 1)
        const text = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "")
        if (text) out.push(text)
        out.push("")
    }
    return out.join("\n").trim()
}

export function renderRL(email) {
    const { header, body } = splitFile(email)
    const segmented = segmentBody(body)
    const top = segmented.messages[0]
    const text = segmented.lines.slice(top.bodyStart, top.bodyEnd + 1).join("\n").trim()
    return `${header}\n${SEPARATOR}\n${text}`.trim()
}

// V1's preprocessEmail, reproduced exactly (benchmarks/premiseBenchmark.js) so the
// bridge replay can show its answer deletion on V2's own questions.
export function renderRV1(email) {
    const at = email.indexOf(SEPARATOR)
    const header = at < 0 ? "" : email.slice(0, at).trim()
    const body = at < 0 ? email.trim() : email.slice(at + SEPARATOR.length).trim()
    const keptHeader = header
        .split("\n")
        .filter((line) => !/^File:/i.test(line))
        .map((line) => {
            const recipients = line.match(/^Recipients:\s*\[(.*)\]\s*$/i)
            if (!recipients) return line
            const names = recipients[1].split(",").map((name) => name.trim()).filter(Boolean)
            return names.length > 3
                ? `Recipients: ${names.slice(0, 3).join(", ")} (+${names.length - 3} more)`
                : `Recipients: ${names.join(", ")}`
        })
        .join("\n")
    const cleanedBody = body
        .split("\n")
        .filter((line) => !/^\s*(Sent|Cc|Bcc|X-[\w-]+):/i.test(line))
        .map((line) => line.replace(/^\s*>+\s?/, "").replace(/\s+$/, ""))
        .join("\n")
        .replace(/https?:\/\/\S+/gi, "[link]")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    return `${keptHeader}\n\n${cleanedBody}`.trim()
}

const RENDERERS = { R0: renderR0, R1: renderR1, R2: renderR2, RL: renderRL, RV1: renderRV1 }

export function render(email, representation) {
    const renderer = RENDERERS[representation]
    if (!renderer) throw new Error(`Unknown representation ${representation}`)
    return renderer(email)
}

// Retention of answer evidence relative to R0, with the same quoted-printable
// normalisation applied to both sides (text.js does it inside every matcher).
// Returns word-level and span-level retention for one (email, answers) pair.
// The File: line is the dataset's storage path, not email content, so it is
// excluded on both sides: R1 and R2 drop it by design.
const withoutFileLine = (text) => text.split("\n").filter((line) => !/^File:/i.test(line)).join("\n")

export function retention(email, representation, answers, question) {
    const original = withoutFileLine(renderR0(email))
    const rendered = withoutFileLine(render(email, representation))
    const words = novelAnswerWords(answers, question)
    const originalWords = new Set(contentWords(original))
    const renderedWords = new Set(contentWords(rendered))
    const present = words.filter((word) => originalWords.has(word))
    const kept = present.filter((word) => renderedWords.has(word))
    const spans = answers.flatMap((answer) => criticalSpans(answer))
    const originalHay = spanHaystack(original)
    const renderedHay = spanHaystack(rendered)
    const spansPresent = spans.filter((span) => spanPresent(span, originalHay))
    const spansKept = spansPresent.filter((span) => spanPresent(span, renderedHay))
    return {
        wordsPresent: present.length,
        wordsKept: kept.length,
        spansPresent: spansPresent.length,
        spansKept: spansKept.length,
        lostWords: present.filter((word) => !renderedWords.has(word)),
        lostSpans: spansPresent.filter((span) => !spanPresent(span, renderedHay)).map((span) => `${span.kind}:${span.value}`),
        chars: rendered.length,
        originalChars: original.length,
    }
}
