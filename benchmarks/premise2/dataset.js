// Loads the pinned EnronQA parquet files and builds the question pools.
//
// EnronQA's train/dev/test splits share every email (same rows, same order); only
// the questions differ. Tuning and evaluation are therefore separated by MAILBOX:
// DEV questions come from 30 tuning mailboxes (dev split), TEST questions from the
// other 120 (test split), and no mailbox contributes to both.

import { readFileSync } from "node:fs"
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet"
import { compressors } from "hyparquet-compressors"
import { keyedRandom, shuffleInPlace, splitmix32, splitFile, UNANSWERABLE_GOLD, questionType, novelAnswerWords, contentWords, normaliseForMatch } from "./text.js"
import { segmentBody } from "./segment.js"

export const HF_FILES = {
    qaTest: { file: "qa-test.parquet", repo: "MichaelR207/enron_qa_0922", revision: "c0b3a9190fd970e83cfbe7d399a08860e43e221e", path: "data/test-00000-of-00001.parquet", sha256: "9684fe7d459195ca0873616a28956a9498c88e819c0d2cd7f5196f14513143ee" },
    qaDev: { file: "qa-dev.parquet", repo: "MichaelR207/enron_qa_0922", revision: "c0b3a9190fd970e83cfbe7d399a08860e43e221e", path: "data/dev-00000-of-00001.parquet", sha256: "3661cb585657061c156a408b201afbb4adf94d2e20fd41cc172c26c582800185" },
    corpus: { file: "corpus.parquet", repo: "MichaelR207/enron_corpus_0922", revision: "4f071133afe70bb83971ef9afb2a106f60984d3d", path: "data/train-00000-of-00001.parquet", sha256: "fa4b54e0f1814acf158ee62a4845a92b71995d7d240b41de06e618bde87c3730" },
}

export const CORPUS_MAX_CHARS = 40_000

const read = async (directory, file, columns) => parquetReadObjects({ file: await asyncBufferFromFile(`${directory}/${file}`), compressors, columns })

export async function loadRaw(hfDirectory) {
    const [test, dev, corpus] = await Promise.all([
        read(hfDirectory, HF_FILES.qaTest.file, ["path", "user", "email", "questions", "rephrased_questions", "gold_answers", "alternate_answers", "incorrect_answers", "gold_rationales"]),
        read(hfDirectory, HF_FILES.qaDev.file, ["path", "questions", "rephrased_questions", "gold_answers", "alternate_answers", "incorrect_answers", "gold_rationales"]),
        read(hfDirectory, HF_FILES.corpus.file, ["path", "user", "email"]),
    ])
    for (let index = 0; index < test.length; index++) {
        if (test[index].path !== dev[index].path) throw new Error(`dev/test rows are no longer aligned at ${index}`)
    }
    return { test, dev, corpus }
}

// The retrieval corpus: every email, minus a disclosed handful of extreme lengths
// that no context budget could hold.
export function buildCorpus(corpusRows) {
    const docs = []
    const dropped = []
    for (const row of corpusRows) {
        if (row.email.length > CORPUS_MAX_CHARS) {
            dropped.push(row.path)
            continue
        }
        docs.push({ path: row.path, user: row.user, email: row.email })
    }
    return { docs, dropped }
}

// 150 mailboxes → 30 tuning (6 per inbox-size quintile, seeded) + 120 evaluation.
export function splitMailboxes(testRows, seed) {
    const sizes = new Map()
    for (const row of testRows) sizes.set(row.user, (sizes.get(row.user) ?? 0) + 1)
    const users = [...sizes.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([user]) => user)
    const quintile = Math.ceil(users.length / 5)
    const tuning = new Set()
    for (let q = 0; q < 5; q++) {
        const bucket = users.slice(q * quintile, (q + 1) * quintile)
        shuffleInPlace(bucket, splitmix32(seed + q))
        for (const user of bucket.slice(0, 6)) tuning.add(user)
    }
    const evaluation = new Set(users.filter((user) => !tuning.has(user)))
    return { tuning, evaluation, sizes, quintileOf: new Map(users.map((user, index) => [user, Math.min(4, Math.floor(index / quintile))])) }
}

// Where in the thread the answer lives, from the segmenter: the message holding the
// largest share of the gold's novel answer words.
export function answerLocation(email, answers, question) {
    const { body } = splitFile(email)
    const segmented = segmentBody(body)
    const words = novelAnswerWords(answers, question)
    if (segmented.messages.length === 1) return { threaded: false, messages: 1, answerMessage: 1, location: "single" }
    if (!words.length) return { threaded: true, messages: segmented.messages.length, answerMessage: null, location: "unknown" }
    let best = null
    for (const message of segmented.messages) {
        const text = segmented.lines.slice(message.headerStart <= message.headerEnd ? message.headerStart : message.bodyStart, message.bodyEnd + 1).join("\n")
        const present = new Set(contentWords(text))
        const hits = words.filter((word) => present.has(word)).length
        if (!best || hits > best.hits) best = { index: message.index, hits }
    }
    return {
        threaded: true,
        messages: segmented.messages.length,
        answerMessage: best.index,
        location: best.hits === 0 ? "unknown" : best.index === 1 ? "top" : "embedded",
    }
}

function questionRecord(row, split, questionIndex, fields) {
    const question = fields.questions[questionIndex]
    const gold = fields.gold_answers[questionIndex]
    if (typeof question !== "string" || !question.trim() || typeof gold !== "string" || !gold.trim()) return null
    const alternates = (fields.alternate_answers?.[questionIndex] ?? []).filter((answer) => typeof answer === "string" && answer.trim())
    return {
        questionKey: `${split}:${row.path}#${questionIndex}`,
        split,
        path: row.path,
        user: row.user,
        questionIndex,
        question: question.trim(),
        rephrased: (fields.rephrased_questions?.[questionIndex] ?? "").trim() || null,
        gold: gold.trim(),
        alternates,
        incorrect: (fields.incorrect_answers?.[questionIndex] ?? []).filter((answer) => typeof answer === "string" && answer.trim()),
        rationale: fields.gold_rationales?.[questionIndex] ?? null,
        type: questionType(question),
        unanswerable: UNANSWERABLE_GOLD.test(gold),
    }
}

// One candidate question per email, chosen by a seeded draw among valid ones.
function candidatesFor(rows, splitRows, split, users, seed) {
    const out = []
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        if (!users.has(row.user)) continue
        const fields = splitRows[index]
        const records = (fields.questions ?? []).map((_, q) => questionRecord(row, split, q, fields)).filter(Boolean)
        if (!records.length) continue
        const random = keyedRandom(seed, `${split}:${row.path}`)
        out.push(records[Math.floor(random() * records.length)])
    }
    return out
}

// Round-robin across mailboxes within inbox-size strata, so any prefix of the list
// is balanced: prefix n holds ≈ n/strata questions per stratum, spread over mailboxes.
export function roundRobin(records, quintileOf, seed, capPerMailbox = Infinity) {
    const byUser = new Map()
    for (const record of records) {
        if (!byUser.has(record.user)) byUser.set(record.user, [])
        byUser.get(record.user).push(record)
    }
    for (const [user, list] of byUser) shuffleInPlace(list, keyedRandom(seed, `order:${user}`))
    const strata = [[], [], [], [], []]
    for (const user of [...byUser.keys()].sort()) strata[quintileOf.get(user) ?? 0].push(user)
    for (const [index, list] of strata.entries()) shuffleInPlace(list, splitmix32(seed + 101 + index))
    const cursors = new Map()
    const ordered = []
    let progress = true
    while (progress) {
        progress = false
        for (const users of strata) {
            for (const user of users) {
                const list = byUser.get(user)
                const cursor = cursors.get(user) ?? 0
                if (cursor >= list.length || cursor >= capPerMailbox) continue
                ordered.push(list[cursor])
                cursors.set(user, cursor + 1)
                progress = true
            }
        }
    }
    return ordered
}

export function loadV1Pilot(path) {
    const data = JSON.parse(readFileSync(path, "utf8"))
    return new Set(data.paths)
}

// Builds DEV, TEST and RETRIEVAL pools. `twinsOf(path)` returns { twins, nearDups }
// for an email (computed with the BM25 index); it is applied lazily while walking
// the ordered candidates, so only slightly more than the quota is ever checked.
// Exclusions use the conservative near-duplicate relation (either direction), and
// strong twins are kept on the record for relaxed recall. The shared context-token
// cap is applied later, once contexts exist (see prepare.js).
export async function buildPools({ raw, corpusPaths, mailboxes, v1Paths, seed, quotas, twinsOf, emailByPath }) {
    const exclusions = { unanswerable: 0, notInCorpus: 0, v1Email: 0, v1Twin: 0, tuningTwin: 0, duplicateTwinGroup: 0 }
    const accept = async (record, state, pool) => {
        if (record.unanswerable) return exclusions.unanswerable++, false
        if (!corpusPaths.has(record.path)) return exclusions.notInCorpus++, false
        if (v1Paths.has(record.path)) return exclusions.v1Email++, false
        if (state.claimed.has(record.path)) return exclusions.duplicateTwinGroup++, false
        const { twins, nearDups } = await twinsOf(record.path)
        const related = [...new Set([...twins, ...nearDups])]
        for (const other of related) {
            if (v1Paths.has(other)) return exclusions.v1Twin++, false
            if (pool === "test" && mailboxes.tuning.has(other.split("/")[0])) return exclusions.tuningTwin++, false
            if (state.claimed.has(other)) return exclusions.duplicateTwinGroup++, false
        }
        state.claimed.add(record.path)
        for (const other of related) state.claimed.add(other)
        record.twins = twins
        record.nearDups = nearDups
        return true
    }
    // The per-mailbox cap counts accepted questions, not candidates, so exclusions
    // never leave a mailbox under-filled while later candidates exist.
    const take = async (ordered, quota, pool, state, capPerMailbox = Infinity) => {
        const out = []
        const perUser = new Map()
        for (const record of ordered) {
            if (out.length >= quota) break
            if ((perUser.get(record.user) ?? 0) >= capPerMailbox) continue
            if (await accept(record, state, pool)) {
                out.push(record)
                perUser.set(record.user, (perUser.get(record.user) ?? 0) + 1)
            }
        }
        return out
    }

    const devCandidates = roundRobin(candidatesFor(raw.test, raw.dev, "dev", mailboxes.tuning, seed), mailboxes.quintileOf, seed)
    const testCandidates = roundRobin(candidatesFor(raw.test, raw.test, "test", mailboxes.evaluation, seed), mailboxes.quintileOf, seed)
    const testState = { claimed: new Set() }
    const dev = await take(devCandidates, quotas.dev, "dev", { claimed: new Set() })
    const test = await take(testCandidates, quotas.test, "test", testState, quotas.testCapPerMailbox)

    // Retrieval-only questions: uncapped per mailbox (they cost no generation), still
    // disjoint from TEST emails and twins.
    const retrievalCandidates = roundRobin(candidatesFor(raw.test, raw.test, "test", mailboxes.evaluation, seed + 7), mailboxes.quintileOf, seed + 7)
        .filter((record) => !testState.claimed.has(record.path))
    const retrieval = await take(retrievalCandidates, quotas.retrieval, "retrieval", { claimed: new Set(testState.claimed) })

    for (const record of [...dev, ...test, ...retrieval]) {
        const email = emailByPath.get(record.path)
        Object.assign(record, answerLocation(email, [record.gold, ...record.alternates], record.question))
    }
    return { dev, test, retrieval, exclusions }
}

export const recordAnswers = (record) => [record.gold, ...record.alternates]
export const matchText = normaliseForMatch
