import assert from "node:assert/strict"
import test from "node:test"
import {
    distractorContext,
    goldSlot,
    hardDistractors,
    randomDistractors,
    retrievalContext,
} from "../../benchmarks/premise2/contexts.js"
import { EvidenceCache } from "../../benchmarks/premise2/evidence.js"
import { SEPARATOR } from "../../benchmarks/premise2/text.js"

const makeFile = (body, subject = "Test") =>
    `Subject: ${subject}\nSender: bob@enron.com\nRecipients: ['alice@enron.com']\nFile: bob/inbox/1.\n${SEPARATOR}\n${body}\n${SEPARATOR}`

// ---------------------------------------------------------------------------
// goldSlot
// ---------------------------------------------------------------------------

test("goldSlot: 'first' maps to slot 0 and 'last' maps to slot = count", () => {
    // Scan enough pool indices to see all three buckets for a fixed densityOffset.
    const seen = new Map()
    for (let poolIndex = 0; poolIndex < 3; poolIndex++) seen.set(goldSlot(poolIndex, 4, 4).bucket, goldSlot(poolIndex, 4, 4))
    for (const [bucket, { slot }] of seen) {
        if (bucket === "first") assert.equal(slot, 0)
        if (bucket === "last") assert.equal(slot, 4)
        if (bucket === "middle") assert.equal(slot, Math.floor((4 + 1) / 2))
    }
})

test("goldSlot: gold positions are balanced across a large pool (exact thirds)", () => {
    const counts = { first: 0, middle: 0, last: 0 }
    const total = 300
    for (let poolIndex = 0; poolIndex < total; poolIndex++) counts[goldSlot(poolIndex, 4, 4).bucket]++
    for (const bucket of ["first", "middle", "last"]) {
        assert.ok(Math.abs(counts[bucket] - total / 3) <= 1, `${bucket}: ${counts[bucket]} not close to ${total / 3}`)
    }
})

// ---------------------------------------------------------------------------
// distractorContext
// ---------------------------------------------------------------------------

test("distractorContext inserts the gold exactly once, at the position goldSlot assigns", () => {
    const record = { path: "gold/1", questionKey: "q1" }
    const distractors = [{ path: "d1" }, { path: "d2" }, { path: "d3" }, { path: "d4" }]
    const ctx = distractorContext(record, 0, distractors, 4)
    const goldOccurrences = ctx.paths.filter((path) => path === "gold/1")
    assert.equal(goldOccurrences.length, 1)
    assert.equal(ctx.paths.length, distractors.length + 1)
    assert.equal(ctx.paths[ctx.goldPosition], "gold/1")
    assert.deepEqual(goldSlot(0, distractors.length, 4), { bucket: ctx.goldBucket, slot: ctx.goldPosition })
})

test("distractorContext never duplicates a distractor path", () => {
    const record = { path: "gold/1", questionKey: "q1" }
    const distractors = [{ path: "d1" }, { path: "d2" }, { path: "d3" }]
    const ctx = distractorContext(record, 1, distractors, 9)
    const unique = new Set(ctx.paths)
    assert.equal(unique.size, ctx.paths.length)
})

// ---------------------------------------------------------------------------
// retrievalContext
// ---------------------------------------------------------------------------

test("retrievalContext: rank order keeps the first k in place", () => {
    const ranked = ["a", "b", "c", "d", "e", "f"]
    const ctx = retrievalContext(ranked, { k: 3, order: "rank", gateK: 5 })
    assert.deepEqual(ctx, { paths: ["a", "b", "c"], k: 3 })
})

test("retrievalContext: bestlast reverses the first k so the top hit sits last", () => {
    const ranked = ["a", "b", "c", "d", "e", "f"]
    const ctx = retrievalContext(ranked, { k: 3, order: "bestlast", gateK: 5 })
    assert.deepEqual(ctx, { paths: ["c", "b", "a"], k: 3 })
})

test("retrievalContext: k = 'gate' uses gateK instead of a fixed k", () => {
    const ranked = ["a", "b", "c", "d", "e", "f"]
    const ctx = retrievalContext(ranked, { k: "gate", order: "rank", gateK: 2 })
    assert.deepEqual(ctx, { paths: ["a", "b"], k: 2 })
})

// ---------------------------------------------------------------------------
// hardDistractors: exclusions (twins, near-dups, answer-bearing, same thread)
// and the dist4/dist9 nesting property
// ---------------------------------------------------------------------------

function buildHardDistractorFixture() {
    const goldBodyLines = Array.from({ length: 12 }, (_, i) =>
        `paragraph ${i} about the quarterly budget review meeting scheduled for next tuesday afternoon session`)
    const goldBody = `${goldBodyLines.join("\n")}\nSee https://enron.example.com/budget/final for the final numbers.`
    const record = {
        path: "bob/gold", user: "bob", questionKey: "q1", question: "what",
        gold: "The final numbers are at https://enron.example.com/budget/final",
    }
    const emailByPath = new Map()
    emailByPath.set(record.path, makeFile(goldBody, "Budget Meeting"))
    // Twin: contains the gold body embedded in a longer reply.
    emailByPath.set("bob/twin", makeFile(`Reply below.\n\n${goldBody}\n\nThanks!`, "Re: Budget Meeting"))
    // Near-dup, not a twin: a short fragment of the gold body under an unrelated subject.
    emailByPath.set("bob/fragment", makeFile(goldBodyLines.slice(0, 2).join("\n"), "Random subject A"))
    // Answer-bearing: carries the gold's critical span (the URL) but is not a twin/near-dup.
    emailByPath.set("bob/answerbearing", makeFile(
        "Quick note: the final numbers are at https://enron.example.com/budget/final, nothing else related.",
        "Random subject B",
    ))
    // Same thread (normalised subject matches the gold's), unrelated content otherwise.
    emailByPath.set("bob/samethread", makeFile("Completely unrelated follow up about parking passes and badges for next month.", "Budget Meeting"))
    // Clean candidates that should survive every exclusion.
    for (let i = 0; i < 8; i++) {
        emailByPath.set(`user${i}/clean${i}`, makeFile(
            `Totally unrelated email number ${i} about office supplies and printer toner orders for the department floor.`,
            `Random ${i}`,
        ))
    }
    const evidence = new EvidenceCache(emailByPath)
    const bm25Top = [
        record.path, "bob/twin", "bob/fragment", "bob/answerbearing", "bob/samethread",
        ...[...emailByPath.keys()].filter((path) => path.startsWith("user")),
    ].map((path) => ({ path }))
    return { record, emailByPath, evidence, bm25Top }
}

test("hardDistractors excludes the gold, twins, near-dups, answer-bearing and same-thread emails", () => {
    const { record, emailByPath, evidence, bm25Top } = buildHardDistractorFixture()
    const { picked, excluded } = hardDistractors(record, bm25Top, { evidence, emailByPath, count: 4 })
    assert.deepEqual(excluded, { gold: 1, twin: 1, nearDup: 1, answerBearing: 1, sameThread: 1 })
    assert.deepEqual(picked.map((item) => item.path), ["user0/clean0", "user1/clean1", "user2/clean2", "user3/clean3"])
    assert.ok(!picked.some((item) => item.path === record.path), "the gold must never appear among its own distractors")
})

test("hardDistractors: the dist4 picks are a strict prefix of the dist9 picks for the same question", () => {
    const { record, emailByPath, evidence, bm25Top } = buildHardDistractorFixture()
    const dist4 = hardDistractors(record, bm25Top, { evidence, emailByPath, count: 4 })
    const dist9 = hardDistractors(record, bm25Top, { evidence, emailByPath, count: 9 })
    assert.deepEqual(dist4.picked.map((item) => item.path), dist9.picked.slice(0, 4).map((item) => item.path))
})

// ---------------------------------------------------------------------------
// randomDistractors: exclusions and the dist4/dist9 nesting property
// ---------------------------------------------------------------------------

test("randomDistractors excludes the gold, twins and near-dups, and never duplicates a pick", () => {
    const { record, emailByPath, evidence } = buildHardDistractorFixture()
    const docs = [...emailByPath.keys()].map((path) => ({ path }))
    const picked = randomDistractors(record, docs, { evidence, seed: 99, count: 4 })
    assert.equal(picked.length, 4)
    assert.ok(!picked.some((item) => item.path === record.path))
    assert.ok(!picked.some((item) => item.path === "bob/twin"))
    assert.ok(!picked.some((item) => item.path === "bob/fragment"))
    const unique = new Set(picked.map((item) => item.path))
    assert.equal(unique.size, picked.length)
})

test("randomDistractors excludes an answer-bearing email even when it is the only alternative to a clean one", () => {
    const { record, evidence } = buildHardDistractorFixture()
    // Force the draw between only the answer-bearing email and one clean email: if the
    // answerBearing exclusion were not applied, some seed would pick it.
    const forcedDocs = [{ path: "bob/answerbearing" }, { path: "user0/clean0" }]
    for (const seed of [1, 2, 3, 4, 5]) {
        const picked = randomDistractors(record, forcedDocs, { evidence, seed, count: 1 })
        assert.deepEqual(picked.map((item) => item.path), ["user0/clean0"])
    }
})

test("randomDistractors: the dist4 picks are a strict prefix of the dist9 picks for the same seed and question", () => {
    const { record, emailByPath, evidence } = buildHardDistractorFixture()
    const docs = [...emailByPath.keys()].map((path) => ({ path }))
    const rd4 = randomDistractors(record, docs, { evidence, seed: 99, count: 4 })
    const rd9 = randomDistractors(record, docs, { evidence, seed: 99, count: 9 })
    assert.deepEqual(rd4.map((item) => item.path), rd9.slice(0, 4).map((item) => item.path))
})
