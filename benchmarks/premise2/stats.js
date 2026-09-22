// Statistics layer for premise2: a paired-comparison LLM evaluation where the
// same questions are answered under several conditions, each answer is
// graded 0/1, and questions are clustered by mailbox (so answers within a
// mailbox are not independent). Pure functions only, no dependencies, ESM,
// Node 24/26 safe (no node:sqlite, no Node-26-only APIs).
//
// wilson() and the log-factorial machinery behind exactMcNemar() are copied
// (not imported) from benchmarks/premiseBenchmark.js:176-202, so this module
// stays dependency-free and the two files are free to diverge later.

// ---------------------------------------------------------------------------
// §0  Small helpers
// ---------------------------------------------------------------------------

const round = (value, places = 4) => (value == null || Number.isNaN(value) ? null : Number(value.toFixed(places)))

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length

// ---------------------------------------------------------------------------
// §1  Deterministic PRNG
// ---------------------------------------------------------------------------

// splitmix32: a small, fast, well-mixed 32-bit generator. Given a seed,
// returns a function producing floats in [0, 1) on each call. Same
// construction as benchmarks/premise2/text.js's splitmix32; kept local here
// so this module has no sibling-file dependency.
export function splitmix32(seed) {
    let state = seed >>> 0
    return function next() {
        state = (state + 0x9e3779b9) | 0
        let z = state
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
        z ^= z >>> 16
        return (z >>> 0) / 4294967296
    }
}

// ---------------------------------------------------------------------------
// §2  Normal distribution helpers
// ---------------------------------------------------------------------------

// Abramowitz & Stegun 7.1.26 rational approximation to erf; max absolute
// error ~1.5e-7, plenty for confidence intervals and two-sided p-values.
function erf(x) {
    const sign = x < 0 ? -1 : 1
    const ax = Math.abs(x)
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911
    const t = 1 / (1 + p * ax)
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
    return sign * y
}

// Standard normal CDF, built on the erf approximation above.
export function normalCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2))
}

// Inverse standard normal CDF (quantile function), Peter Acklam's algorithm.
// Accurate to about 1.15e-9 relative error over (0, 1) with no iteration.
export function normalQuantile(p) {
    if (p === 0) return -Infinity
    if (p === 1) return Infinity
    if (!(p > 0) || !(p < 1)) throw new Error(`normalQuantile: p must be in (0, 1), got ${p}`)

    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]

    const pLow = 0.02425
    const pHigh = 1 - pLow

    if (p < pLow) {
        const q = Math.sqrt(-2 * Math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    }
    if (p > pHigh) {
        const q = Math.sqrt(-2 * Math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    }
    const q = p - 0.5
    const r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

// ---------------------------------------------------------------------------
// §3  Single-proportion and McNemar tests
// ---------------------------------------------------------------------------

// Wilson score interval; far better than the normal approximation at the
// extremes. Copied verbatim (module-local `round`) from
// benchmarks/premiseBenchmark.js:176-183.
export function wilson(successes, total, z = 1.96) {
    if (!total) return [null, null]
    const proportion = successes / total
    const denominator = 1 + z ** 2 / total
    const centre = proportion + z ** 2 / (2 * total)
    const spread = z * Math.sqrt(proportion * (1 - proportion) / total + z ** 2 / (4 * total ** 2))
    return [round(Math.max(0, (centre - spread) / denominator)), round(Math.min(1, (centre + spread) / denominator))]
}

// Log-factorial table shared by exactMcNemar and midpMcNemar so neither pays
// for it twice, and so midpMcNemar can reuse the same binomial point mass
// exactMcNemar already computed the tail from.
function logFactorials(n) {
    const table = [0]
    let sum = 0
    for (let index = 1; index <= n; index++) {
        sum += Math.log(index)
        table.push(sum)
    }
    return table
}

const logChoose = (table, n, k) => table[n] - table[k] - table[n - k]

// Two-sided exact conditional McNemar test on the discordant pairs only.
// Same arithmetic as benchmarks/premiseBenchmark.js:186-202 (mcnemarExactP),
// copied rather than imported so this module has no cross-file dependency.
export function exactMcNemar(b, c) {
    const total = b + c
    if (!total) return 1
    const smaller = Math.min(b, c)
    const table = logFactorials(total)
    let tail = 0
    for (let index = 0; index <= smaller; index++) {
        tail += Math.exp(logChoose(table, total, index) + total * Math.log(0.5))
    }
    return Math.min(1, 2 * tail)
}

// Two-sided mid-p McNemar test (Fagerland, Lydersen & Laake 2013): the exact
// conditional p-value with the point mass at the observed discordant count
// removed once (rather than the usual "split in half, count each side"
// framing — the two are algebraically the same thing for the two-sided
// test), which fixes the exact test's conservatism without inflating type I
// error the way the classic asymptotic test does.
export function midpMcNemar(b, c) {
    const total = b + c
    if (!total) return 1
    const smaller = Math.min(b, c)
    const table = logFactorials(total)
    const exact = exactMcNemar(b, c)
    const pointMass = Math.exp(logChoose(table, total, smaller) + total * Math.log(0.5))
    return Math.min(1, Math.max(0, exact - pointMass))
}

// ---------------------------------------------------------------------------
// §4  Paired-proportion confidence interval
// ---------------------------------------------------------------------------

// Newcombe (1998, Statistics in Medicine 17:2635-2650) "method 10": Wilson
// score intervals for the two marginal proportions, combined with a phi
// correction for their within-subject correlation. a/b/c/d are the four
// cells of the 2x2 paired table: a = both conditions correct, b = only the
// first correct, c = only the second correct, d = neither.
//
// Verified against the paper directly: reproduced five of its Table III
// worked examples (the ones actually labelled "method 10") to 4 decimal
// places using this exact implementation — see the test file for the
// figures and a note on why the task's suggested a=8,b=5,c=4,d=5 example
// could not be located in the paper's Table II or III.
export function newcombePairedCI(a, b, c, d, z = 1.96) {
    const n = a + b + c + d
    if (!n) return [null, null]
    const p1 = (a + b) / n
    const p2 = (a + c) / n
    const [l1, u1] = wilson(a + b, n, z)
    const [l2, u2] = wilson(a + c, n, z)
    const denominator = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d))
    const phi = denominator === 0 ? 0 : (a * d - b * c) / denominator
    const dl1 = p1 - l1
    const du1 = u1 - p1
    const dl2 = p2 - l2
    const du2 = u2 - p2
    const low = (p1 - p2) - Math.sqrt(dl1 ** 2 - 2 * phi * dl1 * du2 + du2 ** 2)
    const high = (p1 - p2) + Math.sqrt(du1 ** 2 - 2 * phi * du1 * dl2 + dl2 ** 2)
    return [round(low), round(high)]
}

// ---------------------------------------------------------------------------
// §5  Sample size
// ---------------------------------------------------------------------------

// Connor (1987) sample-size formula for the McNemar-type paired binary
// design: psi is the discordant-pair variance term, delta is the smallest
// detectable difference in proportions worth powering for.
export function connorN(psi, delta, alpha = 0.05, power = 0.8) {
    const zA = normalQuantile(1 - alpha / 2)
    const zB = normalQuantile(power)
    return Math.ceil(((zA * Math.sqrt(psi) + zB * Math.sqrt(psi - delta * delta)) ** 2) / (delta * delta))
}

// ---------------------------------------------------------------------------
// §6  Cluster-aware resampling and standard errors
// ---------------------------------------------------------------------------

function percentileOf(sortedValues, p) {
    if (!sortedValues.length) return null
    const index = p * (sortedValues.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    if (lower === upper) return sortedValues[lower]
    const weight = index - lower
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

// Cluster (block) bootstrap with a percentile CI. Items are grouped by
// clusterOf(item) (in this benchmark, the mailbox a question came from);
// each replicate resamples cluster ids with replacement, holding the number
// of clusters fixed, concatenates the items of the drawn clusters, and
// recomputes `statistic` over that concatenation. Draws where `statistic`
// returns a non-finite value (e.g. divide-by-zero on a degenerate resample)
// are skipped and counted rather than poisoning the percentile CI.
export function clusterBootstrap({ items, clusterOf, statistic, B = 10000, seed = 1, level = 0.95 }) {
    const groups = new Map()
    for (const item of items) {
        const key = clusterOf(item)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(item)
    }
    const clusterIds = [...groups.keys()]
    const estimate = statistic(items)

    const random = splitmix32(seed)
    const draws = []
    let skipped = 0
    for (let replicate = 0; replicate < B; replicate++) {
        const sample = []
        for (let pick = 0; pick < clusterIds.length; pick++) {
            const clusterId = clusterIds[Math.floor(random() * clusterIds.length)]
            sample.push(...groups.get(clusterId))
        }
        const value = statistic(sample)
        if (Number.isFinite(value)) {
            draws.push(value)
        } else {
            skipped++
        }
    }
    draws.sort((x, y) => x - y)

    const alpha = 1 - level
    const low = percentileOf(draws, alpha / 2)
    const high = percentileOf(draws, 1 - alpha / 2)

    return { estimate, low, high, B, clusters: clusterIds.length, skipped, draws }
}

// Bootstrap p-values from sorted draws (a clusterBootstrap result). Two-sided for
// "difference != 0"; for non-inferiority, the one-sided share of draws at or below
// -margin, doubled so it is on the same scale as a two-sided test (a 95% CI lower
// bound above -margin <=> p < .05). Floored at 1/B.
export function bootstrapP({ draws }, { kind = "superiority", margin = 0 } = {}) {
    const n = draws.length
    if (!n) return null
    const atOrBelow = (x) => draws.filter((value) => value <= x).length / n
    const atOrAbove = (x) => draws.filter((value) => value >= x).length / n
    const p = kind === "noninferiority" ? 2 * atOrBelow(-margin) : 2 * Math.min(atOrBelow(0), atOrAbove(0))
    return Math.min(1, Math.max(p, 1 / n))
}

// Cluster-robust z-test for the mean of per-item differences (Miller 2024,
// "Adding Error Bars to Evals"). Sums each cluster's residuals first, then
// squares and sums across clusters, which is what makes this robust to
// within-cluster correlation instead of just averaging per-item variance.
export function clusterRobustZ(diffs, clusters) {
    const n = diffs.length
    const estimate = mean(diffs)

    const clusterSums = new Map()
    for (let index = 0; index < n; index++) {
        const key = clusters[index]
        clusterSums.set(key, (clusterSums.get(key) ?? 0) + (diffs[index] - estimate))
    }
    let sumSquares = 0
    for (const clusterSum of clusterSums.values()) sumSquares += clusterSum ** 2
    const se = Math.sqrt(sumSquares) / n

    if (se === 0) {
        return { estimate: round(estimate), se: 0, z: null, p: null, clusters: clusterSums.size }
    }
    const z = estimate / se
    const p = 2 * (1 - normalCdf(Math.abs(z)))
    return { estimate: round(estimate), se: round(se, 6), z: round(z), p: round(p, 6), clusters: clusterSums.size }
}

// ---------------------------------------------------------------------------
// §7  Multiple comparisons
// ---------------------------------------------------------------------------

// Holm-Bonferroni step-down adjustment. Returns adjusted p-values in the
// same order as the input, monotone non-decreasing by rank and capped at 1.
export function holm(pValues) {
    const m = pValues.length
    const order = pValues.map((_, index) => index).sort((x, y) => pValues[x] - pValues[y])

    const adjustedByRank = new Array(m)
    let runningMax = 0
    for (let rank = 0; rank < m; rank++) {
        const original = order[rank]
        const value = Math.min(1, (m - rank) * pValues[original])
        runningMax = Math.max(runningMax, value)
        adjustedByRank[rank] = runningMax
    }

    const adjusted = new Array(m)
    for (let rank = 0; rank < m; rank++) adjusted[order[rank]] = adjustedByRank[rank]
    return adjusted
}

export function holmReject(pValues, alpha = 0.05) {
    return holm(pValues).map((p) => p <= alpha)
}

// ---------------------------------------------------------------------------
// §8  Decision rules
// ---------------------------------------------------------------------------

// Classifies a confidence interval against a decision rule. `estimate` is
// accepted (and should be passed) for callers' bookkeeping/logging, but the
// decision itself only ever depends on the interval bounds — that is what
// keeps sign handling correct: a negative estimate whose whole interval
// sits below zero is INFERIOR because `high < 0`, never SUPERIOR, regardless
// of what `estimate` says.
export function classify({ estimate, low, high, margin = 0, kind }) {
    if (low == null || high == null) throw new Error("classify: low and high bounds are required")

    if (kind === "superiority") {
        if (low > 0) return "SUPERIOR"
        if (high < 0) return "INFERIOR"
        return "INCONCLUSIVE"
    }

    if (kind === "noninferiority") {
        if (low > -margin) return "NON-INFERIOR"
        if (high < -margin) return "INFERIOR"
        return "INCONCLUSIVE"
    }

    if (kind === "equivalence") {
        if (low > -margin && high < margin) return "EQUIVALENT"
        return "INCONCLUSIVE"
    }

    throw new Error(`classify: unknown kind "${kind}"`)
}

// Gatekeeping: only test the family at all if the gate itself is significant
// (standard fixed-sequence / hierarchical testing to control the family-wise
// error rate without spending alpha on comparisons nobody would trust if the
// headline result failed).
export function gatekeep({ gate, family, alpha = 0.05 }) {
    const gatePassed = gate.p < alpha

    if (!gatePassed) {
        return {
            gatePassed,
            results: family.map(({ name, p }) => ({ name, p, adjusted: null, rejected: false })),
        }
    }

    const adjusted = holm(family.map(({ p }) => p))
    const results = family.map(({ name, p }, index) => ({
        name,
        p,
        adjusted: adjusted[index],
        rejected: adjusted[index] <= alpha,
    }))
    return { gatePassed, results }
}

// ---------------------------------------------------------------------------
// §9  Design effect
// ---------------------------------------------------------------------------

// One-way ANOVA ICC estimator (Fleiss/Donner) with the unequal-cluster-size
// adjustment n0, plus the resulting design effect (Kish 1965): how much a
// naive per-item variance underestimates the true variance once items are
// clustered by mailbox.
export function iccDesignEffect(values, clusters) {
    const n = values.length
    const groups = new Map()
    for (let index = 0; index < n; index++) {
        const key = clusters[index]
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(values[index])
    }
    const k = groups.size
    const grandMean = mean(values)

    let ssBetween = 0
    let ssWithin = 0
    let sumSquaredSizes = 0
    for (const group of groups.values()) {
        const size = group.length
        sumSquaredSizes += size * size
        const groupMean = mean(group)
        ssBetween += size * (groupMean - grandMean) ** 2
        for (const value of group) ssWithin += (value - groupMean) ** 2
    }

    const msBetween = k > 1 ? ssBetween / (k - 1) : 0
    const msWithin = n > k ? ssWithin / (n - k) : 0
    const n0 = k > 1 ? (n - sumSquaredSizes / n) / (k - 1) : 1

    let icc = 0
    const iccDenominator = msBetween + (n0 - 1) * msWithin
    if (k > 1 && iccDenominator !== 0) {
        icc = (msBetween - msWithin) / iccDenominator
    }

    const meanClusterSize = n / k
    const designEffect = 1 + (meanClusterSize - 1) * Math.max(icc, 0)

    return {
        icc: round(icc),
        designEffect: round(designEffect),
        meanClusterSize: round(meanClusterSize),
        clusters: k,
    }
}

// ---------------------------------------------------------------------------
// §10  Ratio summary
// ---------------------------------------------------------------------------

// Geometric mean of the ratio x/y over pairs, computed in log space so it is
// symmetric under swapping which condition is "numerator" (unlike an
// arithmetic mean of ratios). Pairs with a non-positive x or y are dropped
// since log is undefined there.
export function geometricMeanRatio(pairs) {
    const logs = []
    for (const [x, y] of pairs) {
        if (x > 0 && y > 0) logs.push(Math.log(x / y))
    }
    if (!logs.length) return null
    return Math.exp(mean(logs))
}
