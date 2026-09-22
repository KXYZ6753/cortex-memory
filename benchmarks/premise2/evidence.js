// Evidence relations between emails and questions.
//
// Twins: EnronQA keeps thread copies and templates, so a question's answer can sit
// in more than one file. V1 treated every non-gold email as a negative and 21/100
// of its "hard negatives" carried the answer. Here each candidate is classified
// against the gold email, and against the answer itself.

import { splitFile, shingleHashes, containment, normalisedBodyKey, contentWords, criticalSpans, spanHaystack, spanPresent, novelAnswerWords } from "./text.js"

export class EvidenceCache {
    constructor(emailByPath) {
        this.emailByPath = emailByPath
        this.shingles = new Map()
        this.bodyKeys = new Map()
        this.haystacks = new Map()
        this.words = new Map()
    }

    body(path) {
        return splitFile(this.emailByPath.get(path) ?? "").body
    }

    shinglesOf(path) {
        if (!this.shingles.has(path)) this.shingles.set(path, shingleHashes(this.body(path), 8))
        return this.shingles.get(path)
    }

    bodyKey(path) {
        if (!this.bodyKeys.has(path)) this.bodyKeys.set(path, normalisedBodyKey(this.body(path)))
        return this.bodyKeys.get(path)
    }

    haystack(path) {
        if (!this.haystacks.has(path)) this.haystacks.set(path, spanHaystack(this.emailByPath.get(path) ?? ""))
        return this.haystacks.get(path)
    }

    wordsOf(path) {
        if (!this.words.has(path)) this.words.set(path, new Set(contentWords(this.emailByPath.get(path) ?? "")))
        return this.words.get(path)
    }

    // Relation of `candidate` to `gold`.
    //   twin:      candidate contains >= 80% of the gold's 8-grams, or bodies are
    //              identical after normalisation (used for relaxed recall; the
    //              direction matters: a short reply inside a long gold thread is
    //              NOT a twin, because it may lack the answer)
    //   nearDup:   >= 50% containment in either direction (used to exclude
    //              distractors, where erring towards exclusion is safe)
    relation(gold, candidate) {
        if (gold === candidate) return { twin: true, nearDup: true, identical: true, goldInCandidate: 1, candidateInGold: 1 }
        const identical = this.bodyKey(gold) === this.bodyKey(candidate)
        const goldShingles = this.shinglesOf(gold)
        const candidateShingles = this.shinglesOf(candidate)
        const goldInCandidate = containment(goldShingles, candidateShingles)
        const candidateInGold = containment(candidateShingles, goldShingles)
        return {
            twin: identical || goldInCandidate >= 0.8,
            nearDup: identical || goldInCandidate >= 0.5 || candidateInGold >= 0.5,
            identical,
            goldInCandidate: Number(goldInCandidate.toFixed(3)),
            candidateInGold: Number(candidateInGold.toFixed(3)),
        }
    }

    // Does this email contain the answer to the question? Gold critical spans (URLs,
    // dates, numbers, contacts) must all be present when the gold has any; otherwise
    // at least 80% of the gold's novel content words (words not in the question).
    // Returns null when the gold has nothing checkable.
    answerBearing(path, record) {
        const spans = criticalSpans(record.gold)
        const hay = this.haystack(path)
        if (spans.length) return spans.every((span) => spanPresent(span, hay))
        const words = novelAnswerWords([record.gold], record.question)
        if (!words.length) return null
        const present = this.wordsOf(path)
        const hits = words.filter((word) => present.has(word)).length
        return words.length >= 3 ? hits / words.length >= 0.8 : hits === words.length
    }
}

// Corpus document frequency of content words, for building distinctive twin queries.
export function documentFrequency(docs) {
    const df = new Map()
    for (const doc of docs) for (const word of new Set(contentWords(splitFile(doc.email).body))) df.set(word, (df.get(word) ?? 0) + 1)
    return df
}

// The rarest words of an email that still occur elsewhere (df >= 2): a query that
// finds copies of the email rather than emails about the same topic.
export function distinctiveQuery(body, df, size = 24) {
    const words = [...new Set(contentWords(body))]
        .filter((word) => (df.get(word) ?? 0) >= 2 && !/^\d+$/.test(word))
        .sort((a, b) => (df.get(a) ?? 0) - (df.get(b) ?? 0) || a.localeCompare(b))
    return words.slice(0, size).join(" ")
}

// Twins of `path` among BM25 neighbours of its own distinctive words.
export async function findTwins(path, { cache, df, search, k = 30 }) {
    const query = distinctiveQuery(cache.body(path), df)
    if (!query) return { twins: [], nearDups: [] }
    const hits = await search(query, k)
    const twins = []
    const nearDups = []
    for (const hit of hits) {
        if (hit.path === path) continue
        const relation = cache.relation(path, hit.path)
        if (relation.twin) twins.push(hit.path)
        if (relation.nearDup) nearDups.push(hit.path)
    }
    return { twins, nearDups }
}
