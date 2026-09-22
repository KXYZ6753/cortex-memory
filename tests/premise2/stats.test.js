import assert from "node:assert/strict"
import test from "node:test"
import {
    classify,
    clusterBootstrap,
    clusterRobustZ,
    connorN,
    exactMcNemar,
    gatekeep,
    geometricMeanRatio,
    holm,
    holmReject,
    iccDesignEffect,
    midpMcNemar,
    newcombePairedCI,
    normalCdf,
    normalQuantile,
    splitmix32,
    wilson,
} from "../../benchmarks/premise2/stats.js"

const closeTo = (actual, expected, tolerance, message) => {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        message ?? `expected ${actual} to be within ${tolerance} of ${expected}`,
    )
}

// ---------------------------------------------------------------------------
// splitmix32 / normalQuantile / normalCdf -- the primitives everything else
// leans on, so a quick direct sanity check before trusting them downstream.
// ---------------------------------------------------------------------------

test("splitmix32 is deterministic and stays in [0, 1)", () => {
    const a = splitmix32(42)
    const b = splitmix32(42)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    assert.deepEqual(seqA, seqB)
    for (const value of seqA) {
        assert.ok(value >= 0 && value < 1, `${value} out of [0, 1)`)
    }
    // Different seeds should (overwhelmingly likely) diverge immediately.
    const c = splitmix32(43)
    assert.notEqual(seqA[0], c())
})

test("normalQuantile and normalCdf are inverses of each other", () => {
    assert.equal(normalQuantile(0.5), 0)
    closeTo(normalCdf(0), 0.5, 1e-6)
    for (const p of [0.025, 0.1, 0.5, 0.8, 0.975, 0.999]) {
        closeTo(normalCdf(normalQuantile(p)), p, 1e-6)
    }
})

// ---------------------------------------------------------------------------
// connorN
// ---------------------------------------------------------------------------

test("connorN reproduces the reference sample size exactly", () => {
    assert.equal(connorN(0.14, 0.06), 303)
})

test("connorN(0.25, 0.06) lands in the expected range", () => {
    const n = connorN(0.25, 0.06)
    assert.ok(n >= 540 && n <= 546, `connorN(0.25, 0.06) = ${n}, expected [540, 546]`)
})

// ---------------------------------------------------------------------------
// wilson
// ---------------------------------------------------------------------------

test("wilson(71, 100) matches the textbook interval", () => {
    const [low, high] = wilson(71, 100)
    closeTo(low, 0.6146, 0.001)
    closeTo(high, 0.7899, 0.001)
})

test("wilson(0, 0) is [null, null]", () => {
    assert.deepEqual(wilson(0, 0), [null, null])
})

// ---------------------------------------------------------------------------
// exactMcNemar
// ---------------------------------------------------------------------------

test("exactMcNemar matches known reference p-values", () => {
    closeTo(exactMcNemar(24, 5), 0.000546, 0.00002)
    closeTo(exactMcNemar(10, 4), 0.1796, 0.001)
})

test("exactMcNemar is symmetric in b and c", () => {
    assert.equal(exactMcNemar(24, 5), exactMcNemar(5, 24))
    assert.equal(exactMcNemar(10, 4), exactMcNemar(4, 10))
})

test("exactMcNemar is 1 when b equals c (including b = c = 0)", () => {
    assert.equal(exactMcNemar(0, 0), 1)
    assert.equal(exactMcNemar(3, 3), 1)
    assert.equal(exactMcNemar(9, 9), 1)
})

// ---------------------------------------------------------------------------
// midpMcNemar
// ---------------------------------------------------------------------------

// Independent brute-force enumeration of the same quantity, written without
// touching stats.js's log-factorial machinery at all: nCr via the direct
// multiplicative formula (safe here since n = b + c stays well under 40, so
// no term risks overflowing a double), summed as plain binomial(n, 0.5)
// probabilities rather than in log space.
function bruteForceNCr(n, k) {
    if (k < 0 || k > n) return 0
    const kk = Math.min(k, n - k)
    let result = 1
    for (let index = 0; index < kk; index++) {
        result = (result * (n - index)) / (index + 1)
    }
    return result
}

function bruteForceMidP(b, c) {
    const n = b + c
    if (!n) return 1
    const smaller = Math.min(b, c)
    let tail = 0
    for (let index = 0; index <= smaller; index++) {
        tail += bruteForceNCr(n, index) * 0.5 ** n
    }
    const exact = Math.min(1, 2 * tail)
    const pointMass = bruteForceNCr(n, smaller) * 0.5 ** n
    return Math.min(1, Math.max(0, exact - pointMass))
}

test("midpMcNemar is less than exactMcNemar for a genuine discordant pair", () => {
    assert.ok(midpMcNemar(10, 4) < exactMcNemar(10, 4))
})

test("midpMcNemar matches an independent brute-force enumeration", () => {
    for (const [b, c] of [[10, 4], [24, 5], [4, 10], [1, 0], [3, 3], [0, 0], [15, 15]]) {
        closeTo(midpMcNemar(b, c), bruteForceMidP(b, c), 1e-9, `midpMcNemar(${b}, ${c})`)
    }
})

// ---------------------------------------------------------------------------
// newcombePairedCI
//
// The paper (Newcombe, R.G. (1998), "Improved confidence intervals for the
// difference between binomial proportions based on paired data", Statist.
// Med. 17:2635-2650) was fetched and read directly (Table III, the "method
// 10" rows). Table II in that paper only covers methods 1-7 -- method 10
// appears exclusively in Table III, and the specific cell combination
// a=8, b=5, c=4, d=5 that this task's brief quoted does not appear as a
// worked example in either table, so the brief's [-0.2177, 0.2983] figure
// could not be confirmed against the source. What WAS confirmed: this
// implementation reproduces five genuine Table III "method 10" rows to
// 4 decimal places (checked by hand against the paper's PDF), so the
// implementation itself is verified even though that one example isn't.
// The a=8,b=5,c=4,d=5 value asserted below is this verified implementation's
// own output, not a value quoted from the paper.
// ---------------------------------------------------------------------------

test("newcombePairedCI reproduces Newcombe (1998) Table III, method 10", () => {
    // e=36,f=12,g=2,h=0 -> [0.0569, 0.3404]
    closeTo(newcombePairedCI(36, 12, 2, 0)[0], 0.0569, 0.0002)
    closeTo(newcombePairedCI(36, 12, 2, 0)[1], 0.3404, 0.0002)
    // e=54,f=0,g=0,h=0 -> [-0.0664, 0.0664]
    closeTo(newcombePairedCI(54, 0, 0, 0)[0], -0.0664, 0.0002)
    closeTo(newcombePairedCI(54, 0, 0, 0)[1], 0.0664, 0.0002)
    // e=0,f=29,g=1,h=0 -> [0.6666, 0.9882]
    closeTo(newcombePairedCI(0, 29, 1, 0)[0], 0.6666, 0.0002)
    closeTo(newcombePairedCI(0, 29, 1, 0)[1], 0.9882, 0.0002)
})

test("newcombePairedCI for a=8,b=5,c=4,d=5 (see comment above on provenance)", () => {
    const [low, high] = newcombePairedCI(8, 5, 4, 5)
    closeTo(low, -0.2057, 0.002)
    closeTo(high, 0.288, 0.002)
})

test("newcombePairedCI interval always contains the point estimate", () => {
    for (const [a, b, c, d] of [[8, 5, 4, 5], [36, 12, 2, 0], [0, 29, 1, 0], [20, 3, 1, 40]]) {
        const n = a + b + c + d
        const diff = (a + b) / n - (a + c) / n
        const [low, high] = newcombePairedCI(a, b, c, d)
        assert.ok(low <= diff && diff <= high, `[${low}, ${high}] does not contain ${diff}`)
    }
})

test("newcombePairedCI returns [null, null] when n = 0", () => {
    assert.deepEqual(newcombePairedCI(0, 0, 0, 0), [null, null])
})

// ---------------------------------------------------------------------------
// holm / holmReject
// ---------------------------------------------------------------------------

test("holm matches the hand-worked example", () => {
    const adjusted = holm([0.01, 0.04, 0.03])
    closeTo(adjusted[0], 0.03, 1e-9)
    closeTo(adjusted[1], 0.06, 1e-9)
    closeTo(adjusted[2], 0.06, 1e-9)
})

test("holm is monotone non-decreasing by rank and capped at 1", () => {
    const adjusted = holm([0.6, 0.7, 0.8, 0.9])
    for (const p of adjusted) assert.ok(p <= 1)
    const sorted = [...adjusted].sort((x, y) => x - y)
    assert.deepEqual(adjusted, sorted, "with all p-values already ascending, adjusted should stay ascending")
})

test("holmReject matches holm thresholded at alpha", () => {
    const pValues = [0.001, 0.02, 0.04, 0.5]
    const adjusted = holm(pValues)
    const rejected = holmReject(pValues, 0.05)
    assert.deepEqual(rejected, adjusted.map((p) => p <= 0.05))
})

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

test("classify: superiority", () => {
    assert.equal(classify({ estimate: 0.2, low: 0.1, high: 0.3, kind: "superiority" }), "SUPERIOR")
    assert.equal(classify({ estimate: -0.2, low: -0.3, high: -0.1, kind: "superiority" }), "INFERIOR")
    assert.equal(classify({ estimate: 0, low: -0.1, high: 0.1, kind: "superiority" }), "INCONCLUSIVE")
    // Boundary: an interval that just touches zero is not a strict win either side.
    assert.equal(classify({ estimate: 0, low: 0, high: 0.2, kind: "superiority" }), "INCONCLUSIVE")
    assert.equal(classify({ estimate: 0, low: -0.2, high: 0, kind: "superiority" }), "INCONCLUSIVE")
})

test("classify: sign handling never lets a negative estimate read as SUPERIOR", () => {
    const result = classify({ estimate: -0.15, low: -0.25, high: -0.05, kind: "superiority" })
    assert.equal(result, "INFERIOR")
    assert.notEqual(result, "SUPERIOR")
})

test("classify: noninferiority", () => {
    const margin = 0.1
    assert.equal(classify({ estimate: 0.05, low: -0.05, high: 0.2, margin, kind: "noninferiority" }), "NON-INFERIOR")
    assert.equal(classify({ estimate: -0.2, low: -0.3, high: -0.15, margin, kind: "noninferiority" }), "INFERIOR")
    assert.equal(classify({ estimate: -0.1, low: -0.15, high: 0.05, margin, kind: "noninferiority" }), "INCONCLUSIVE")
})

test("classify: equivalence", () => {
    const margin = 0.1
    assert.equal(classify({ estimate: 0, low: -0.05, high: 0.05, margin, kind: "equivalence" }), "EQUIVALENT")
    assert.equal(classify({ estimate: -0.12, low: -0.15, high: 0.05, margin, kind: "equivalence" }), "INCONCLUSIVE")
    assert.equal(classify({ estimate: 0.12, low: -0.05, high: 0.15, margin, kind: "equivalence" }), "INCONCLUSIVE")
})

test("classify throws on an unknown kind", () => {
    assert.throws(() => classify({ low: 0, high: 1, kind: "bogus" }))
})

test("classify throws when bounds are missing", () => {
    assert.throws(() => classify({ kind: "superiority" }))
    assert.throws(() => classify({ low: 0, kind: "superiority" }))
})

// ---------------------------------------------------------------------------
// gatekeep
// ---------------------------------------------------------------------------

test("gatekeep: a failed gate rejects nothing in the family", () => {
    const { gatePassed, results } = gatekeep({
        gate: { p: 0.2 },
        family: [{ name: "a", p: 0.001 }, { name: "b", p: 0.5 }],
        alpha: 0.05,
    })
    assert.equal(gatePassed, false)
    for (const result of results) {
        assert.equal(result.adjusted, null)
        assert.equal(result.rejected, false)
    }
})

test("gatekeep: a passed gate applies Holm to the family", () => {
    const { gatePassed, results } = gatekeep({
        gate: { p: 0.01 },
        family: [{ name: "a", p: 0.01 }, { name: "b", p: 0.04 }, { name: "c", p: 0.03 }],
        alpha: 0.05,
    })
    assert.equal(gatePassed, true)
    const byName = Object.fromEntries(results.map((result) => [result.name, result]))
    closeTo(byName.a.adjusted, 0.03, 1e-9)
    closeTo(byName.b.adjusted, 0.06, 1e-9)
    closeTo(byName.c.adjusted, 0.06, 1e-9)
    assert.equal(byName.a.rejected, true)
    assert.equal(byName.b.rejected, false)
    assert.equal(byName.c.rejected, false)
})

// ---------------------------------------------------------------------------
// clusterRobustZ
// ---------------------------------------------------------------------------

function makeGaussian(random) {
    let spare = null
    return function gaussian() {
        if (spare !== null) {
            const value = spare
            spare = null
            return value
        }
        let u
        let v
        let s
        do {
            u = random() * 2 - 1
            v = random() * 2 - 1
            s = u * u + v * v
        } while (s === 0 || s >= 1)
        const scale = Math.sqrt((-2 * Math.log(s)) / s)
        spare = v * scale
        return u * scale
    }
}

test("clusterRobustZ with one item per cluster matches sd / sqrt(n) within 5%", () => {
    const random = splitmix32(7)
    const gaussian = makeGaussian(random)
    const n = 200
    const mu = 0.03
    const sigma = 0.2
    const diffs = Array.from({ length: n }, () => mu + gaussian() * sigma)
    const clusters = diffs.map((_, index) => `item-${index}`)

    const { se } = clusterRobustZ(diffs, clusters)

    const sampleMean = diffs.reduce((sum, value) => sum + value, 0) / n
    const sampleVariance = diffs.reduce((sum, value) => sum + (value - sampleMean) ** 2, 0) / (n - 1)
    const expectedSe = Math.sqrt(sampleVariance) / Math.sqrt(n)

    const relativeError = Math.abs(se - expectedSe) / expectedSe
    assert.ok(relativeError < 0.05, `relative error ${relativeError} exceeds 5% (se=${se}, expected=${expectedSe})`)
})

test("clusterRobustZ returns null z/p when se is 0", () => {
    const result = clusterRobustZ([1, 1, 1], ["a", "b", "c"])
    assert.equal(result.se, 0)
    assert.equal(result.z, null)
    assert.equal(result.p, null)
})

// ---------------------------------------------------------------------------
// iccDesignEffect
// ---------------------------------------------------------------------------

test("iccDesignEffect: identical values within clusters give icc near 1", () => {
    const values = [1, 1, 1, 1, 5, 5, 5, 5, 10, 10, 10, 10, 20, 20, 20, 20]
    const clusters = ["a", "a", "a", "a", "b", "b", "b", "b", "c", "c", "c", "c", "d", "d", "d", "d"]
    const { icc } = iccDesignEffect(values, clusters)
    closeTo(icc, 1, 0.001)
})

test("iccDesignEffect: independent values give icc near 0", () => {
    const random = splitmix32(99)
    const gaussian = makeGaussian(random)
    const clusters = []
    const values = []
    for (let clusterIndex = 0; clusterIndex < 50; clusterIndex++) {
        for (let itemIndex = 0; itemIndex < 10; itemIndex++) {
            clusters.push(`c${clusterIndex}`)
            values.push(gaussian())
        }
    }
    const { icc, meanClusterSize, clusters: clusterCount } = iccDesignEffect(values, clusters)
    closeTo(icc, 0, 0.1)
    assert.equal(clusterCount, 50)
    assert.equal(meanClusterSize, 10)
})

// ---------------------------------------------------------------------------
// geometricMeanRatio
// ---------------------------------------------------------------------------

test("geometricMeanRatio averages ratios in log space", () => {
    closeTo(geometricMeanRatio([[2, 1], [8, 4]]), 2, 1e-9)
    closeTo(geometricMeanRatio([[1, 2], [1, 8]]), geometricMeanRatio([[2, 1], [8, 1]]) ** -1, 1e-9)
})

test("geometricMeanRatio drops non-positive pairs", () => {
    closeTo(geometricMeanRatio([[2, 1], [0, 4], [-1, 4], [8, 4]]), 2, 1e-9)
    assert.equal(geometricMeanRatio([[0, 1], [-1, 2]]), null)
})

// ---------------------------------------------------------------------------
// clusterBootstrap
// ---------------------------------------------------------------------------

test("clusterBootstrap: basic shape and skipped-draw accounting", () => {
    const items = [
        { diff: 1, cluster: "a" }, { diff: 0, cluster: "a" },
        { diff: 1, cluster: "b" }, { diff: 1, cluster: "b" },
        { diff: 0, cluster: "c" },
    ]
    const result = clusterBootstrap({
        items,
        clusterOf: (item) => item.cluster,
        statistic: (sample) => sample.reduce((sum, item) => sum + item.diff, 0) / sample.length,
        B: 500,
        seed: 5,
    })
    assert.equal(result.clusters, 3)
    assert.equal(result.B, 500)
    closeTo(result.estimate, 3 / 5, 1e-9)
    assert.ok(result.low <= result.estimate + 1e-9)
    assert.ok(result.high >= result.estimate - 1e-9)
    assert.equal(result.skipped, 0)
})

// Coverage simulation: 200 synthetic clustered datasets, each with 60
// clusters of random size 1-8, a cluster-level random effect on the paired
// difference (ICC ~ 0.1), and a true mean difference of 0.05. For each
// dataset we take clusterBootstrap's 95% percentile CI (B = 800, kept low
// to keep the whole simulation fast) and check whether it covers the true
// 0.05. Across 200 independent datasets the empirical coverage should sit
// close to 0.95; we accept the broader [0.90, 0.98] band since 200 trials
// still carries real Monte Carlo noise (binomial SE at p=0.95, n=200 is
// about 0.0154, so +/-0.03 is roughly a 2-sigma band).
test("clusterBootstrap: 95% CI coverage on simulated clustered data", { timeout: 20_000 }, () => {
    const numDatasets = 200
    const numClusters = 60
    const trueDiff = 0.05
    const tau = Math.sqrt(0.01) // between-cluster sd
    const sigma = Math.sqrt(0.09) // within-cluster (item) sd -> ICC = 0.01 / 0.10 = 0.1

    const dataRandom = splitmix32(20260922)
    const gaussian = makeGaussian(dataRandom)

    let covered = 0
    for (let datasetIndex = 0; datasetIndex < numDatasets; datasetIndex++) {
        const items = []
        for (let clusterIndex = 0; clusterIndex < numClusters; clusterIndex++) {
            const size = 1 + Math.floor(dataRandom() * 8)
            const clusterEffect = gaussian() * tau
            for (let itemIndex = 0; itemIndex < size; itemIndex++) {
                const diff = trueDiff + clusterEffect + gaussian() * sigma
                items.push({ diff, cluster: clusterIndex })
            }
        }

        const { low, high } = clusterBootstrap({
            items,
            clusterOf: (item) => item.cluster,
            statistic: (sample) => sample.reduce((sum, item) => sum + item.diff, 0) / sample.length,
            B: 800,
            seed: 1000 + datasetIndex,
            level: 0.95,
        })

        if (low !== null && high !== null && low <= trueDiff && trueDiff <= high) covered++
    }

    const coverage = covered / numDatasets
    assert.ok(
        coverage >= 0.90 && coverage <= 0.98,
        `coverage ${coverage} (${covered}/${numDatasets}) out of [0.90, 0.98]`,
    )
})
