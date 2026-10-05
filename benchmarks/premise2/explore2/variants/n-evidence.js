// New-methods scientist (prefix n): deterministic evidence extraction (placeholder; helpers).
import { splitFile, contentWords } from "../../text.js"

// Body sentences of an email (header lines dropped; quoted-reply markers stripped).
export function splitSentences(email) {
    const { body } = splitFile(email)
    const out = []
    for (const para of String(body).replace(/\r/g, "").split(/\n\s*\n/)) {
        const flat = para.split("\n").map((l) => l.replace(/^[>\s]+/, "").trim()).filter(Boolean).join(" ")
        for (const s of flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
            const t = s.trim()
            if (t.length >= 15 && /[a-z]/i.test(t)) out.push(t.length > 400 ? t.slice(0, 400) : t)
        }
    }
    return out
}

// Lexical overlap score: share of the question's content words found in the sentence.
export function lexScore(question, sentence) {
    const q = contentWords(question)
    const w = new Set(contentWords(sentence))
    return q.filter((x) => w.has(x)).length / Math.max(1, q.length) + 0.001 * Math.min(sentence.length, 200) / 200
}

export const VARIANTS = {}
