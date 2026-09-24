import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { directAgentOverlap, openAgentOverlap } from "../../benchmarks/premise2/agent-overlap-index.js"
import { overlapArm } from "../../benchmarks/premise2/agent-overlap.js"
import { armKey, armOptions } from "../../benchmarks/premise2/agent-run.js"
import { checkpointAccuracy } from "../../benchmarks/premise2/agent-overlap-report.js"
import { score } from "../../benchmarks/premise2/simple-report.js"

test("agent overlap ranks exact distinct words and path ties, with no zero-score fill", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-overlap-test-"))
    const path = join(dir, "corpus.sqlite")
    const db = new DatabaseSync(path)
    db.exec("CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, user UNINDEXED, subject, sender, recipients, content)")
    const insert = db.prepare("INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)")
    for (const [emailPath, subject, content] of [["b", "alpha alpha", ""], ["a", "alpha", ""], ["c", "beta", ""], ["d", "gamma", ""]]) insert.run(emailPath, "u", subject, "sender", "recipient", content)
    db.close()
    try {
        const index = openAgentOverlap(path)
        assert.deepEqual(index.search("alpha beta", 10), [{ path: "a", score: 1 }, { path: "b", score: 1 }, { path: "c", score: 1 }])
        assert.deepEqual(index.search("alpha alpha", 10), [{ path: "a", score: 1 }, { path: "b", score: 1 }])
        assert.deepEqual(index.search("unknown", 10), [])
        assert.deepEqual(index.search("the", 10), [])
        assert.deepEqual(index.search("alpha beta", 10), directAgentOverlap(path, "alpha beta", 10))
        index.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("agent overlap preserves model options but has a distinct episode key", () => {
    const record = { question: "Who received the contract?" }
    const overlap = overlapArm("small")
    const bm25 = { cell: "A-agent", alias: "small", index: "bm25" }
    assert.equal(armOptions(overlap, 160).optsHash, armOptions(bm25, 160).optsHash)
    assert.notEqual(armKey(overlap, record, "digest", armOptions(overlap, 160).optsHash), armKey(bm25, record, "digest", armOptions(bm25, 160).optsHash))
})

test("agent overlap report weights complete enriched core and suppresses partial intervals", () => {
    const paired = Array.from({ length: 200 }, (_, i) => ({ user: `mailbox-${i}`, stratum: i < 51 ? "miss" : "hit", a: i < 51 ? 1 : 0, b: 0 }))
    const shares = { miss: 0.085, hit: 0.915 }
    const complete = checkpointAccuracy({ paired, target: 200, generated: 200, core: true, shares, B: 50 })
    assert.equal(complete.complete, true)
    assert.equal(complete.weightedCore, true)
    assert.equal(complete.aAccuracy, 0.085)
    assert.equal(complete.bAccuracy, 0)
    assert.equal(complete.difference.estimate, 0.085)
    const partial = checkpointAccuracy({ paired: paired.slice(0, 199), target: 200, generated: 200, pending: 1, core: true, shares, B: 50 })
    assert.equal(partial.complete, false)
    assert.equal(partial.weightedCore, false)
    assert.deepEqual(partial.difference.ci, [null, null])
    assert.equal(partial.aAccuracy, 0.2563)
})

test("agent overlap report scores a terminal technical failure incorrect", () => {
    const unit = { answer: { status: "http_error", answer: "" } }
    assert.equal(score(unit, {}, {}).final, 0)
})
