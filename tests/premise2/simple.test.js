import test from "node:test"
import assert from "node:assert/strict"
import { budgetedFive, finalSimpleAnswers, orderedTestRecords, rankBudgetedCorpus, rankOverlap, searchableText } from "../../benchmarks/premise2/simple.js"
import { buildPrompt, promptRecord, TOKEN_CAP } from "../../benchmarks/premise2/prompts.js"

const email = (subject, body = "") => `Subject: ${subject}\nSender: Alice\nRecipients: ['Bob']\nFile: hidden-secret\n=====================================\n${body}`

test("word overlap counts each query word once and ignores File path and gold", () => {
    const records = [{ question: "alpha beta", gold: "omega", questionKey: "a" }]
    const docs = [
        { path: "z", email: email("alpha alpha alpha") },
        { path: "b", email: email("alpha beta") },
        { path: "a", email: email("alpha beta") },
        { path: "c", email: email("nothing", "hidden-secret") },
    ]
    const ranked = rankOverlap(records, docs, 3)[0]
    assert.deepEqual(ranked.map(({ path, score }) => [path, score]), [["a", 2], ["b", 2], ["z", 1]])
    assert.equal(searchableText(email("hello")).includes("hidden-secret"), false)
    assert.deepEqual(rankOverlap([{ ...records[0], gold: "changed" }], docs, 3), rankOverlap(records, docs, 3))
})

test("budget selection skips an oversized email without changing rank order", () => {
    const record = { question: "alpha" }
    const byPath = new Map([["huge", email("alpha", "x".repeat(40000))], ...[1, 2, 3, 4, 5].map((n) => [String(n), email("alpha", "short")])])
    const ranked = [{ path: "huge", score: 10 }, ...[1, 2, 3, 4, 5].map((n) => ({ path: String(n), score: 5 }))]
    const selected = budgetedFive(record, ranked, byPath)
    assert.deepEqual(selected.paths, ["1", "2", "3", "4", "5"])
    assert.ok(promptRecord(buildPrompt({ question: record.question, paths: selected.paths, representation: "R0", template: "T2", emailByPath: byPath })).tokensUpper <= TOKEN_CAP)
})

test("full-corpus ranker reserves room for five without filtering a gold email by length", () => {
    const docs = [{ path: "huge", email: email("alpha beta", "x".repeat(33800)) }, ...[1, 2, 3, 4, 5].map((n) => ({ path: `short${n}`, email: email("alpha", "short") }))]
    const [result] = rankBudgetedCorpus([{ question: "alpha beta", gold: "huge" }], docs)
    assert.equal(result.paths.length, 5)
    assert.equal(result.paths.includes("huge"), false)
    assert.deepEqual(result.paths, ["short1", "short2", "short3", "short4", "short5"])
    assert.deepEqual(result, rankBudgetedCorpus([{ question: "alpha beta", gold: "different" }], docs)[0])
})

test("agent core order is retained and remaining test questions follow", () => {
    const pools = { test: [{ questionKey: "a" }, { questionKey: "b" }, { questionKey: "c" }] }
    assert.deepEqual(orderedTestRecords(pools, { items: [{ questionKey: "c" }, { questionKey: "a" }] }).map((row) => row.questionKey), ["c", "a", "b"])
    assert.throws(() => orderedTestRecords(pools, { items: [{ questionKey: "a" }, { questionKey: "a" }] }), /duplicate/)
})

test("only final successes and exhausted technical failures count as complete", () => {
    const row = (key, status) => ({ type: "answer", key, status })
    const result = finalSimpleAnswers([row("ok", "ok"), row("retry", "timeout"), row("final", "timeout"), row("final", "timeout"), row("final", "timeout"), row("overflow", "context_overflow")])
    assert.equal(result.has("ok"), true)
    assert.equal(result.has("retry"), false)
    assert.equal(result.get("final").terminalFailure, true)
    assert.equal(result.has("overflow"), true)
})
