// End-to-end run of the agent queue (index-factor extension) against a mock Ollama
// server and a synthetic data directory: every arm, every index (BM25 variants,
// dense, RRF), the dense preflight, resume without rerunning, and the status keys.
// SMOKE mode is set before cells.js is imported, as `POC2_SMOKE_MODEL` does.

import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

process.env.POC2_SMOKE_MODEL = "mock:1b"
process.env.POC2_MAX_ITEMS = "3"

const { runAgent, agentDirOf, armKey, armOptions } = await import("../../benchmarks/premise2/agent-run.js")
const { agentQueue } = await import("../../benchmarks/premise2/cells.js")
const { buildBm25Index } = await import("../../benchmarks/premise2/bm25.js")
const { buildAllVariants } = await import("../../benchmarks/premise2/indexes.js")
const { SEPARATOR } = await import("../../benchmarks/premise2/text.js")
const { EMBED_DIM } = await import("../../benchmarks/premise2/dense.js")
const { readJsonl } = await import("../../benchmarks/premise2/store.js")

const email = (subject, sender, body) => `Subject: ${subject}\nSender: ${sender}\nRecipients: ['x@enron.com']\nFile: f\n${SEPARATOR}\n${body}\n${SEPARATOR}`
const DOCS = [
    { path: "a/1", user: "a", email: email("pipeline meeting", "jane@enron.com", "The pipeline capacity meeting moved to Thursday at 3pm.") },
    { path: "a/2", user: "a", email: email("lunch", "bob@enron.com", "Lunch on Friday with the gas desk.") },
    { path: "b/1", user: "b", email: email("capacity report", "carol@enron.com", "Capacity numbers for May are attached.") },
    { path: "b/2", user: "b", email: email("storage", "dave@enron.com", "Storage injections rose in April.") },
]

// A deterministic bag-of-words embedding, shared by the "index" and the mock server.
function embed(text) {
    const vector = new Float32Array(EMBED_DIM)
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 2166136261
        for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
        vector[(hash >>> 0) % EMBED_DIM] += 1
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
    return [...vector].map((value) => value / norm)
}

function mockOllama() {
    const calls = { chat: 0, embed: 0, embedOptions: [] }
    const server = createServer(async (request, response) => {
        let body = ""
        for await (const chunk of request) body += chunk
        const json = body ? JSON.parse(body) : {}
        const send = (value) => {
            response.writeHead(200, { "Content-Type": "application/json" })
            response.end(JSON.stringify(value))
        }
        if (request.url === "/api/version") return send({ version: "0.34.2" })
        if (request.url === "/api/tags") return send({ models: [{ name: "mock:1b", digest: "sha-mock" }, { name: "nomic-embed-text:latest", digest: "sha-nomic" }] })
        if (request.url === "/api/ps") return send({ models: [] })
        if (request.url === "/api/generate") return send({ done: true })
        if (request.url === "/api/embed") {
            calls.embed++
            calls.embedOptions.push(json.options ?? null)
            return send({ embeddings: json.input.map((text) => embed(text)) })
        }
        if (request.url === "/api/chat") {
            calls.chat++
            const last = json.messages.at(-1).content
            let content = "OK"
            if (/No rounds left/.test(last)) content = "ANSWER: Thursday at 3pm"
            else if (/Opened emails/.test(last)) content = "ANSWER: Thursday at 3pm"
            else if (/Search results for/.test(last)) content = "OPEN: 1"
            else if (/Question:/.test(last)) content = "SEARCH: pipeline capacity meeting"
            return send({ message: { role: "assistant", content }, done_reason: "stop", prompt_eval_count: 100, eval_count: 5, load_duration: 1_000_000 })
        }
        response.writeHead(404)
        response.end("not found")
    })
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })))
}

function dataDirWithEverything() {
    const dir = mkdtempSync(join(tmpdir(), "premise2-agent-e2e-"))
    buildBm25Index(DOCS, join(dir, "corpus.sqlite"))
    buildAllVariants(DOCS, dir)
    const vectors = new Float32Array(DOCS.length * EMBED_DIM)
    DOCS.forEach((doc, row) => vectors.set(embed(`search_document: ${doc.email}`), row * EMBED_DIM))
    writeFileSync(join(dir, "dense.f32"), Buffer.from(vectors.buffer))
    writeFileSync(join(dir, "dense-docs.json"), JSON.stringify({ paths: DOCS.map((doc) => doc.path), users: DOCS.map((doc) => doc.user) }))

    const items = JSON.parse(readFileSync(new URL("../../benchmarks/premise2/agent-items.json", import.meta.url), "utf8")).items.slice(0, 3)
    const record = (questionKey, question, rephrased) => ({ questionKey, path: "a/1", user: "a", question, rephrased, gold: "Thursday at 3pm", alternates: [], twins: [] })
    const test = items.map((item, index) => record(item.questionKey, `When was the pipeline capacity meeting? (${index})`, index === 2 ? null : `What day is the capacity meeting on? (${index})`))
    const dev = [record("dev#1", "When is the pipeline meeting?", null), record("dev#2", "What are the May capacity numbers?", null)]
    writeFileSync(join(dir, "pools.json"), JSON.stringify({ dev, test, retrieval: [] }))
    writeFileSync(join(dir, "run-state.json"), JSON.stringify({ probe: { numPredict: 160 }, provenance: {} }))
    // The frozen dense lists the preflight compares against: the same embedding.
    const frozen = dev.map((entry) => {
        const query = embed(`search_query: ${entry.question}`)
        const ranked = DOCS.map((doc, row) => ({ path: doc.path, score: [...vectors.subarray(row * EMBED_DIM, (row + 1) * EMBED_DIM)].reduce((sum, value, d) => sum + value * query[d], 0) }))
            .sort((a, b) => b.score - a.score).map((hit) => hit.path)
        return JSON.stringify({ questionKey: entry.questionKey, lists: { "dense|global|questions": ranked } })
    })
    writeFileSync(join(dir, "retrieval.jsonl"), frozen.join("\n") + "\n")

    const agentDir = join(dir, "agent")
    mkdirSync(agentDir, { recursive: true })
    const db = new DatabaseSync(join(agentDir, "emails.sqlite"))
    db.exec("CREATE TABLE emails (path TEXT PRIMARY KEY, email TEXT NOT NULL)")
    const insert = db.prepare("INSERT INTO emails VALUES (?, ?)")
    for (const doc of DOCS) insert.run(doc.path, doc.email)
    db.close()
    return { dir, items, test }
}

test("agent run: the whole extension queue completes on every index, resumes without rerunning, and keys match the status command", { timeout: 120_000 }, async () => {
    const { server, calls, url } = await mockOllama()
    const { dir, items, test: testRecords } = dataDirWithEverything()
    delete process.env.POC2_AGENT_DIR
    const quiet = () => {}
    try {
        const stopAt = new Date(Date.now() + 3_600_000).toISOString()
        const first = await runAgent({ dataDir: dir, stopAt, ollamaUrl: url, log: quiet })
        assert.equal(first.reason, "complete")

        const answers = readJsonl(join(agentDirOf(dir), "answers.jsonl")).records.filter((record) => record.type === "answer")
        const queue = agentQueue("bm25-msg")
        const state = JSON.parse(readFileSync(join(agentDirOf(dir), "state.json"), "utf8"))
        assert.ok(state.extFingerprint)
        assert.equal(state.provenance.newIndex, "bm25-msg")
        assert.equal(state.denseCheck.meanTop10Overlap, 1)

        // Every arm has its episodes under the expected key; the rephrased arms skip the
        // question without a rephrasing; the 31b core/extension pair shares keys.
        const byKey = new Map(answers.map((record) => [record.key, record]))
        const expected = new Set()
        for (const arm of queue) {
            for (const item of items) {
                const record = testRecords.find((entry) => entry.questionKey === item.questionKey)
                const key = armKey(arm, record, `${state.provenance.digests[arm.alias]}`, armOptions(arm, 160).optsHash)
                if (arm.field === "rephrased" && !record.rephrased) {
                    assert.equal(key, null)
                    continue
                }
                expected.add(key)
                const answer = byKey.get(key)
                assert.ok(answer, `missing episode for ${arm.id}|${arm.alias}`)
                assert.equal(answer.index, arm.index)
                assert.equal(answer.answer, "Thursday at 3pm")
                assert.ok(answer.openedPaths.length === 1)
            }
        }
        assert.equal(new Set(answers.map((record) => record.key)).size, expected.size)
        const r2 = answers.find((record) => record.cellId === "A-agent-r2")
        assert.match(r2.transcript[0].content, /You have 2 rounds/)
        // Dense queries were embedded on the CPU.
        assert.ok(calls.embed > 0)
        assert.ok(calls.embedOptions.every((options) => options?.num_gpu === 0))

        // Resume: nothing is rerun.
        const chatsBefore = calls.chat
        const second = await runAgent({ dataDir: dir, stopAt, ollamaUrl: url, log: quiet })
        assert.equal(second.reason, "complete")
        const after = readJsonl(join(agentDirOf(dir), "answers.jsonl")).records.filter((record) => record.type === "answer")
        assert.equal(after.length, answers.length)
        assert.ok(calls.chat - chatsBefore < 10, "a resume must not rerun episodes")
    } finally {
        server.close()
    }
})
