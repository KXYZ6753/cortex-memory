import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertExplorable, questionRecord } from "../../benchmarks/premise2/explore/pool.js"
import { drawFrom } from "../../benchmarks/premise2/explore/sets.js"
import { weighted, pairedBootstrap, bucketOf } from "../../benchmarks/premise2/explore/analyze.js"
import { answerKey, ExploreStore } from "../../benchmarks/premise2/explore/run.js"

const makeGuard = () => ({
    tuning: new Set(["alice", "bob"]),
    forbiddenPaths: new Set(["carol/inbox/9."]),
    evaluationUsers: new Set(["carol"]),
    devKeys: new Set(["dev:alice/inbox/5.#0"]),
    devPaths: new Set(),
})
const clean = () => ({ questionKey: "dev:alice/inbox/1.#0", path: "alice/inbox/1.", user: "alice", twins: ["alice/inbox/2."], nearDups: [] })

test("assertExplorable passes a clean record", () => {
    assert.equal(assertExplorable(clean(), makeGuard()), true)
})

test("assertExplorable rejects non-tuning user, path/user mismatch, forbidden paths, dev keys", () => {
    const guard = makeGuard()
    assert.throws(() => assertExplorable({ ...clean(), user: "carol", path: "carol/inbox/1." }, guard), /not a tuning mailbox/)
    assert.throws(() => assertExplorable({ ...clean(), path: "bob/inbox/1." }, guard), /mismatch/)
    assert.throws(() => assertExplorable({ ...clean(), twins: ["carol/inbox/9."] }, guard), /evaluation email/)
    assert.throws(() => assertExplorable({ ...clean(), nearDups: ["carol/inbox/9."] }, guard), /evaluation email/)
    const goldForbidden = makeGuard()
    goldForbidden.forbiddenPaths.add("alice/inbox/1.")
    assert.throws(() => assertExplorable(clean(), goldForbidden), /evaluation email/)
    assert.throws(() => assertExplorable({ ...clean(), questionKey: "dev:alice/inbox/5.#0" }, guard), /DEV/)
})

test("questionRecord builds keys and rejects blank question or gold", () => {
    const row = { path: "alice/inbox/1.", user: "alice" }
    const fields = { questions: ["What is the date?", "  ", "Q3?"], gold_answers: ["Tuesday", "x", " "], rephrased_questions: ["Date?"], alternate_answers: [["Tue", ""]] }
    const record = questionRecord(row, "dev", 0, fields)
    assert.equal(record.questionKey, "dev:alice/inbox/1.#0")
    assert.equal(record.question, "What is the date?")
    assert.equal(record.gold, "Tuesday")
    assert.equal(record.rephrased, "Date?")
    assert.deepEqual(record.alternates, ["Tue"])
    assert.equal(questionRecord(row, "dev", 1, fields), null)
    assert.equal(questionRecord(row, "dev", 2, fields), null)
    assert.equal(questionRecord(row, "dev", 5, fields), null)
    assert.equal(questionRecord(row, "test", 0, {}), null)
})

// ---- drawFrom ----

const users = ["u0", "u1", "u2", "u3", "u4", "u5"]
function makeRecords() {
    const records = []
    for (const user of users) {
        for (let i = 0; i < 10; i++) {
            const path = `${user}/inbox/${i}.`
            // pairs (0,1), (2,3) ... are twin groups
            const twinPath = i % 2 === 0 ? `${user}/inbox/${i + 1}.` : `${user}/inbox/${i - 1}.`
            records.push({
                questionKey: `dev:${path}#0`, path, user, stratum: i < 5 ? "miss" : "hit",
                twins: [twinPath], nearDups: [],
            })
        }
    }
    return records
}
const quintileOf = new Map(users.map((user, index) => [user, index % 5]))
const run = (records, quota, extra = {}) => {
    const claimed = extra.claimed ?? new Set()
    const chosen = drawFrom(records, quota, { claimed, usedKeys: extra.usedKeys ?? new Set(), seed: extra.seed ?? 7, quintileOf })
    return { chosen, claimed }
}

test("drawFrom returns the requested count per stratum with disjoint paths and twin groups", () => {
    const { chosen, claimed } = run(makeRecords(), { miss: 6, hit: 8 })
    assert.equal(chosen.filter((r) => r.stratum === "miss").length, 6)
    assert.equal(chosen.filter((r) => r.stratum === "hit").length, 8)
    const seen = new Set()
    for (const record of chosen) {
        for (const path of [record.path, ...record.twins]) {
            assert.ok(!seen.has(path), `${path} reused`)
            seen.add(path)
        }
        assert.ok(claimed.has(record.path))
    }
    assert.equal(new Set(chosen.map((r) => r.path)).size, chosen.length)
})

test("drawFrom skips usedKeys and respects pre-claimed paths", () => {
    const records = makeRecords()
    const usedKeys = new Set(records.filter((r) => r.user === "u0").map((r) => r.questionKey))
    const { chosen } = run(records, { miss: 6, hit: 6 }, { usedKeys })
    assert.ok(chosen.every((r) => r.user !== "u0"))
    const claimed = new Set(records.filter((r) => r.user === "u1").map((r) => r.path))
    const second = run(records, { miss: 6, hit: 6 }, { claimed })
    assert.ok(second.chosen.every((r) => r.user !== "u1"))
})

test("drawFrom is deterministic for a seed", () => {
    const keys = (seed) => run(makeRecords(), { miss: 6, hit: 6 }, { seed }).chosen.map((r) => r.questionKey)
    assert.deepEqual(keys(11), keys(11))
})

test("drawFrom throws when a stratum is short", () => {
    assert.throws(() => run(makeRecords(), { miss: 40, hit: 1 }), /only \d+ of 40 miss/)
    assert.throws(() => run(makeRecords(), { miss: 1, hit: 100 }), /of 100 hit/)
})

// ---- analyze ----

test("weighted combines strata by missShare", () => {
    const items = [
        { stratum: "miss", correct: 1 }, { stratum: "miss", correct: 0 },
        { stratum: "hit", correct: 1 }, { stratum: "hit", correct: 1 }, { stratum: "hit", correct: 1 }, { stratum: "hit", correct: 0 },
    ]
    const result = weighted(items, 0.2)
    assert.equal(result.miss, 0.5)
    assert.equal(result.hit, 0.75)
    assert.ok(Math.abs(result.weighted - (0.2 * 0.5 + 0.8 * 0.75)) < 1e-12)
    assert.equal(result.nMiss, 2)
    assert.equal(result.nHit, 4)
})

const pairsOf = (a, b) => users.flatMap((user) => ["miss", "hit"].flatMap((stratum) => [0, 1].map(() => ({ user, stratum, a, b }))))

test("pairedBootstrap: identical arms give zero difference and a degenerate CI", () => {
    const result = pairedBootstrap(pairsOf(1, 1), 0.3, { B: 200 })
    assert.equal(result.weighted, 0)
    assert.equal(result.low, 0)
    assert.equal(result.high, 0)
})

test("pairedBootstrap: a always right and b always wrong gives +1", () => {
    const result = pairedBootstrap(pairsOf(1, 0), 0.3, { B: 200 })
    assert.ok(Math.abs(result.weighted - 1) < 1e-12)
    assert.ok(Math.abs(result.low - 1) < 1e-12)
    assert.ok(Math.abs(result.high - 1) < 1e-12)
})

test("bucketOf precedence", () => {
    const bearing = (path) => path === "gold"
    const base = { correct: 0, technical: false, abstain: false, answer: {} }
    assert.equal(bucketOf({ ...base, correct: 1, technical: true, abstain: true, answer: { openedPaths: ["gold"] } }, bearing), "correct")
    assert.equal(bucketOf({ ...base, technical: true, abstain: true, answer: { openedPaths: ["gold"] } }, bearing), "technical")
    assert.equal(bucketOf({ ...base, abstain: true, answer: { openedPaths: ["gold"] } }, bearing), "abstained")
    assert.equal(bucketOf({ ...base, answer: { openedPaths: ["gold"] } }, bearing), "read but wrong")
    assert.equal(bucketOf({ ...base, answer: { readPaths: ["gold"] } }, bearing), "read but wrong")
    assert.equal(bucketOf({ ...base, answer: { contextPaths: ["gold"] } }, bearing), "read but wrong")
    assert.equal(bucketOf({ ...base, answer: { openedPaths: ["other"], shownPaths: ["gold"] } }, bearing), "shown not opened")
    assert.equal(bucketOf({ ...base, answer: { shownPaths: ["gold"] } }, bearing), "shown not opened")
    assert.equal(bucketOf({ ...base, answer: { openedPaths: ["other"], shownPaths: ["other"] } }, bearing), "never found")
    assert.equal(bucketOf({ ...base, answer: {} }, bearing), "never found")
})

// ---- run ----

test("answerKey changes with version and other parts", () => {
    const part = { digest: "d", variant: "v", version: 1, questionKey: "q" }
    assert.equal(answerKey(part), answerKey({ ...part }))
    assert.notEqual(answerKey(part), answerKey({ ...part, version: 2 }))
    assert.notEqual(answerKey(part), answerKey({ ...part, questionKey: "q2" }))
    assert.notEqual(answerKey(part), answerKey({ ...part, digest: "e" }))
})

test("ExploreStore: final statuses done, transient done after 3 attempts, reload restores", () => {
    const dir = mkdtempSync(join(tmpdir(), "explore-store-"))
    try {
        const path = join(dir, "answers.jsonl")
        const store = new ExploreStore(path)
        for (const status of ["ok", "output_limit", "empty", "context_overflow"]) {
            const key = `k-${status}`
            assert.equal(store.done(key), false)
            store.add({ key, status })
            assert.equal(store.done(key), true)
        }
        store.add({ key: "t", status: "http_error" })
        store.add({ key: "t", status: "http_error" })
        assert.equal(store.done("t"), false)
        store.add({ key: "t", status: "http_error" })
        assert.equal(store.done("t"), true)
        store.add({ key: "t2", status: "http_error" })

        const reloaded = new ExploreStore(path)
        for (const status of ["ok", "output_limit", "empty", "context_overflow"]) assert.equal(reloaded.done(`k-${status}`), true)
        assert.equal(reloaded.done("t"), true)
        assert.equal(reloaded.done("t2"), false)
        assert.equal(reloaded.byKey.get("k-ok").status, "ok")
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

import { parseSelection, parseQuoted } from "../../benchmarks/premise2/explore/variants.js"

test("parseSelection: numbers in range, deduplicated, NONE empty", () => {
    assert.deepEqual(parseSelection("2, 4", 5), [2, 4])
    assert.deepEqual(parseSelection("[3] and [3], also 9", 5), [3])
    assert.deepEqual(parseSelection("NONE", 5), [])
    assert.deepEqual(parseSelection("none of them", 5), [])
    assert.deepEqual(parseSelection("", 5), [])
})

test("parseQuoted: text after the last ANSWER label, else reply minus QUOTE", () => {
    assert.equal(parseQuoted("QUOTE: the price is $5\nANSWER: $5."), "$5.")
    assert.equal(parseQuoted("**QUOTE:** x\n**ANSWER:** NOT IN EMAILS"), "NOT IN EMAILS")
    assert.equal(parseQuoted("QUOTE: x\nIt was Bob."), "It was Bob.")
    assert.equal(parseQuoted("Bob"), "Bob")
})
