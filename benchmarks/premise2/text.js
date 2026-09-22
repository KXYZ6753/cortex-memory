// Shared text utilities for premise2: hashing, normalisation, content words and
// critical spans. Pure functions only, so every module and test agrees on what
// "the same text" and "the answer survived" mean.

import { createHash } from "node:crypto"

export const SEPARATOR = "====================================="

export const sha256 = (text) => createHash("sha256").update(text).digest("hex")
export const sha12 = (text) => sha256(text).slice(0, 12)

// Same FNV-1a as benchmarks/premiseBenchmark.js; keep in sync.
export function fnv1a32(text) {
    let hash = 0x811c9dc5
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash >>> 0
}

export function splitmix32(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x9e3779b9) | 0
        let z = state
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
        z ^= z >>> 16
        return (z >>> 0) / 4294967296
    }
}

export function shuffleInPlace(array, random) {
    for (let index = array.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1))
        ;[array[index], array[swap]] = [array[swap], array[index]]
    }
    return array
}

// Seeded per-key randomness: identical for a key regardless of call order.
export const keyedRandom = (seed, key) => splitmix32((seed ^ fnv1a32(key)) >>> 0)

// EnronQA files: "Subject/Sender/Recipients/File" header, a separator, the body,
// and usually a trailing separator.
export function splitFile(email) {
    const first = email.indexOf(SEPARATOR)
    if (first < 0) return { header: "", body: email.trim(), trailing: false }
    let body = email.slice(first + SEPARATOR.length)
    let trailing = false
    const last = body.lastIndexOf(SEPARATOR)
    if (last >= 0 && body.slice(last + SEPARATOR.length).trim() === "") {
        body = body.slice(0, last)
        trailing = true
    }
    return { header: email.slice(0, first).trim(), body: body.replace(/^\n+/, "").replace(/\s+$/, ""), trailing }
}

export function parseFileHeader(header) {
    const field = (name) => header.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "mi"))?.[1]?.trim() ?? ""
    const rawRecipients = field("Recipients")
    let recipients = []
    const list = rawRecipients.match(/^\[(.*)\]$/)
    if (list) {
        recipients = [...list[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean)
    } else if (rawRecipients) {
        recipients = rawRecipients.split(/[,;]/).map((part) => part.trim()).filter(Boolean)
    }
    return { subject: field("Subject"), sender: field("Sender"), recipients, rawRecipients, file: field("File") }
}

// Quoted-printable leftovers (=20, =09, =3D, soft line breaks). Applied only on
// strong QP evidence (soft breaks, =3D, =09, or =20 ending a line). A bare mid-line
// "=20" is not evidence: already-decoded text such as "pid=20523" must not be
// decoded a second time into "pid 523".
export function hasQuotedPrintable(text) {
    return /=\r?\n|=3D|=09|=20\r?$/m.test(text)
}

export function decodeQuotedPrintable(text) {
    if (!hasQuotedPrintable(text)) return text
    return text
        .replace(/=\r?\n/g, "")
        .replace(/=20/g, " ")
        .replace(/=09/g, "\t")
        .replace(/=3D/g, "=")
}

const STOP_WORDS = new Set(`
a about above after again against all am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers herself him
himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other
our ours ourselves out over own same she should so some such than that the their theirs them themselves then there
these they this those through to too under until up very was we were what when where which while who whom why will
with would you your yours yourself yourselves according email emails mail sent said says also
`.trim().split(/\s+/))

export const normaliseForMatch = (text) => decodeQuotedPrintable(String(text ?? ""))
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")

export function tokens(text) {
    return normaliseForMatch(text).match(/[a-z0-9]+(?:['.@/-][a-z0-9]+)*/g) ?? []
}

export function contentWords(text) {
    return [...new Set(tokens(text).flatMap((token) => token.split(/[.@/-]/)).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))]
}

// Words in the gold answer that the question does not already contain: the part
// of the answer a model can only get from the email.
export function novelAnswerWords(answers, question) {
    const questionWords = new Set(contentWords(question))
    const words = new Set()
    for (const answer of answers) for (const word of contentWords(answer)) if (!questionWords.has(word)) words.add(word)
    return [...words]
}

const SPAN_PATTERNS = {
    url: /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi,
    email: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    phone: /(?:\+?1[-.\s]?)?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    date: /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})\b/gi,
    number: /(?<![\w.])(?:\$\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?<![\w.])(?:\$\s?)?\d+(?:\.\d+)?%?(?![\w])/g,
}

const normaliseSpan = (kind, value) => {
    let span = value.toLowerCase().replace(/[.,;:!?]+$/, "")
    if (kind === "url") span = span.replace(/^https?:\/\//, "").replace(/\/$/, "")
    if (kind === "phone") span = span.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
    if (kind === "number") span = span.replace(/[$,\s]/g, "")
    return span
}

// Exact-copy strings (URLs, emails, phones, dates, numbers) that a correct answer
// must preserve. Short bare numbers are ignored as too ambiguous to check.
export function criticalSpans(text) {
    const source = normaliseForMatch(text)
    const spans = []
    for (const [kind, pattern] of Object.entries(SPAN_PATTERNS)) {
        for (const match of source.matchAll(pattern)) {
            const value = normaliseSpan(kind, match[0])
            if (kind === "number" && value.replace(/[^0-9]/g, "").length < 3) continue
            spans.push({ kind, value })
        }
    }
    const seen = new Set()
    return spans.filter((span) => {
        const key = `${span.kind}:${span.value}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

// Haystack prepared once so repeated span lookups against the same email stay cheap.
export function spanHaystack(text) {
    const lower = normaliseForMatch(text)
    return {
        lower,
        digits: lower.replace(/\D/g, ""),
        compact: lower.replace(/[$,\s]/g, ""),
        noScheme: lower.replace(/https?:\/\//g, ""),
    }
}

export function spanPresent(span, haystack) {
    if (span.kind === "phone") return haystack.digits.includes(span.value)
    if (span.kind === "number") return haystack.compact.includes(span.value)
    if (span.kind === "url") return haystack.noScheme.includes(span.value)
    return haystack.lower.includes(span.value)
}

// Word n-gram shingles as 32-bit hashes, over a normalised body, for near-duplicate
// and containment checks.
export function shingleHashes(text, n = 8) {
    const words = normaliseForMatch(text).match(/[a-z0-9]+/g) ?? []
    const hashes = new Set()
    if (words.length < n) {
        if (words.length) hashes.add(fnv1a32(words.join(" ")))
        return hashes
    }
    for (let index = 0; index + n <= words.length; index++) hashes.add(fnv1a32(words.slice(index, index + n).join(" ")))
    return hashes
}

export function containment(inner, outer) {
    if (!inner.size) return 0
    let hit = 0
    for (const hash of inner) if (outer.has(hash)) hit++
    return hit / inner.size
}

export const normalisedBodyKey = (body) => sha12((normaliseForMatch(body).match(/[a-z0-9]+/g) ?? []).join(" "))

// Unanswerable golds ("the email does not say ...") are flagged and excluded, so the
// floor measures parametric knowledge rather than a correct abstention.
export const UNANSWERABLE_GOLD = /\b(?:not (?:available|mentioned|provided|specified|stated|included|given|indicated|disclosed|listed|known)|no (?:information|mention|details?|indication)|does not (?:say|mention|specify|provide|state|indicate|include)|is not clear|cannot be determined|unknown)\b/i

// Pre-registered question-type strata.
export function questionType(question) {
    const q = question.toLowerCase()
    if (/\b(url|website|web site|link|web address|email address|e-mail address|phone|telephone|fax|number to call|contact)\b/.test(q)) return "url-contact"
    if (/^\s*(who|whom|whose)\b|\bwho (?:sent|wrote|forwarded|is|was|will|should)\b/.test(q)) return "who"
    if (/^\s*when\b|\b(what|which) (?:date|day|time|month|year)\b|\bdeadline\b|\bhow long\b/.test(q)) return "when"
    if (/\bhow (?:many|much)\b|\b(?:price|cost|amount|percentage|percent|rate|volume|total)\b/.test(q)) return "number"
    return "other"
}
