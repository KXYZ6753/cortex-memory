import assert from "node:assert/strict";
import { buildPrompt, processText } from "../src/process/ollama.js";
import { embed } from "../src/process/embed.js";

const validValue = { summary: "Short summary.", importance: 3, tags: ["test"], events: [] };
const chatResponse = (content, status = 200) => new Response(
    status === 200 ? JSON.stringify({ message: { content }, done_reason: "stop" }) : content,
    { status, headers: { "Content-Type": "application/json" } },
);

const prompt = buildPrompt(
    "Dentist next Tuesday, call tomorrow, and interview Friday, August 14, 2026.",
    new Date("2026-07-22T12:00:00Z"),
);
assert.match(prompt, /next Tuesday \[date: 2026-07-28]/);
assert.match(prompt, /tomorrow \[date: 2026-07-23]/);
assert.match(prompt, /Friday, August 14, 2026 \[date: 2026-08-14]/);
assert.doesNotMatch(prompt, /Friday \[date: 2026-07-24]/);

async function testProcessTextRetries() {
    let calls = 0;
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
        calls++;
        bodies.push(JSON.parse(init.body));
        return chatResponse(calls === 1 ? '{"summary":"truncated' : JSON.stringify(validValue));
    };
    assert.deepEqual(await processText("tomorrow", {
        referenceDate: "2026-06-01T15:00:00Z",
        maxAttempts: 3,
        retryDelayMs: 0,
    }), validValue);
    assert.equal(calls, 2);
    assert.match(bodies[0].messages[0].content, /Today: 2026-06-01/);
    assert.match(bodies[0].messages[0].content, /tomorrow \[date: 2026-06-02]/);
    assert.equal(bodies[0].options.num_predict, 512);
    assert.equal(bodies[1].options.num_predict, 1024);
    assert.match(bodies[1].messages[0].content, /previous response was invalid/i);

    calls = 0;
    globalThis.fetch = async () => ++calls === 1
        ? chatResponse("busy", 503)
        : chatResponse(JSON.stringify(validValue));
    await processText("hello", { maxAttempts: 3, retryDelayMs: 0 });
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return chatResponse("bad request", 400);
    };
    await assert.rejects(processText("hello", { maxAttempts: 3, retryDelayMs: 0 }), /failed after 1 attempt/);
    assert.equal(calls, 1);

    calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return chatResponse(JSON.stringify({ summary: "missing fields" }));
    };
    await assert.rejects(processText("hello", { maxAttempts: 3, retryDelayMs: 0 }), /failed after 3 attempts/);
    assert.equal(calls, 3);

    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    calls = 0;
    globalThis.fetch = async (_url, init) => {
        calls++;
        throw init.signal.reason;
    };
    await assert.rejects(processText("hello", { signal: controller.signal }), /cancelled/);
    assert.equal(calls, 1);

    await assert.rejects(processText("hello", { referenceDate: "not-a-date" }), /reference date is invalid/);
}

async function testEmbeddingRetries() {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(url, "http://localhost:11434/api/embed");
        assert.equal(JSON.parse(init.body).truncate, true);
        return calls === 1
            ? new Response("busy", { status: 503 })
            : new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 });
    };
    assert.deepEqual(await embed("hello", { maxAttempts: 3, retryDelayMs: 0 }), [0.1, 0.2]);
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => ++calls === 1
        ? new Response("{", { status: 200 })
        : new Response(JSON.stringify({ embeddings: [[0.1]] }), { status: 200 });
    await embed("hello", { maxAttempts: 3, retryDelayMs: 0 });
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return new Response("bad request", { status: 400 });
    };
    await assert.rejects(embed("hello", { maxAttempts: 3, retryDelayMs: 0 }), /failed after 1 attempt/);
    assert.equal(calls, 1);
}

async function testDebugOutput() {
    const output = [];
    const originalLog = console.log;
    const originalDebug = process.env.OLLAMA_DEBUG;
    process.env.OLLAMA_DEBUG = "true";
    console.log = (...values) => output.push(values.join(" "));
    globalThis.fetch = async () => chatResponse(JSON.stringify(validValue));
    try {
        await processText("Meeting tomorrow", {
            referenceDate: "2026-06-01T15:00:00Z",
            maxAttempts: 1,
        });
    } finally {
        console.log = originalLog;
        if (originalDebug === undefined) delete process.env.OLLAMA_DEBUG;
        else process.env.OLLAMA_DEBUG = originalDebug;
    }
    const trace = output.join("\n");
    assert.match(trace, /OLLAMA INPUT \| qwen3\.5:2b \| ATTEMPT 1/);
    assert.match(trace, /Meeting tomorrow \[date: 2026-06-02]/);
    assert.match(trace, /OLLAMA JSON OUTPUT \| qwen3\.5:2b \| ATTEMPT 1/);
    assert.match(trace, /\n  "summary": "Short summary\."/);
}

await testProcessTextRetries();
await testEmbeddingRetries();
await testDebugOutput();
console.log("Ollama retry checks passed");
