import assert from "node:assert/strict"
import test from "node:test"
import { appendFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    AnswerStore,
    appendJsonl,
    generationKey,
    MAX_FAILED_ATTEMPTS,
    optionsHash,
    readJsonl,
    runFingerprint,
    writeJsonAtomic,
} from "../../benchmarks/premise2/store.js"

const tempDir = () => mkdtempSync(join(tmpdir(), "premise2-store-test-"))

// ---------------------------------------------------------------------------
// appendJsonl + readJsonl round-trip
// ---------------------------------------------------------------------------

test("appendJsonl + readJsonl: round-trips records in order", () => {
    const path = join(tempDir(), "answers.jsonl")
    appendJsonl(path, { type: "answer", key: "k1", status: "ok", answer: "hi" })
    appendJsonl(path, { type: "answer", key: "k2", status: "ok", answer: "there" })
    const { records, dropped } = readJsonl(path)
    assert.equal(dropped, 0)
    assert.deepEqual(records, [
        { type: "answer", key: "k1", status: "ok", answer: "hi" },
        { type: "answer", key: "k2", status: "ok", answer: "there" },
    ])
})

test("readJsonl on a missing file returns an empty result", () => {
    const { records, dropped } = readJsonl(join(tempDir(), "does-not-exist.jsonl"))
    assert.deepEqual(records, [])
    assert.equal(dropped, 0)
})

test("readJsonl without repair: drops and reports a torn line but leaves the file untouched", () => {
    const path = join(tempDir(), "answers.jsonl")
    appendJsonl(path, { type: "answer", key: "k1", status: "ok", answer: "hi" })
    appendJsonl(path, { type: "answer", key: "k2", status: "ok", answer: "there" })
    // Simulate a crash mid-write: a partial JSON line with no closing brace or newline.
    appendFileSync(path, '{"type":"answer","key":"k3","status":"ok"')

    const first = readJsonl(path)
    assert.equal(first.dropped, 1)
    assert.equal(first.records.length, 2)
    assert.deepEqual(first.records.map((r) => r.key), ["k1", "k2"])

    // Without repair (the default, and what a reader like `status` passes), the file
    // is left exactly as it was -- torn line and all -- because a concurrent writer
    // may still be appending to it.
    const untouched = readFileSync(path, "utf8")
    assert.ok(untouched.includes("k3"))

    // So every subsequent read re-discovers and re-reports the same torn line.
    const second = readJsonl(path)
    assert.equal(second.dropped, 1)
    assert.equal(second.records.length, 2)
})

test("readJsonl with { repair: true } drops the torn line, reports it, and rewrites the file clean", () => {
    const path = join(tempDir(), "answers.jsonl")
    appendJsonl(path, { type: "answer", key: "k1", status: "ok", answer: "hi" })
    appendJsonl(path, { type: "answer", key: "k2", status: "ok", answer: "there" })
    appendFileSync(path, '{"type":"answer","key":"k3","status":"ok"')

    const first = readJsonl(path, { repair: true })
    assert.equal(first.dropped, 1)
    assert.equal(first.records.length, 2)
    assert.deepEqual(first.records.map((r) => r.key), ["k1", "k2"])

    // The file itself is rewritten without the torn line, so the crash is not
    // rediscovered (and re-reported) on every subsequent read.
    const rewritten = readFileSync(path, "utf8")
    assert.ok(!rewritten.includes("k3"))
    const second = readJsonl(path, { repair: true })
    assert.equal(second.dropped, 0)
    assert.equal(second.records.length, 2)
})

// ---------------------------------------------------------------------------
// AnswerStore
// ---------------------------------------------------------------------------

test("AnswerStore: an 'ok' answer is immediately done and retrievable", () => {
    const store = new AnswerStore(join(tempDir(), "store.jsonl"))
    assert.equal(store.has("k1"), false)
    assert.equal(store.get("k1"), null)
    store.add({ key: "k1", status: "ok", answer: "foo" })
    assert.equal(store.has("k1"), true)
    assert.deepEqual(store.get("k1"), { key: "k1", status: "ok", answer: "foo" })
})

test("AnswerStore: 'output_limit' and 'empty' also count as done, like 'ok'", () => {
    const store = new AnswerStore(join(tempDir(), "store.jsonl"))
    store.add({ key: "k1", status: "output_limit", answer: "truncated" })
    store.add({ key: "k2", status: "empty", answer: "" })
    assert.equal(store.has("k1"), true)
    assert.equal(store.has("k2"), true)
})

test("AnswerStore: a failing answer (http_error/timeout) is not done until MAX_FAILED_ATTEMPTS is reached", () => {
    const store = new AnswerStore(join(tempDir(), "store.jsonl"))
    assert.equal(MAX_FAILED_ATTEMPTS, 3)
    store.add({ key: "k2", status: "timeout" })
    assert.equal(store.has("k2"), false, "1st failure: should still be retried")
    store.add({ key: "k2", status: "http_error" })
    assert.equal(store.has("k2"), false, "2nd failure: should still be retried")
    store.add({ key: "k2", status: "timeout" })
    // After MAX_FAILED_ATTEMPTS failures it counts as done (no more retries)...
    assert.equal(store.has("k2"), true, "3rd failure: should now count as done")
    // ...but it never produced an answer, so get() still returns null.
    assert.equal(store.get("k2"), null)
})

test("AnswerStore: the constructor repairs a torn file on disk (it passes repair: true)", () => {
    const path = join(tempDir(), "store.jsonl")
    appendJsonl(path, { type: "answer", key: "k1", status: "ok", answer: "foo" })
    // Simulate a crash mid-write, same as the readJsonl torn-line tests above.
    appendFileSync(path, '{"type":"answer","key":"k2","status":"ok"')

    const store = new AnswerStore(path)
    assert.equal(store.recovered, 1)
    assert.equal(store.has("k1"), true)
    assert.deepEqual(store.get("k1"), { type: "answer", key: "k1", status: "ok", answer: "foo" })

    // Unlike a plain readJsonl() call, the store's constructor rewrites the file
    // clean, because it is the file's writer, not just a reader like `status`.
    const rewritten = readFileSync(path, "utf8")
    assert.ok(!rewritten.includes("k2"))
})

test("AnswerStore: state (done and exhausted-failure keys) survives a reload from disk", () => {
    const path = join(tempDir(), "store.jsonl")
    const store = new AnswerStore(path)
    store.add({ key: "k1", status: "ok", answer: "foo" })
    store.add({ key: "k2", status: "timeout" })
    store.add({ key: "k2", status: "timeout" })
    store.add({ key: "k2", status: "timeout" })

    const reloaded = new AnswerStore(path)
    assert.equal(reloaded.has("k1"), true)
    // Records read back off disk carry the "type" field appendJsonl added on write,
    // unlike the record passed directly to add() before a reload.
    assert.deepEqual(reloaded.get("k1"), { type: "answer", key: "k1", status: "ok", answer: "foo" })
    assert.equal(reloaded.has("k2"), true)
    assert.equal(reloaded.get("k2"), null)
})

// ---------------------------------------------------------------------------
// generationKey / optionsHash
// ---------------------------------------------------------------------------

test("optionsHash is independent of key order", () => {
    assert.equal(optionsHash({ temperature: 0, top_p: 1 }), optionsHash({ top_p: 1, temperature: 0 }))
})

test("generationKey changes when the model digest, options hash, or prompt sha changes", () => {
    const opts = optionsHash({ temperature: 0, top_p: 1 })
    const base = generationKey("digestA", opts, "shaX")
    assert.notEqual(base, generationKey("digestB", opts, "shaX"), "should change with model digest")
    assert.notEqual(base, generationKey("digestA", optionsHash({ temperature: 0, top_p: 2 }), "shaX"), "should change with options hash")
    assert.notEqual(base, generationKey("digestA", opts, "shaY"), "should change with prompt sha")
    assert.equal(base, generationKey("digestA", opts, "shaX"), "should be stable for identical inputs")
})

// ---------------------------------------------------------------------------
// runFingerprint
// ---------------------------------------------------------------------------

function baseManifest() {
    return { hashes: { questionSet: "qs1", templates: "t1", representation: "r1" }, retrieval: { rStar: "bm25" } }
}

test("runFingerprint is stable for identical inputs", () => {
    const args = { prepareManifest: baseManifest(), modelDigests: { small: "d1" }, options: {}, ollamaVersion: "0.1", preregHash: "p1" }
    assert.equal(runFingerprint(args), runFingerprint({ ...args, prepareManifest: baseManifest() }))
})

test("runFingerprint does not depend on the git commit: it has no commit parameter at all", () => {
    // runFingerprint only reads prepareManifest/modelDigests/options/ollamaVersion/preregHash;
    // per the module's own comment, the git commit is deliberately recorded per answer
    // instead, precisely so a code fix that leaves every hash unchanged can resume a run.
    const args = { prepareManifest: baseManifest(), modelDigests: { small: "d1" }, options: {}, ollamaVersion: "0.1", preregHash: "p1" }
    const withoutCommit = runFingerprint(args)
    const withUnrelatedCommitField = runFingerprint({ ...args, gitCommit: "deadbeef" })
    assert.equal(withoutCommit, withUnrelatedCommitField)
})

test("runFingerprint changes when a model digest changes", () => {
    const args = { prepareManifest: baseManifest(), modelDigests: { small: "d1" }, options: {}, ollamaVersion: "0.1", preregHash: "p1" }
    const changed = { ...args, modelDigests: { small: "d2" } }
    assert.notEqual(runFingerprint(args), runFingerprint(changed))
})

test("runFingerprint changes when the question set hash, options or ollama version changes", () => {
    const args = { prepareManifest: baseManifest(), modelDigests: { small: "d1" }, options: {}, ollamaVersion: "0.1", preregHash: "p1" }
    const base = runFingerprint(args)
    assert.notEqual(base, runFingerprint({ ...args, prepareManifest: { ...baseManifest(), hashes: { ...baseManifest().hashes, questionSet: "qs2" } } }))
    assert.notEqual(base, runFingerprint({ ...args, options: { numCtx: 8192 } }))
    assert.notEqual(base, runFingerprint({ ...args, ollamaVersion: "0.2" }))
})

// ---------------------------------------------------------------------------
// writeJsonAtomic
// ---------------------------------------------------------------------------

test("writeJsonAtomic writes pretty-printed JSON with a trailing newline and leaves no .tmp file behind", () => {
    const dir = tempDir()
    const path = join(dir, "state.json")
    const value = { a: 1, b: [1, 2, 3], nested: { c: "d" } }

    writeJsonAtomic(path, value)

    const raw = readFileSync(path, "utf8")
    assert.equal(raw, JSON.stringify(value, null, 2) + "\n")
    assert.ok(raw.endsWith("\n"))
    assert.deepEqual(JSON.parse(raw), value)

    const leftoverTemp = readdirSync(dir).filter((name) => name.includes(".tmp"))
    assert.deepEqual(leftoverTemp, [], `expected no leftover .tmp file, found: ${leftoverTemp.join(", ")}`)
})

test("writeJsonAtomic overwrites an existing file in place (same final path, old content gone)", () => {
    const dir = tempDir()
    const path = join(dir, "state.json")
    writeJsonAtomic(path, { version: 1 })
    writeJsonAtomic(path, { version: 2 })

    const raw = readFileSync(path, "utf8")
    assert.deepEqual(JSON.parse(raw), { version: 2 })
    const leftoverTemp = readdirSync(dir).filter((name) => name.includes(".tmp"))
    assert.deepEqual(leftoverTemp, [])
})
