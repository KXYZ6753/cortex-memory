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
