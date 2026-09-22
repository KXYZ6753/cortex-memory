import assert from "node:assert/strict"
import test from "node:test"
import {
    LOSSLESS,
    REPRESENTATIONS,
    render,
    renderR0,
    renderR1,
    renderR2,
    renderRL,
    renderRV1,
    retention,
} from "../../benchmarks/premise2/represent.js"
import { SEPARATOR } from "../../benchmarks/premise2/text.js"

// A synthetic EnronQA-shaped file: header section (Subject/Sender/Recipients/File),
// the SEPARATOR, then a threaded body (newest message + one embedded Outlook
// original-message block), matching the format read by splitFile/parseFileHeader.
const THREADED_EMAIL = `Subject: Q3 budget numbers
Sender: bob.jones@enron.com
Recipients: ['alice.smith@enron.com', 'carol.white@enron.com']
File: bob-jones/inbox/123.
${SEPARATOR}
Alice,

Please see https://enron.example.com/budget/q3 for the final numbers, due 05/10/2001.

-----Original Message-----
From: Alice Smith
Sent: Monday, May 07, 2001 9:00 AM
To: Bob Jones
Subject: Q3 budget numbers

Bob, can you send me the Q3 numbers by 05/10/2001? Link: https://enron.example.com/budget/q3
${SEPARATOR}`

const GOLD_ANSWERS = ["https://enron.example.com/budget/q3", "05/10/2001"]
const QUESTION = "When is it due and what is the link?"

// ---------------------------------------------------------------------------
// R0 is the email verbatim
// ---------------------------------------------------------------------------

test("renderR0 returns the email verbatim (trimmed)", () => {
    assert.equal(renderR0(THREADED_EMAIL), THREADED_EMAIL.trim())
})

test("render(email, 'R0') dispatches to renderR0", () => {
    assert.equal(render(THREADED_EMAIL, "R0"), renderR0(THREADED_EMAIL))
})

test("render throws on an unknown representation", () => {
    assert.throws(() => render(THREADED_EMAIL, "R9"), /Unknown representation/)
})

test("REPRESENTATIONS and LOSSLESS list the expected representations", () => {
    assert.deepEqual(REPRESENTATIONS, ["R0", "R1", "R2", "RL", "RV1"])
    assert.ok(LOSSLESS instanceof Set)
    assert.deepEqual([...LOSSLESS].sort(), ["R0", "R1", "R2"])
})

// ---------------------------------------------------------------------------
// R1 and R2 keep every URL, date, number and email address from R0
// ---------------------------------------------------------------------------

test("retention: R0, R1 and R2 lose zero critical spans and zero novel answer words", () => {
    for (const representation of ["R0", "R1", "R2"]) {
        const result = retention(THREADED_EMAIL, representation, GOLD_ANSWERS, QUESTION)
        assert.ok(result.spansPresent > 0, `${representation}: expected at least one critical span in the gold`)
        assert.equal(result.spansKept, result.spansPresent, `${representation}: expected zero span losses`)
        assert.deepEqual(result.lostSpans, [], `${representation}: expected no lost spans`)
        assert.equal(result.wordsKept, result.wordsPresent, `${representation}: expected zero word losses`)
        assert.deepEqual(result.lostWords, [], `${representation}: expected no lost words`)
    }
})

// ---------------------------------------------------------------------------
// RV1 (V1-lossy) loses the URL: V1 replaced URLs with "[link]"
// ---------------------------------------------------------------------------

test("retention: RV1 loses the URL critical span", () => {
    const result = retention(THREADED_EMAIL, "RV1", GOLD_ANSWERS, QUESTION)
    assert.ok(result.spansKept < result.spansPresent, "expected RV1 to lose at least one span")
    assert.ok(result.lostSpans.some((span) => span.startsWith("url:")), `expected a lost url: span, got ${JSON.stringify(result.lostSpans)}`)
})

test("renderRV1 literally replaces http(s) URLs with '[link]'", () => {
    const rendered = renderRV1(THREADED_EMAIL)
    assert.ok(!/https?:\/\//.test(rendered), "expected no raw URL to survive RV1")
    assert.ok(rendered.includes("[link]"))
})

test("renderRV1 drops Sent:/Cc:/Bcc: body lines", () => {
    const rendered = renderRV1(THREADED_EMAIL)
    assert.ok(!/^\s*Sent:/im.test(rendered), "expected Sent: lines to be dropped from the body")
})

// ---------------------------------------------------------------------------
// R2: bracketed attribution line for a threaded email, original field values kept
// ---------------------------------------------------------------------------

test("renderR2 emits one bracketed attribution line per message, numbered 'Message N of total'", () => {
    const rendered = renderR2(THREADED_EMAIL)
    assert.match(rendered, /^\[Message 1 of 2 \(newest\)[^\]]*\]/)
    assert.match(rendered, /\[Message 2 of 2 \|[^\]]*From: Alice Smith[^\]]*\]/)
})

test("renderR2 keeps every original header field value verbatim inside the attribution line", () => {
    const rendered = renderR2(THREADED_EMAIL)
    // The embedded message's field values (From/Sent/To/Subject) must appear
    // untouched, even though a readable name/ISO date is appended beside them.
    assert.match(rendered, /From: Alice Smith/)
    assert.match(rendered, /Sent: Monday, May 07, 2001 9:00 AM/)
    assert.match(rendered, /To: Bob Jones/)
    assert.match(rendered, /Subject: Q3 budget numbers/)
})

test("renderR2 drops the File: line but keeps Subject/Sender/Recipients from the file header", () => {
    const rendered = renderR2(THREADED_EMAIL)
    assert.ok(!/^File:/im.test(rendered), "expected File: to be dropped")
    assert.match(rendered, /Subject: Q3 budget numbers/)
    assert.match(rendered, /Sender: Bob Jones \(bob\.jones@enron\.com\)/)
})

test("renderR2 keeps the message body lines untouched", () => {
    const rendered = renderR2(THREADED_EMAIL)
    assert.ok(rendered.includes("Please see https://enron.example.com/budget/q3 for the final numbers, due 05/10/2001."))
    assert.ok(rendered.includes("Bob, can you send me the Q3 numbers by 05/10/2001? Link: https://enron.example.com/budget/q3"))
})

// ---------------------------------------------------------------------------
// RL (latest-only): newest message only
// ---------------------------------------------------------------------------

test("renderRL keeps only the newest (top) message body, dropping the embedded original message", () => {
    const rendered = renderRL(THREADED_EMAIL)
    assert.ok(rendered.includes("Please see https://enron.example.com/budget/q3 for the final numbers"))
    assert.ok(!rendered.includes("Bob, can you send me the Q3 numbers"), "expected the embedded message body to be dropped")
})

// ---------------------------------------------------------------------------
// A single untreaded message: R2 still produces exactly one attribution line
// ---------------------------------------------------------------------------

test("renderR2 on an untreaded email produces a single 'Message 1 of 1 (newest)' block", () => {
    const email = `Subject: Quick note
Sender: bob.jones@enron.com
Recipients: ['alice.smith@enron.com']
File: bob-jones/inbox/124.
${SEPARATOR}
Alice, just checking in. No thread here.
${SEPARATOR}`
    const rendered = renderR2(email)
    assert.match(rendered, /^\[Message 1 of 1 \(newest\)[^\]]*\]/)
    assert.ok(!rendered.includes("Message 2 of"))
})
