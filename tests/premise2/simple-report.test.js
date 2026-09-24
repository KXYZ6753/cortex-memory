import test from "node:test"
import assert from "node:assert/strict"
import { coreWeightedMean, pairedEstimate } from "../../benchmarks/premise2/simple-report.js"

test("enriched core arm rates and paired difference use the selected-600 weights", () => {
    const rows = [
        ...Array.from({ length: 51 }, (_, index) => ({ user: `miss${index}`, stratum: "miss", a: 1, b: 0 })),
        ...Array.from({ length: 149 }, (_, index) => ({ user: `hit${index}`, stratum: "hit", a: 0, b: 0 })),
    ]
    const shares = { miss: 51 / 600, hit: 549 / 600 }
    assert.ok(Math.abs(coreWeightedMean(rows, "a", shares) - 0.085) < 1e-12)
    assert.ok(Math.abs(coreWeightedMean(rows, "b", shares)) < 1e-12)
    assert.equal(pairedEstimate(rows, { weightedCore: true, shares, B: 100 }).estimate, 0.085)
})
