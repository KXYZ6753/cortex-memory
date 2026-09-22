import assert from "node:assert/strict"
import test from "node:test"
import { documentFrequency, EvidenceCache } from "../../benchmarks/premise2/evidence.js"
import { SEPARATOR } from "../../benchmarks/premise2/text.js"

const makeFile = (body) => `Subject: Test\nSender: bob@enron.com\nRecipients: ['alice@enron.com']\nFile: bob/inbox/1.\n${SEPARATOR}\n${body}\n${SEPARATOR}`

// A gold body long enough (>= 8 words per line, many lines) to produce a rich set
// of 8-word shingles, so containment ratios are meaningful rather than degenerate.
const goldBodyLines = Array.from({ length: 20 }, (_, i) =>
    `line number ${i} about the quarterly budget review meeting scheduled for next tuesday afternoon`)
const goldBody = goldBodyLines.join("\n")
const goldEmail = makeFile(goldBody)

// twin (direction matters): candidate contains the gold body inside a longer reply,
// so it contains >= 80% of the gold's 8-grams -> twin true.
const twinEmail = makeFile(`Thanks for sending this over, see below for context.\n\n${goldBody}\n\nLet me know if you have questions.`)

// near-dup but NOT a twin: a short fragment of the gold. The gold contains the
// fragment (candidateInGold = 1), but the fragment does not contain 0.8 of the
// gold's shingles (goldInCandidate is tiny) -> not a strong twin.
const fragmentEmail = makeFile(goldBodyLines.slice(0, 2).join("\n"))

// unrelated: shares no shingles with the gold in either direction.
const unrelatedEmail = makeFile(
    "completely different content about quarterly finance reports and budget planning schedules " +
    "for next year, nothing to do with the gold email at all, an entirely separate topic here.",
)

function buildCache() {
    return new EvidenceCache(new Map([
        ["gold/1", goldEmail],
        ["twin/1", twinEmail],
        ["fragment/1", fragmentEmail],
        ["unrelated/1", unrelatedEmail],
    ]))
}

// ---------------------------------------------------------------------------
// EvidenceCache.relation: the twin/nearDup direction
// ---------------------------------------------------------------------------

test("relation: identical paths are trivially a twin, a near-dup and identical", () => {
    const cache = buildCache()
    const relation = cache.relation("gold/1", "gold/1")
    assert.deepEqual(relation, { twin: true, nearDup: true, identical: true, goldInCandidate: 1, candidateInGold: 1 })
})

test("relation: a candidate that contains the gold body (embedded in a longer reply) is a twin", () => {
    const cache = buildCache()
    const relation = cache.relation("gold/1", "twin/1")
    assert.ok(relation.goldInCandidate >= 0.8, `expected goldInCandidate >= 0.8, got ${relation.goldInCandidate}`)
    assert.equal(relation.twin, true)
    assert.equal(relation.nearDup, true)
    assert.equal(relation.identical, false)
})

test("relation: a short fragment OF the gold is near-dup but NOT a twin (direction matters)", () => {
    const cache = buildCache()
    const relation = cache.relation("gold/1", "fragment/1")
    // The fragment does not contain 80% of the gold's shingles...
    assert.ok(relation.goldInCandidate < 0.8, `expected goldInCandidate < 0.8, got ${relation.goldInCandidate}`)
    assert.equal(relation.twin, false)
    // ...but the gold fully contains the fragment, so nearDup (>= 0.5 in EITHER direction) is true.
    assert.ok(relation.candidateInGold >= 0.5, `expected candidateInGold >= 0.5, got ${relation.candidateInGold}`)
    assert.equal(relation.nearDup, true)
})

test("relation: unrelated emails are neither a twin nor a near-dup", () => {
    const cache = buildCache()
    const relation = cache.relation("gold/1", "unrelated/1")
    assert.equal(relation.twin, false)
    assert.equal(relation.nearDup, false)
    assert.equal(relation.goldInCandidate, 0)
    assert.equal(relation.candidateInGold, 0)
})

// ---------------------------------------------------------------------------
// EvidenceCache.answerBearing
// ---------------------------------------------------------------------------

const RECORD = { gold: "The meeting is scheduled for https://enron.example.com/meet on 05/10/2001", question: "When and where is the meeting?" }

function buildAnswerCache() {
    return new EvidenceCache(new Map([
        ["full/1", makeFile("Meeting info: https://enron.example.com/meet scheduled 05/10/2001. See you there.")],
        ["missing/1", makeFile("Meeting info: scheduled 05/10/2001, check the calendar invite. See you there.")],
    ]))
}

test("answerBearing: true when every critical span of the gold is present", () => {
    const cache = buildAnswerCache()
    assert.equal(cache.answerBearing("full/1", RECORD), true)
})

test("answerBearing: false when a critical span (the URL) is missing", () => {
    const cache = buildAnswerCache()
    assert.equal(cache.answerBearing("missing/1", RECORD), false)
})

test("answerBearing: null when the gold has nothing checkable (no spans, no novel words)", () => {
    const cache = buildAnswerCache()
    // The gold's only content word ("yes") also appears in the question, so there is
    // nothing left to check for either critical spans or novel answer words.
    const record = { gold: "yes", question: "Did they agree? yes" }
    assert.equal(cache.answerBearing("full/1", record), null)
})

test("answerBearing: falls back to novel answer words when the gold has no critical spans", () => {
    const cache = new EvidenceCache(new Map([
        ["present/1", makeFile("The project codename is Aurora Falcon and it launches soon.")],
        ["absent/1", makeFile("Nothing relevant is discussed in this email at all.")],
    ]))
    const record = { gold: "The codename is Aurora Falcon", question: "What is the project codename?" }
    assert.equal(cache.answerBearing("present/1", record), true)
    assert.equal(cache.answerBearing("absent/1", record), false)
})

// ---------------------------------------------------------------------------
// documentFrequency
// ---------------------------------------------------------------------------

test("documentFrequency counts each content word once per document", () => {
    const docs = [
        { email: makeFile("budget review meeting") },
        { email: makeFile("budget review meeting again") },
        { email: makeFile("completely different topic here") },
    ]
    const df = documentFrequency(docs)
    assert.equal(df.get("budget"), 2)
    assert.equal(df.get("review"), 2)
    assert.equal(df.get("meeting"), 2)
    assert.equal(df.get("different"), 1)
    assert.equal(df.get("topic"), 1)
})
