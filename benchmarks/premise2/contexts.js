// Context construction for premise2 cells. Every context is a list of corpus
// paths in prompt order plus labels; it is built once and shared verbatim by every
// model (item 11), so model comparisons see byte-identical inputs.

import { keyedRandom, splitFile, parseFileHeader, contentWords, novelAnswerWords } from "./text.js"

export const POSITION_BUCKETS = ["first", "middle", "last"]

// Balanced gold positions: bucket = (pool index + density offset) mod 3, so each
// density sees first/middle/last equally often and densities are decoupled
// (V1 drew one position per question and reused it, coupling dist4 and dist9).
export function goldSlot(poolIndex, count, densityOffset) {
    const bucket = POSITION_BUCKETS[(poolIndex + densityOffset) % 3]
    const slot = bucket === "first" ? 0 : bucket === "last" ? count : Math.floor((count + 1) / 2)
    return { bucket, slot }
}

const normalisedSubject = (subject) => String(subject ?? "").toLowerCase().replace(/^(?:\s*(?:re|fw|fwd)\s*:\s*)+/g, "").replace(/\s+/g, " ").trim()

// "Answer-free lexical distractors": the highest BM25 neighbours of the question
// that are not the gold, not a twin or near-duplicate of it, do not themselves
// contain the answer, and are not from the same thread (normalised subject).
// These exclusions define the estimand; the counts are returned so the report can
// show what was removed and why.
export function hardDistractors(record, bm25Top, { evidence, emailByPath, count = 9 }) {
    const goldSubject = normalisedSubject(parseFileHeader(splitFile(emailByPath.get(record.path) ?? "").header).subject)
    const excluded = { gold: 0, twin: 0, nearDup: 0, answerBearing: 0, sameThread: 0 }
    const picked = []
    for (const hit of bm25Top) {
        if (picked.length >= count) break
        const path = hit.path
        if (path === record.path) {
            excluded.gold++
            continue
        }
        const relation = evidence.relation(record.path, path)
        if (relation.twin) {
            excluded.twin++
            continue
        }
        if (relation.nearDup) {
            excluded.nearDup++
            continue
        }
        if (evidence.answerBearing(path, record) === true) {
            excluded.answerBearing++
            continue
        }
        const subject = normalisedSubject(parseFileHeader(splitFile(emailByPath.get(path) ?? "").header).subject)
        if (goldSubject && subject && subject === goldSubject) {
            excluded.sameThread++
            continue
        }
        picked.push({ path, bm25Rank: bm25Top.indexOf(hit) + 1, sameMailbox: path.split("/")[0] === record.user })
    }
    return { picked, excluded }
}

// Seeded random corpus emails with the same exclusions as hard distractors.
export function randomDistractors(record, docs, { evidence, seed, count = 4 }) {
    const random = keyedRandom(seed, `rand:${record.questionKey}`)
    const picked = []
    const seen = new Set([record.path])
    let guard = 0
    while (picked.length < count && guard++ < 500) {
        const doc = docs[Math.floor(random() * docs.length)]
        if (seen.has(doc.path)) continue
        seen.add(doc.path)
        const relation = evidence.relation(record.path, doc.path)
        if (relation.twin || relation.nearDup) continue
        if (evidence.answerBearing(doc.path, record) === true) continue
        picked.push({ path: doc.path, sameMailbox: doc.path.split("/")[0] === record.user })
    }
    return picked
}

export function distractorContext(record, poolIndex, distractors, densityOffset) {
    const paths = distractors.map((item) => item.path)
    const { bucket, slot } = goldSlot(poolIndex, paths.length, densityOffset)
    paths.splice(slot, 0, record.path)
    return { paths, goldPosition: slot, goldBucket: bucket, distractors }
}

// Retrieval context from a ranked list: first k (or the rerank gate's k), in rank
// order or reversed so the best email sits next to the question ("best-last").
export function retrievalContext(ranked, { k, order, gateK }) {
    const size = k === "gate" ? gateK : k
    const top = ranked.slice(0, size)
    const paths = order === "bestlast" ? [...top].reverse() : top
    return { paths, k: size }
}

// Gold-informed line selection (a FILCO-style diagnostic, NOT deployable): keep each
// email's header, the header lines of embedded messages, and any line containing a
// novel gold/alternate answer word. It leaks the answer into the selection, so it
// bounds what query-aware extraction could reach, for one simple selector.
export function goldInformedSelect(email, record) {
    const words = new Set(novelAnswerWords([record.gold, ...record.alternates], record.question))
    const { header, body } = splitFile(email)
    const kept = body.split("\n").filter((line) => {
        if (/^\s*(?:>\s*)*(?:From|Sent|To|Cc|Subject|Date)\s*:/i.test(line)) return true
        if (/-{2,}\s*(?:Original Message|Forwarded by)/i.test(line)) return true
        return contentWords(line).some((word) => words.has(word))
    })
    return `${header}\n---\n${kept.join("\n")}`.trim()
}
