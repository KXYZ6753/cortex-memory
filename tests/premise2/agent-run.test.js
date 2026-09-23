// Unit tests for the pure helpers exported by benchmarks/premise2/agent-run.js:
// preregAgentHash and armOptions. Importing agent-run.js pulls in ollama.js, store.js,
// cells.js, bm25.js, dataset.js, agent.js, run.js and node:sqlite, but none of those
// modules run anything at import time -- runAgent() itself is never called here, so
// this suite touches no Ollama server, no network and no files under .data/.

import assert from "node:assert/strict"
import test from "node:test"
import { preregAgentHash, armOptions } from "../../benchmarks/premise2/agent-run.js"
import { STOP_SEQUENCES } from "../../benchmarks/premise2/agent.js"
import { AGENT_THINK_NUM_PREDICT } from "../../benchmarks/premise2/cells.js"

// ---------------------------------------------------------------------------
// preregAgentHash
// ---------------------------------------------------------------------------

test("preregAgentHash: identical for two texts that differ only below '## Deviation log'", () => {
    const textA = "Some preamble about the agent arm.\n\n## Deviation log\nEntry one: switched the seed.\n"
    const textB = "Some preamble about the agent arm.\n\n## Deviation log\nCompletely different deviation notes, more entries too.\n"
    assert.equal(preregAgentHash(textA), preregAgentHash(textB))
})

test("preregAgentHash: differs when the text above the deviation log changes", () => {
    const textA = "Some preamble about the agent arm.\n\n## Deviation log\nEntry one.\n"
    const textB = "A different preamble entirely.\n\n## Deviation log\nEntry one.\n"
    assert.notEqual(preregAgentHash(textA), preregAgentHash(textB))
})

test("preregAgentHash: handles text with no deviation log heading at all", () => {
    const text = "Just the addendum body, no deviation log section."
    assert.equal(preregAgentHash(text), preregAgentHash(text))
})

// ---------------------------------------------------------------------------
// armOptions
// ---------------------------------------------------------------------------

test("armOptions: a non-thinking arm gets num_predict and the agent STOP_SEQUENCES", () => {
    const { options, think } = armOptions({ think: false }, 160)
    assert.equal(think, false)
    assert.equal(options.num_predict, 160)
    assert.deepEqual(options.stop, STOP_SEQUENCES)
})

test("armOptions: a thinking arm uses AGENT_THINK_NUM_PREDICT and has no stop sequences", () => {
    const { options, think } = armOptions({ think: true }, 160)
    assert.equal(think, true)
    assert.equal(options.num_predict, AGENT_THINK_NUM_PREDICT)
    assert.equal(options.stop, undefined)
})

test("armOptions: optsHash differs between a think and a non-think arm with the same numPredict", () => {
    const nonThink = armOptions({ think: false }, 160)
    const think = armOptions({ think: true }, 160)
    assert.notEqual(nonThink.optsHash, think.optsHash)
})

test("armOptions: optsHash is stable across calls with the same arm and numPredict", () => {
    const a = armOptions({ think: false }, 160)
    const b = armOptions({ think: false }, 160)
    assert.equal(a.optsHash, b.optsHash)
})

// ---------------------------------------------------------------------------
// Index-factor extension: keys and queue
// ---------------------------------------------------------------------------

import { armKey, armQuestion } from "../../benchmarks/premise2/agent-run.js"
import { episodeSha, MAX_ROUNDS, firstMessage } from "../../benchmarks/premise2/agent.js"
import { AGENT_ARMS, agentQueue, agentArmId } from "../../benchmarks/premise2/cells.js"
import { generationKey } from "../../benchmarks/premise2/store.js"

const RECORD = { question: "When did Caroline send the original email?", rephrased: "At what time was the first email from Caroline sent?" }

test("armKey: the original BM25 arms keep the original addendum's keys (episodes carry over)", () => {
    for (const legacy of AGENT_ARMS.filter((arm) => !arm.think)) {
        const { optsHash } = armOptions(legacy, 160)
        const original = generationKey("digest", optsHash, episodeSha(RECORD.question, legacy.variant, legacy.rawFirst))
        const queued = agentQueue("bm25-msg").find((arm) => arm.cell === legacy.cell && arm.alias === legacy.alias && arm.index === "bm25" && arm.field === "questions" && !arm.maxRounds)
        if (!queued) continue
        assert.equal(armKey(queued, RECORD, "digest", armOptions(queued, 160).optsHash), original, `${legacy.cell}|${legacy.alias}`)
    }
})

test("armKey: index, round budget and question field each change the key", () => {
    const base = { cell: "A-agent", alias: "small", index: "bm25", field: "questions" }
    const key = (arm) => armKey(arm, RECORD, "d", armOptions(arm, 160).optsHash)
    const keys = [key(base), key({ ...base, index: "dense" }), key({ ...base, index: "bm25-msg" }), key({ ...base, maxRounds: 2 }), key({ ...base, field: "rephrased" })]
    assert.equal(new Set(keys).size, keys.length)
    assert.equal(key({ ...base, maxRounds: MAX_ROUNDS }), key(base))
})

test("armQuestion / armKey: a rephrased arm skips a question without a rephrasing", () => {
    const arm = { cell: "A-agent", alias: "small", field: "rephrased" }
    assert.equal(armQuestion(arm, RECORD), RECORD.rephrased)
    assert.equal(armKey(arm, { question: "q", rephrased: null }, "d", "o"), null)
})

test("agentQueue: ids are unique per model except the 31b core/extension pair, and must arms come first", () => {
    const queue = agentQueue("bm25-r1")
    const labels = queue.map((arm) => `${arm.id}|${arm.alias}|${arm.maxItems ?? "all"}`)
    assert.equal(new Set(labels).size, labels.length)
    assert.deepEqual(queue.slice(0, 5).map((arm) => `${arm.id}|${arm.alias}`), ["A-agent|small", "A-agent@bm25-r1|small", "A-agent@dense|small", "A-agent@rrf60|small", "A-agent|large"])
    assert.ok(!queue.some((arm) => arm.alias === "large" && (arm.index === "dense" || arm.index === "rrf60")))
    assert.equal(agentArmId({ cell: "A-agent", field: "rephrased", index: "dense" }), "A-agent-reph@dense")
    assert.equal(agentArmId({ cell: "A-agent", maxRounds: 2 }), "A-agent-r2")
})

test("firstMessage: the round budget is stated; the default text is unchanged", () => {
    assert.match(firstMessage("Q", "standard", 2), /You have 2 rounds/)
    assert.equal(firstMessage("Q"), firstMessage("Q", "standard", MAX_ROUNDS))
})
