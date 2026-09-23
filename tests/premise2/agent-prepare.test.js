// Unit tests for benchmarks/premise2/agent-prepare.js: the agent arm's question
// order (orderAgentItems) and its design-weight helper (stratumWeights).
//
// agentPrepare() itself reads cells.json/retrieval.jsonl from a dataDir and writes
// agent-items.json, so it is I/O-bound and not exercised here; orderAgentItems and
// stratumWeights are pure and cover its interesting logic.

import assert from "node:assert/strict"
import test from "node:test"
import { orderAgentItems, stratumWeights } from "../../benchmarks/premise2/agent-prepare.js"

const makeItems = (missCount, hitCount) => [
    ...Array.from({ length: missCount }, (_, i) => ({ questionKey: `miss-${i}`, stratum: "miss" })),
    ...Array.from({ length: hitCount }, (_, i) => ({ questionKey: `hit-${i}`, stratum: "hit" })),
]

// ---------------------------------------------------------------------------
// orderAgentItems
// ---------------------------------------------------------------------------

test("orderAgentItems: with 51 misses and 549 hits (core 200), every miss lands inside the first 200 slots", () => {
    const items = makeItems(51, 549)
    const ordered = orderAgentItems(items, { core: 200, seed: 12345 })
    const missIndices = ordered.map((item, index) => (item.stratum === "miss" ? index : -1)).filter((i) => i >= 0)
    assert.equal(missIndices.length, 51)
    assert.ok(missIndices.every((i) => i < 200), `expected every miss before index 200, max was ${Math.max(...missIndices)}`)
})

test("orderAgentItems: consecutive misses in the core are spread evenly (gap <= ceil(200/51)+1)", () => {
    const items = makeItems(51, 549)
    const ordered = orderAgentItems(items, { core: 200, seed: 12345 })
    const missIndices = ordered.map((item, index) => (item.stratum === "miss" ? index : -1)).filter((i) => i >= 0)
    const maxAllowedGap = Math.ceil(200 / 51) + 1
    let maxGap = 0
    for (let i = 1; i < missIndices.length; i++) maxGap = Math.max(maxGap, missIndices[i] - missIndices[i - 1])
    assert.ok(maxGap <= maxAllowedGap, `expected max gap <= ${maxAllowedGap}, got ${maxGap}`)
})

test("orderAgentItems: every item appears exactly once, with order equal to its index", () => {
    const items = makeItems(51, 549)
    const ordered = orderAgentItems(items, { core: 200, seed: 12345 })
    assert.equal(ordered.length, items.length)
    assert.deepEqual(new Set(ordered.map((item) => item.questionKey)), new Set(items.map((item) => item.questionKey)))
    assert.ok(ordered.every((item, index) => item.order === index))
})

test("orderAgentItems: the same seed reproduces the same order; a different seed reorders the hits", () => {
    const items = makeItems(51, 549)
    const orderedA = orderAgentItems(items, { core: 200, seed: 111 })
    const orderedAAgain = orderAgentItems(items, { core: 200, seed: 111 })
    const orderedB = orderAgentItems(items, { core: 200, seed: 222 })

    assert.deepEqual(orderedA.map((item) => item.questionKey), orderedAAgain.map((item) => item.questionKey))

    const hitsA = orderedA.filter((item) => item.stratum === "hit").map((item) => item.questionKey)
    const hitsB = orderedB.filter((item) => item.stratum === "hit").map((item) => item.questionKey)
    assert.notDeepEqual(hitsA, hitsB, "a different seed should reorder the hits")
})

// Regression: short input used to be padded out to `core` with undefined entries.
test("orderAgentItems: with fewer items than the core, it returns every item exactly once", () => {
    const items = makeItems(2, 3) // 5 items total, well under the default core of 200
    const ordered = orderAgentItems(items, { core: 200, seed: 1 })
    assert.equal(ordered.length, items.length, "expected the 5 input items back, not a 200-slot array")
    assert.ok(ordered.every((item) => typeof item.questionKey === "string"), "expected no undefined placeholder items")
    assert.deepEqual(new Set(ordered.map((item) => item.questionKey)), new Set(items.map((item) => item.questionKey)))
})

// ---------------------------------------------------------------------------
// stratumWeights
// ---------------------------------------------------------------------------

test("stratumWeights: every weight is 1 when the rows' stratum proportions already equal trueShares", () => {
    const trueShares = { miss: 51 / 600, hit: 549 / 600 }
    const rows = makeItems(51, 549) // same proportions as the true population
    const weights = stratumWeights(rows, (row) => row.stratum, trueShares)
    assert.ok(weights.every((w) => Math.abs(w - 1) < 1e-12), `expected every weight ~1, got a range including ${Math.min(...weights)}..${Math.max(...weights)}`)
})

test("stratumWeights: on an enriched prefix (51 miss + 149 hit), weights match true-share / observed-share", () => {
    const trueShares = { miss: 51 / 600, hit: 549 / 600 }
    const rows = makeItems(51, 149) // 200 rows: misses over-represented relative to the true 51/600
    const weights = stratumWeights(rows, (row) => row.stratum, trueShares)

    const expectedMissWeight = (51 / 600) / (51 / 200)
    const expectedHitWeight = (549 / 600) / (149 / 200)
    rows.forEach((row, i) => {
        const expected = row.stratum === "miss" ? expectedMissWeight : expectedHitWeight
        assert.ok(Math.abs(weights[i] - expected) < 1e-12, `row ${i} (${row.stratum}): expected weight ${expected}, got ${weights[i]}`)
    })
})

test("stratumWeights: the weighted mean of a stratum indicator equals the true share", () => {
    const trueShares = { miss: 51 / 600, hit: 549 / 600 }
    const rows = makeItems(51, 149)
    const weights = stratumWeights(rows, (row) => row.stratum, trueShares)
    const indicator = rows.map((row) => (row.stratum === "miss" ? 1 : 0))
    const weightedMean = indicator.reduce((sum, value, i) => sum + value * weights[i], 0) / rows.length
    assert.ok(Math.abs(weightedMean - trueShares.miss) < 1e-9, `expected weighted mean ${trueShares.miss}, got ${weightedMean}`)
})
