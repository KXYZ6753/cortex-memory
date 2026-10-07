// Seeded PRNG for the explore2 analysis tools (bootstrap resampling, permutation tests, CV splits).
//
// Replaces the hand-rolled LCG `seed = (seed * 1103515245 + 12345) & 0x7fffffff` (and its
// `% 2147483648` / `>>> 0` forms) that several tools used. That LCG multiplies in doubles: the
// product exceeds 2^53, so low bits are rounded away, and the state falls into a short cycle
// (10,466 from seeds 12345 / 7 for the `&` and `%` forms; 419 from seed 7 for `>>> 0`).
// A 4,000-draw bootstrap over 600 questions consumes 2.4 M numbers, i.e. it replays the same
// ~10 k numbers ~230 times, so its percentile intervals are unreliable. See
// docs/premise-study/explore2/ci-erratum.md.
//
// mulberry32: 32-bit state, all arithmetic in int32 (Math.imul), period 2^32; same function as
// tools/q-stats.js. Call shape matches the old tools: `const rnd = mulberry32(seed); rnd()` in [0, 1).
export function mulberry32(seed) {
    let a = seed | 0
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// Default number of bootstrap resamples for the tools that use this module.
export const BOOT_B = 10000

// Percentile of an ascending-sorted array (same index rule as the tools: floor(q * n)).
export const pctSorted = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]

// `node benchmarks/premise2/explore2/tools/rng.js`: quick uniformity check (chi-square, 400 buckets).
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
    const r = mulberry32(12345), K = 400, N = 4_000_000, c = Array(K).fill(0)
    for (let i = 0; i < N; i++) c[Math.floor(r() * K)]++
    const e = N / K, chi2 = c.reduce((s, x) => s + (x - e) ** 2 / e, 0)
    console.log(`mulberry32(12345): ${N} draws, ${K} buckets min ${Math.min(...c)} max ${Math.max(...c)} (expected ${e}); chi2 ${chi2.toFixed(0)} on ${K - 1} df`)
}
