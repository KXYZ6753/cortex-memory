import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildBm25Index, collapseByPath } from "../../benchmarks/premise2/bm25.js"
import { SEPARATOR } from "../../benchmarks/premise2/text.js"
import { EvidenceCache } from "../../benchmarks/premise2/evidence.js"
import { renderR1 } from "../../benchmarks/premise2/represent.js"
import {
    INDEX_VARIANTS, NEW_INDEX_CANDIDATES, bodyRows, buildAllVariants, chooseNewIndex, evaluateIndexes, openVariant, recallSummary,
} from "../../benchmarks/premise2/indexes.js"

const email = (subject, sender, body) => `Subject: ${subject}\nSender: ${sender}\nRecipients: ['x@enron.com']\nFile: f\n${SEPARATOR}\n${body}\n${SEPARATOR}`

const THREAD = `Sounds good, see you then.

-----Original Message-----
From: Smith, John
Sent: Monday, May 14, 2001 9:00 AM
To: Doe, Jane
Subject: pipeline meeting

The pipeline capacity meeting moved to Thursday at 3pm in room 42C.`

const DOCS = [
    { path: "a/1", user: "a", email: email("pipeline meeting", "jane.doe@enron.com", THREAD) },
    { path: "a/2", user: "a", email: email("lunch", "bob@enron.com", "Lunch on Friday? The pipe=\nline team is buying.") },
    { path: "b/1", user: "b", email: email("capacity report", "carol@enron.com", "> quoted pipeline capacity numbers\n> are attached") },
    { path: "b/2", user: "b", email: email("pipeline", "dave@enron.com", "Unrelated note about a pipeline.") },
]

function freshDir() {
    const dir = mkdtempSync(join(tmpdir(), "premise2-indexes-test-"))
    buildBm25Index(DOCS, join(dir, "corpus.sqlite"))
    buildAllVariants(DOCS, dir)
    return dir
}

test("bodyRows: r1 decodes soft line breaks and strips quoting; latest keeps the top message; msg splits the thread", () => {
    assert.match(bodyRows("r1", "The pipe=\nline team")[0], /pipeline team/)
    assert.equal(bodyRows("r1", "> quoted line")[0], "quoted line")
    const latest = bodyRows("latest", THREAD)
    assert.equal(latest.length, 1)
    assert.equal(latest[0], "Sounds good, see you then.")
    const messages = bodyRows("msg", THREAD)
    assert.equal(messages.length, 2)
    assert.match(messages[1], /From: Smith, John/)
    assert.match(messages[1], /room 42C/)
})

test("renderR1 is unchanged by the cleanBodyR1 refactor", () => {
    const out = renderR1(email("s", "x", "a  b\n> c=20\n\n\n\nd"))
    assert.equal(out, "Subject: s\nSender: x\nRecipients: ['x@enron.com']\n---\na b\nc\n\nd")
})

test("every variant opens and returns R0 paths; the msg index returns each email once", () => {
    const dir = freshDir()
    for (const name of Object.keys(INDEX_VARIANTS)) {
        const index = openVariant(dir, name)
        const hits = index.search("pipeline", 10)
        index.close()
        assert.ok(hits.length > 0, name)
        assert.equal(new Set(hits.map((hit) => hit.path)).size, hits.length, `${name} returned a path twice`)
        for (const hit of hits) assert.ok(DOCS.some((doc) => doc.path === hit.path))
    }
})

test("bm25-r1 finds a word split by a quoted-printable soft break; bm25 does not", () => {
    const dir = freshDir()
    const plain = openVariant(dir, "bm25")
    const r1 = openVariant(dir, "bm25-r1")
    assert.ok(r1.search("pipeline team buying", 10).some((hit) => hit.path === "a/2"))
    assert.ok(!plain.search("pipeline", 10).some((hit) => hit.path === "a/2"))
    plain.close()
    r1.close()
})

test("bm25-latest drops quoted history from the index", () => {
    const dir = freshDir()
    const latest = openVariant(dir, "bm25-latest")
    assert.ok(!latest.search("room 42C", 10).some((hit) => hit.path === "a/1"))
    latest.close()
    const msg = openVariant(dir, "bm25-msg")
    assert.equal(msg.search("room 42C", 10)[0]?.path, "a/1")
    msg.close()
})

test("bm25-fields weights the subject: a subject match outranks a body-only match", () => {
    const dir = freshDir()
    const fields = openVariant(dir, "bm25-fields")
    assert.equal(fields.search("capacity", 10)[0].path, "b/1")
    fields.close()
})

test("collapseByPath keeps the first (best) row of each path", () => {
    assert.deepEqual(collapseByPath([{ path: "a", score: 3 }, { path: "b", score: 2 }, { path: "a", score: 1 }]), [{ path: "a", score: 3 }, { path: "b", score: 2 }])
})

test("chooseNewIndex: highest DEV R@5; ties keep the earlier candidate; bm25 itself is never chosen", () => {
    assert.deepEqual(NEW_INDEX_CANDIDATES, ["bm25-fields", "bm25-r1", "bm25-msg", "bm25-latest"])
    assert.equal(chooseNewIndex({ "bm25": { answerR5: 0.99 }, "bm25-fields": { answerR5: 0.9 }, "bm25-r1": { answerR5: 0.92 }, "bm25-msg": { answerR5: 0.92 } }), "bm25-r1")
    assert.equal(chooseNewIndex({ "bm25-fields": { answerR5: 0.9 }, "bm25-latest": { answerR5: 0.9 } }), "bm25-fields")
    assert.equal(chooseNewIndex({}), null)
})

test("recallSummary counts ranks within k", () => {
    const out = recallSummary([{ answer: 1, strict: 1, relaxed: 1 }, { answer: 6, strict: null, relaxed: 6 }, { answer: null, strict: null, relaxed: null }])
    assert.equal(out.n, 3)
    assert.equal(out.answerR1, 1 / 3)
    assert.equal(out.answerR5, 1 / 3)
    assert.equal(out.answerR10, 2 / 3)
})

test("evaluateIndexes: end to end on a tiny pool, with the main-index reproduction check", async () => {
    const dir = freshDir()
    const record = { questionKey: "q1", path: "a/1", user: "a", question: "When is the pipeline capacity meeting?", rephrased: "What time was the capacity meeting moved to?", gold: "Thursday at 3pm", twins: [], alternates: [] }
    writeFileSync(join(dir, "pools.json"), JSON.stringify({ dev: [record], test: [record], retrieval: [record] }))
    const evidence = new EvidenceCache(new Map(DOCS.map((doc) => [doc.path, doc.email])))
    const out = await evaluateIndexes({ dataDir: dir, evidence, log: () => {} })
    assert.ok(NEW_INDEX_CANDIDATES.includes(out.choice))
    for (const name of Object.keys(INDEX_VARIANTS)) assert.equal(out.results[name]["dev|questions"].n, 1)
    assert.equal(out.results["bm25-msg"]["dev|questions"].answerR5, 1)
    assert.equal(out.reproducedMainBm25, null)
})
