import assert from "node:assert/strict"
import test from "node:test"
import {
    containment,
    criticalSpans,
    decodeQuotedPrintable,
    hasQuotedPrintable,
    questionType,
    shingleHashes,
    splitmix32,
} from "../../benchmarks/premise2/text.js"

// ---------------------------------------------------------------------------
// hasQuotedPrintable / decodeQuotedPrintable
// ---------------------------------------------------------------------------

test("hasQuotedPrintable is false for already-decoded text that merely contains '='", () => {
    assert.equal(hasQuotedPrintable("pid=20523"), false)
    assert.equal(hasQuotedPrintable("see http://example.com/path?a=1&b=2 for details"), false)
})

test("hasQuotedPrintable is true for a soft line break", () => {
    assert.equal(hasQuotedPrintable("Di=\nanne"), true)
})

test("hasQuotedPrintable is true for a literal '=3D' escape", () => {
    assert.equal(hasQuotedPrintable("cost =3D 5"), true)
})

test("decodeQuotedPrintable joins a soft break without inserting a space", () => {
    assert.equal(decodeQuotedPrintable("Di=\nanne"), "Dianne")
})

test("decodeQuotedPrintable decodes '=3D' to '='", () => {
    assert.equal(decodeQuotedPrintable("cost =3D 5"), "cost = 5")
})

test("decodeQuotedPrintable leaves text with no QP evidence untouched", () => {
    assert.equal(decodeQuotedPrintable("pid=20523"), "pid=20523")
})

// ---------------------------------------------------------------------------
// splitmix32
// ---------------------------------------------------------------------------

test("splitmix32 is deterministic for a given seed", () => {
    const a = splitmix32(7)
    const b = splitmix32(7)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    assert.deepEqual(seqA, seqB)
})

test("splitmix32 with different seeds diverges", () => {
    const a = splitmix32(7)()
    const b = splitmix32(8)()
    assert.notEqual(a, b)
})

// ---------------------------------------------------------------------------
// shingleHashes + containment
// ---------------------------------------------------------------------------

const LONG_TEXT_A = "the quick brown fox jumps over the lazy dog again and again for testing purposes right here today"
const LONG_TEXT_B = "completely unrelated content about quarterly finance reports and budget planning schedules for next year"

test("containment of a text's shingles in themselves is 1 (identical text)", () => {
    const hashesA = shingleHashes(LONG_TEXT_A)
    const hashesB = shingleHashes(LONG_TEXT_A)
    assert.equal(containment(hashesA, hashesB), 1)
})

test("containment between unrelated texts is near zero", () => {
    const hashesA = shingleHashes(LONG_TEXT_A)
    const hashesB = shingleHashes(LONG_TEXT_B)
    assert.ok(containment(hashesA, hashesB) <= 0.05, `expected near-zero containment, got ${containment(hashesA, hashesB)}`)
})

test("containment of an empty inner set is 0", () => {
    assert.equal(containment(new Set(), shingleHashes(LONG_TEXT_A)), 0)
})

// ---------------------------------------------------------------------------
// criticalSpans
// ---------------------------------------------------------------------------

test("criticalSpans extracts a URL, a date and a number from a gold answer", () => {
    const spans = criticalSpans("See https://example.com/x on 05/10/2001, cost $1,234.56")
    assert.ok(spans.some((span) => span.kind === "url" && span.value === "example.com/x"))
    assert.ok(spans.some((span) => span.kind === "date" && span.value === "05/10/2001"))
    assert.ok(spans.some((span) => span.kind === "number" && span.value === "1234.56"))
})

test("criticalSpans extracts an email address", () => {
    const spans = criticalSpans("Contact bob.jones@enron.com for details")
    assert.ok(spans.some((span) => span.kind === "email" && span.value === "bob.jones@enron.com"))
})

test("criticalSpans ignores bare short numbers as too ambiguous", () => {
    const spans = criticalSpans("There were 5 items on the list")
    assert.ok(!spans.some((span) => span.kind === "number"), "expected no number span for a 1-digit bare number")
})

test("criticalSpans deduplicates repeated spans", () => {
    const spans = criticalSpans("Visit https://example.com/x again: https://example.com/x")
    const urls = spans.filter((span) => span.kind === "url")
    assert.equal(urls.length, 1)
})

// ---------------------------------------------------------------------------
// questionType
// ---------------------------------------------------------------------------

test("questionType classifies a 'Who ...' question as who", () => {
    assert.equal(questionType("Who sent the email?"), "who")
})

test("questionType classifies a 'When ...' question as when", () => {
    assert.equal(questionType("When is the deadline?"), "when")
})

test("questionType classifies a link/phone/email question as url-contact", () => {
    assert.equal(questionType("What is the website link for the project?"), "url-contact")
    assert.equal(questionType("What is the phone number to call?"), "url-contact")
    assert.equal(questionType("What is her email address?"), "url-contact")
})

test("questionType classifies an amount question as number", () => {
    assert.equal(questionType("How much does it cost?"), "number")
})

test("questionType falls back to other", () => {
    assert.equal(questionType("What did they discuss?"), "other")
})
