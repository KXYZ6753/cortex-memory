// Shared helpers for the p-* offline tools (one-shot perfecter, exploration phase 2).

import { join } from "node:path"
import { readFileSync, existsSync } from "node:fs"
import { splitFile, parseFileHeader, contentWords } from "../../text.js"
import { RERANK_BODY_CHARS } from "../../rerank.js"

// Subject + Sender + the body window (RERANK_BODY_CHARS long, 200-char steps) that
// covers the most distinct question content words; the body start when it is short.
export function snippetText(question, email) {
    const { header, body } = splitFile(email)
    const parsed = parseFileHeader(header)
    let window = body.slice(0, RERANK_BODY_CHARS)
    if (body.length > RERANK_BODY_CHARS) {
        const words = contentWords(question)
        const lower = body.toLowerCase()
        let best = -1, bestStart = 0
        for (let start = 0; start < body.length - 200; start += 200) {
            const slice = lower.slice(start, start + RERANK_BODY_CHARS)
            const cover = words.filter((w) => slice.includes(w)).length
            if (cover > best) { best = cover; bestStart = start }
        }
        window = body.slice(bestStart, bestStart + RERANK_BODY_CHARS)
    }
    return [parsed.subject && `Subject: ${parsed.subject}`, parsed.sender && `Sender: ${parsed.sender}`, window].filter(Boolean).join("\n")
}

// pdense diagnostic records (answers.jsonl): questionKey -> { global, mailbox } ([path, score] lists).
export function denseLists(dataDir = ".data/premise2") {
    const out = new Map()
    const file = join(dataDir, "explore", "answers.jsonl")
    if (!existsSync(file)) return out
    for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.includes('"pdense"')) continue
        const row = JSON.parse(line)
        if (row.variant === "pdense" && row.dense) out.set(row.questionKey, row.dense)
    }
    return out
}
