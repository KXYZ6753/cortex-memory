import assert from "node:assert/strict"
import test from "node:test"
import {
    inCorrectAudit,
    preGrade,
    spanScore,
    verdictKey,
    verifyQuotes,
} from "../../benchmarks/premise2/judge.js"

// ---------------------------------------------------------------------------
// verifyQuotes
// ---------------------------------------------------------------------------

const SUPPORTING = ["The final numbers are due on 05/10/2001 as discussed in our last call."]
const DISTRACTOR = ["An unrelated email about printer toner orders and office supplies for next month."]

test("verifyQuotes accepts a quote that occurs verbatim in a supporting email", () => {
    const result = verifyQuotes([{ text: "final numbers are due on 05/10/2001", supports: "date" }], SUPPORTING)
    assert.equal(result.verifiedCount, 1)
    assert.equal(result.quotes[0].verified, true)
})

test("verifyQuotes rejects a quote that appears only in a distractor, not passed as supporting", () => {
    // The quote is verbatim in DISTRACTOR but DISTRACTOR is never passed to verifyQuotes:
    // only emails allowed to support the answer may "verify" a quote.
    const result = verifyQuotes([{ text: "printer toner orders", supports: "irrelevant" }], SUPPORTING)
    assert.equal(result.verifiedCount, 0)
    assert.equal(result.quotes[0].verified, false)
})

test("verifyQuotes is case- and whitespace-insensitive", () => {
    const result = verifyQuotes([{ text: "FINAL   numbers ARE due" }], SUPPORTING)
    assert.equal(result.quotes[0].verified, true)
})

test("verifyQuotes: a quote under 8 characters is never verified, even if it occurs verbatim", () => {
    // "final n" (7 chars) is a genuine substring of SUPPORTING, but is too short to count.
    const short = verifyQuotes([{ text: "final n" }], SUPPORTING)
    assert.equal(short.quotes[0].verified, false)
    // The same text at exactly 8 chars is long enough.
    const eight = verifyQuotes([{ text: "final nu" }], SUPPORTING)
    assert.equal(eight.quotes[0].verified, true)
})

test("verifyQuotes only looks at the first 3 quotes", () => {
    const quotes = [
        { text: "final numbers are due" },
        { text: "on 05/10/2001 as discussed" },
        { text: "in our last call" },
        { text: "printer toner orders" }, // 4th: would be unverified anyway, but must not even be scored
    ]
    const result = verifyQuotes(quotes, SUPPORTING)
    assert.equal(result.quotes.length, 3)
})

// ---------------------------------------------------------------------------
// preGrade
// ---------------------------------------------------------------------------

test("preGrade: a technical failure status (e.g. timeout) is deterministically INCORRECT", () => {
    assert.deepEqual(preGrade({ status: "timeout" }), { final: "INCORRECT", source: "technical", technical: "timeout" })
    assert.deepEqual(preGrade({ status: "http_error" }), { final: "INCORRECT", source: "technical", technical: "http_error" })
})

test("preGrade: an exact abstention ('NOT IN EMAILS') is deterministically INCORRECT", () => {
    assert.deepEqual(preGrade({ status: "ok", answer: "NOT IN EMAILS" }), { final: "INCORRECT", source: "abstain", abstain: true })
})

test("preGrade: a normal ok answer returns null (must go to an LLM judge)", () => {
    assert.equal(preGrade({ status: "ok", answer: "The deadline is May 10." }), null)
})

test("preGrade: 'output_limit' is not a technical failure by itself (still needs a judge unless it abstains)", () => {
    assert.equal(preGrade({ status: "output_limit", answer: "The deadline is May 10." }), null)
})

// ---------------------------------------------------------------------------
// spanScore
// ---------------------------------------------------------------------------

test("spanScore: 1 when the answer contains the gold's critical span", () => {
    const score = spanScore("Here it is: https://enron.example.com/budget/final", "The link is https://enron.example.com/budget/final")
    assert.equal(score, 1)
})

test("spanScore: 0 when the answer is missing the gold's critical span", () => {
    const score = spanScore("I don't have it", "The link is https://enron.example.com/budget/final")
    assert.equal(score, 0)
})

test("spanScore: null when the gold has no critical spans", () => {
    assert.equal(spanScore("anything at all", "no checkable spans here"), null)
})

// ---------------------------------------------------------------------------
// verdictKey
// ---------------------------------------------------------------------------

const ITEM = { questionKey: "q1", references: ["ref1"], answer: "ans1", judge: { model: "m1", provider: "ollama" } }

test("verdictKey is stable for identical inputs", () => {
    assert.equal(verdictKey(ITEM), verdictKey({ ...ITEM }))
})

test("verdictKey changes with the judge model", () => {
    assert.notEqual(verdictKey(ITEM), verdictKey({ ...ITEM, judge: { model: "m2", provider: "ollama" } }))
})

test("verdictKey changes with the answer text", () => {
    assert.notEqual(verdictKey(ITEM), verdictKey({ ...ITEM, answer: "ans2" }))
})

test("verdictKey does not change for a whitespace-only difference in the answer", () => {
    assert.equal(verdictKey(ITEM), verdictKey({ ...ITEM, answer: "  ans1  " }))
    assert.equal(verdictKey({ ...ITEM, answer: "ans1\n\n  extra   spaces" }), verdictKey({ ...ITEM, answer: "ans1 extra spaces" }))
})

test("verdictKey changes with the question key or references", () => {
    assert.notEqual(verdictKey(ITEM), verdictKey({ ...ITEM, questionKey: "q2" }))
    assert.notEqual(verdictKey(ITEM), verdictKey({ ...ITEM, references: ["ref2"] }))
})

// ---------------------------------------------------------------------------
// inCorrectAudit
// ---------------------------------------------------------------------------

test("inCorrectAudit selects about 10% of a large key set, deterministically", () => {
    const total = 2000
    let selected = 0
    for (let i = 0; i < total; i++) if (inCorrectAudit(`key-${i}`)) selected++
    const rate = selected / total
    assert.ok(rate >= 0.07 && rate <= 0.13, `expected ~10% (between 7% and 13%), got ${(rate * 100).toFixed(1)}%`)
})

test("inCorrectAudit is deterministic for a given key/seed/rate", () => {
    assert.equal(inCorrectAudit("key-5"), inCorrectAudit("key-5"))
    assert.equal(inCorrectAudit("key-5", 42, 0.1), inCorrectAudit("key-5", 42, 0.1))
})
