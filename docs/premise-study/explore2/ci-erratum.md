# Erratum: bootstrap intervals from the explore2 analysis tools (worker r, Wed 7 Oct)

## Summary

Several explore2 analysis tools draw bootstrap indices from a hand-rolled linear congruential generator (LCG) that multiplies in JavaScript doubles. The product exceeds 2^53, so it is rounded, and the generator falls into a short cycle: 10,466 numbers for the `& 0x7fffffff` and `% 2147483648` forms (seeds 12345 and 7), and 419 numbers for the `>>> 0` form from seed 7 (`c-gold-eval.js`). A 4,000-draw bootstrap over 600 questions uses 2.4 M numbers, so it replays the same ~10 k numbers about 230 times. Point estimates are unaffected. The intervals are not reliable.

- With period 10,466, each interval bound is off by about ±0.4 points (rms) on S300-sized pools, in either direction. Coverage is slightly low: 92–93% instead of 95%.
- With period 419 (`c-gold-eval.js`), the intervals are far too narrow: median 55% of the correct width, 63% coverage.

All affected tools now use `tools/rng.js` (mulberry32, 32-bit integer arithmetic, B = 10,000). I recomputed every affected interval in the journal and the worker notes from the stored answers and verdicts.

## Method

1. **Finding the generators.** I searched `benchmarks/premise2/explore2/**` for LCG constants (1103515245, 1664525, 6364136223846793005, 16807, 48271, 69069), `seed *`, `Math.imul`, `Math.random`, and for "boot", "resampl" and "permut". Every hand-rolled generator in explore2 is the 1103515245 LCG, and all of them are in `tools/`. No file in `variants/` contains a generator or a bootstrap.
2. **Measuring them.** I ran each exact JavaScript expression from the tool's own seed. Brent's cycle detection on the state gives the tail and the period. I compared the sequence with exact BigInt arithmetic. Uniformity is a 400-bucket chi-square, measured both over a full bootstrap's worth of draws and over one cycle.
3. **Effect on intervals.** I ran a synthetic experiment with 1,000 datasets of known true Δ, built to match the tools' stratified paired bootstrap: miss/hit strata, missShare 0.068, per-question d ∈ {−1, 0, +1}. For each dataset I compared the old generator (with the tool's own seed and B) against mulberry32 at B = 10,000 and against a normal approximation.
4. **Recomputation.** I copied the unmodified tools to a sibling directory (`explore2/tools-orig-ci/`, deleted after the audit) and re-ran each command that produced a reported interval, to confirm the old number reproduces from the current stored data. I then ran the fixed tool: same command, same resampling unit (question within miss/hit stratum, or within set × stratum for `x-tau.js`), same design weights and seed, B = 10,000. The corrected bootstrap's own Monte Carlo noise at B = 10,000 is about 0.02 points per bound.

## Which implementations were broken, and how

All of them use the recurrence `seed = seed * 1103515245 + 12345`, evaluated in doubles. With a state below 2^31 or 2^32 and a multiplier of about 2^30, the product reaches about 2^61. A double holds 53 bits, so the low 8 or so bits of the product are rounded away. From the second step on, the sequence differs from the exact LCG. The rounded recurrence has no full-period guarantee, so it falls into a short cycle.

| form | tools (explore2/tools/) | seed | tail (steps before the cycle) | period | evidence |
|---|---|---|---|---|---|
| `(seed * 1103515245 + 12345) & 0x7fffffff`, ÷ 0x7fffffff | `y-lib.js` (used by `y-table`, `y-sim`, `y-s100`), `t-ladder.js`, `c-pooled.js`, `l-lib.js` (used by `l-lexsel`, `l-sim`, `l-xeval`, `l-eval`, `l-v3eval`), `l-stub.js` | 12345 (`l-stub`: 7) | 5,938 (seed 7: 4,004) | **10,466** | 389 of 400 random seeds reach this same cycle; the rest reach cycles of 220, 247 and 378. Over 2.4 M draws (one 4,000 × 600 bootstrap), only 16,402 distinct values occur. 400 equal buckets get 3,439–11,225 draws against 6,000 expected (chi-square 104,465 on 399 df). Within one cycle the values are only mildly uneven (chi-square 458 on 399 df, p ≈ 0.02), and 10,422 of the 10,466 cycle states are even. The defect is the replay of one short cycle, not a strongly biased marginal. |
| `(seed * 1103515245 + 12345) % 2147483648`, ÷ 2^31 | `e-lib.js` (used by `e-eval`, `e-vote`, `e-stepvote`), `x-tau.js`, `h-clean.js` (`% 2 ** 31`), `z-eval.js` (not in q's list), `p-logit.js` (CV folds, not a CI) | 7 | 4,004 | **10,466** | The same recurrence as the `&` form: both reduce the same rounded double modulo 2^31 exactly. I checked that the two sequences are identical for 10^6 steps. Same cycle and the same evidence as above. |
| `(seed * 1103515245 + 12345) >>> 0`, ÷ 2^32 | `c-gold-eval.js` | 7 | 7,245 | **419** | q reported 6,063, which is the cycle from seed 12345; `c-gold-eval.js` re-seeds at 7 on every call. 2.4 M draws give 7,662 distinct values, 400 buckets get 7–28,572 draws (chi-square 1.96 M), and lag-1 autocorrelation is −0.10. Past the tail, every bootstrap replicate of n hits is a window of n consecutive values from a 419-value cycle. For n = 450 (FULL-1) a replicate is the whole cycle plus 31 values, so almost all resampling variance is lost. |

**What it does to an interval** (synthetic, 1,000 datasets, true Δ known; the tools' own seeds and B):

| design | old generator | coverage of the true Δ (old / mulberry32 / normal approx.) | old − corrected bound, rms (5–95%) | width old / corrected, median (5–95%) |
|---|---|---|---|---|
| 600 q (200 miss / 400 hit), stratified, B 4,000 | `&` LCG, seed 12345 | 93.3% / 94.7% / 94.9% | lower 0.37 (−0.57, +0.60); upper 0.40 (−0.69, +0.63) | 0.97 (0.78, 1.20) |
| 300 q (100 / 200), stratified, B 4,000 | `&` LCG, seed 12345 | 91.8% / 93.8% / 94.3% | lower 0.44 (−0.73, +0.74); upper 0.48 (−0.80, +0.74) | 0.98 (0.85, 1.14) |
| 200 hits, one sample, B 2,000 | `>>> 0` LCG, seed 7 | 63.2% / 94.5% / 96.1% | lower 1.75; upper 1.92 | 0.55 (0.29, 1.00) |

The period-10,466 generator adds an error of about ±0.4–0.5 points per bound, about 20 times the corrected bootstrap's own Monte Carlo noise (SD 0.022 at B = 10,000). It is unbiased on average, so an interval can come out too wide or too narrow and shifted either way. Any old interval whose bound is within about 0.6 of zero cannot be trusted to exclude, or include, zero. The period-419 generator makes intervals systematically far too narrow.

**Not affected:**
- `explore/analyze.js` `pairedBootstrap` (used by `cli2.js report`, `b-cmp`, `d-flips`, `q-table`, `v-final` per set) and `v-final.js`'s pooled stratified bootstrap both use `splitmix32` from `text.js`: a Weyl state (period 2^32) with an integer-only finaliser (`Math.imul`). 2.4 M draws give buckets of 5,713–6,227 and chi-square 442 on 399 df.
- `q-stats.js` uses mulberry32.
- Outside explore2 (not changed): `premiseBenchmark.js`, `retrievalBenchmark.js` and `rerankerBenchmark.js` use a different LCG, `1664525 * state + 1013904223`. There the product stays below 2^52.7, so the double arithmetic is exact and the generator is the standard full-period one.

## The fix

`benchmarks/premise2/explore2/tools/rng.js` exports `mulberry32(seed)`: the same call shape (`const rnd = mulberry32(seed); rnd()` returns a value in [0, 1)), 32-bit integer arithmetic through `Math.imul`, and period 2^32. It is the same function as in `q-stats.js`. The module also exports `BOOT_B = 10000` and `pctSorted(sorted, q)`, which uses the tools' `floor(q · n)` index rule. `node tools/rng.js` prints a uniformity check: 4 M draws, chi-square 381 on 399 df.

Switched to it, with the same seeds:
- `y-lib.js`, `t-ladder.js`, `c-pooled.js`, `l-lib.js`, `e-lib.js`, `x-tau.js`, `h-clean.js`, `c-gold-eval.js` and `z-eval.js`: default B is now 10,000. The hard-coded percentile indices (`draws[100]`, `[3899]`, `[50]`, `[1949]`) are now `pctSorted(draws, 0.025 / 0.975)`.
- `e-eval.js`, `e-vote.js` and `e-stepvote.js`: these passed B = 1,000 or 2,000 explicitly, and now use the default.
- `l-stub.js` (the fake model's random logprobs) and `p-logit.js` (5-fold CV assignment) also switched; neither produces an interval.

Nothing in `variants/` changed. `variants/t-ladder.js` has no generator; the bootstrap is in `tools/t-ladder.js`.

One unrelated one-line fix in `tools/t-ladder.js`: without `--ref`, its argument filter dropped the set name (`i !== -1 && i !== 0`) and the tool crashed. It now keeps all arguments when `--ref` is absent. This affected no reported number, since such a run could not complete.

Note for worker l: `l-lib.js` changed under a running worker. Any `bootstrapPairs` interval l prints from now on uses mulberry32 with B = 10,000. Intervals already written in `l.md` used the old generator; they are in the table below.

## Checking q's report

- **Confirmed:**
  - Period 10,466 for the `&` and `%` forms. Both forms are one recurrence, and seeds 12345 and 7 reach the same cycle.
  - Point estimates are unaffected.
  - q's three example intervals. The q1 interval reproduces: old [0.47, 2.83], corrected [−0.20, 2.70] at B = 10,000 (q: [−0.23, 2.70] at B = 20,000). So do y1's 600- and 900-question intervals (rows below).
- **Corrected:**
  - `c-gold-eval.js` (`>>> 0`, seed 7) has period 419, not 6,063; 6,063 is the cycle reached from seed 12345. Its intervals are therefore much worse than the others: systematically too narrow.
  - "Non-uniform" is true of the stream a bootstrap consumes, which is one ~10 k cycle replayed. A single cycle is only mildly uneven (p ≈ 0.02).
- **Added to q's list:**
  - `z-eval.js`: same `%` form, seed 7.
  - The callers of the listed libraries: `y-table`, `y-sim` and `y-s100`; `l-lexsel`, `l-sim`, `l-xeval`, `l-eval` and `l-v3eval`; `e-eval`, `e-vote` and `e-stepvote`.
  - The `/tmp` one-off script behind g.md §8 used the same LCG. Its intervals reproduce exactly with the `&` form, seed 12345, B 4,000.
- **On q's list but produce no interval:** `l-stub.js` (random logprobs for a dry run) and `p-logit.js` (5-fold CV assignment).

## Sources checked and found fine

These were identified from the notes' own captions and confirmed numerically: the mailbox-cluster bootstrap reproduces the printed interval, and the old stratified LCG bootstrap does not.

- **Journal:**
  - rounds 1–2 tables (lines 293–298, 313–318);
  - 341, 367, 388–389, 489–490, 500, 502, 512, 533–534 and 562–565;
  - the phase 2 summary (436–441), which is taken from v-final.md (`v-final.js`, splitmix32).
- **Worker notes:**
  - a, b, d, i, j, k, m, n, o, r, w;
  - the per-set rows in e, g, p, x and q;
  - h.md 65, 67, 75, 81, 83;
  - the "Δ vs x1" column of y.md's per-set tables;
  - BRIEF.md 60, 84, 87, 123, 184, 185;
  - PREREG-X1-DRAFT.md 41–45. These are cluster intervals although the caption says "paired stratified": the label is wrong, the numbers are right.
- **Spot checks (analyze.js `pairedBootstrap`, B 2,000, seed 20260922 as printed; then B 10,000):**
  - journal:315 x1 − gates, FULL-1: printed +1.3 [−0.4, 2.9]; reproduced [−0.40, 2.90]; at B 10,000 [−0.31, 2.96].
  - journal:315 x1 − gates, S300-3: printed +2.3 [0.2, 4.3]; reproduced [0.24, 4.34]; at B 10,000 [0.40, 4.41].
  - q.md: q2 − det x1 on S300-4 + S300-5 (the rule the FULL-2 confirmation copies): printed +2.51 [0.2, 4.6]; reproduced [0.23, 4.58]; at B 10,000 [0.26, 4.61].
  - `q-stats.js` reproduces q.md exactly: [0.28, 4.77], p = 0.026.

## Audit: every affected interval

Old intervals are as printed. Every one reproduced exactly from the current stored data with the unmodified tool, except l.md:40's CAD row (noted). Corrected intervals use the fixed tool: mulberry32, B = 10,000, same resampling unit, design weights and seed. Bounds within 0.3 of zero are given to two decimals. **Bold** in the last column marks a change in whether the interval excludes 0.

### Journal (`explore-journal.md`)

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 350 (= t.md:149) | ladder: t1 − frozen agent, S300-2 + S300-1 (600) | +17.1 [12.3, 22.6] | [12.2, 22.0] | no |
| 351 (t.md:150) | t2 − t1 | +23.1 [18.2, 28.1] | [18.5, 27.8] | no |
| 352 (t.md:151) | t3 − t2 | +1.9 [−1.2, 4.4] | [−1.0, 4.8] | no |
| 353 (t.md:152) | g5 − t3 | +4.1 [2.0, 6.9] | [1.8, 6.6] | no |
| 354 (t.md:153) | g2 − g5 | −0.8 [−2.1, 1.2] | [−2.9, 1.5] | no |
| 355 (t.md:154) | k1 − g2 | +1.0 [−0.2, 2.9] | [−0.6, 2.6] | no |
| 356 (t.md:155) | k3 − k1 | +0.7 [0.0, 1.4] | [0.00, 1.6] | no (lower bound 0.00 in both) |
| 357 (t.md:156) | x1 − k3 | +0.5 [−0.9, 2.1] | [−1.2, 2.3] | no ("tie" stands) |
| 407 (y.md:220, 283) | y1 − x1, 600 | +1.07 [−0.3, 2.4] | [−0.40, 2.6] | no (promotion was on the point estimate; CI still includes 0) |
| 407 (y.md:220) | y1 − gates, 600 | +3.5 [1.7, 5.4] | [1.2, 5.8] | no |
| 408 (y.md:221) | y2 − x1, 600 | +0.97 [−0.4, 2.3] | [−0.5, 2.5] | no |
| 410 (y.md:264, 285) | y1 − x1, S100-4 + S100-5 (200) | −0.66 [−2.5, 0.5] | [−2.7, 0.54] | no |
| 410 (y.md:273, 285) | y1 − x1, 800 paired | +0.74 [−0.1, 1.8] | [−0.5, 2.0] | no |
| 418 | y1 S300-3: − x1; − gates | −2.1 [−5.1, 0.9]; +0.2 [−3.4, 3.8] | [−4.9, 0.6]; [−3.0, 3.4] | no |
| 419 | y1 FULL-1: − x1; − gates | +0.2 [−1.2, 2.4]; +1.6 [−0.5, 3.5] | [−1.4, 1.9]; [−0.5, 3.6] | no |
| 420 | y1 confirmation, 900: − x1; − gates | −0.5 [−1.6, 1.6]; +1.2 [−0.7, 3.4] | [−1.9, 0.9]; [−0.6, 2.9] | no (decision rested on the point estimates; the corrected interval leans more negative) |
| 495 (= BRIEF.md:187) | x1 − gates, 7 sets (2,700) | +1.1 [0.1, 1.7] | [0.15, 2.0] | no (still excludes 0) |
| 518 (= c.md:178, 196) | x1 + thread labels, 1,800 | +0.47 [−0.9, 1.6] | [−0.75, 1.7] | no (null) |
| 518 (= c.md:159, 196) | x1 + thread labels, S300-4 + S300-5 | +0.8 [−1.1, 2.9] | [−1.4, 3.0] | no |

### t.md (`tools/t-ladder.js`)

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 149–156 | ablation ladder | as journal 350–357 | as journal | no |
| **158, 178** | **k1 − gates, 600** | **+1.2 [0.0, 3.1]** (lower bound +0.02) | **[−0.38, 2.8]** | **yes, mildly: no longer excludes 0.** "Moving the stop decision to per-email YES/NO is what pays" is a point-estimate statement and stands, but k1 − gates is not significant at 95% on 600 questions. |
| 94, 117, 136 | t-x1r − x1 (S300-2 / S300-1 / pooled) | [0, 0] | [0, 0] | no |
| 95; 118 | t-lx − x1, S300-2; S300-1 | −0.1 [−0.3, 0.0]; −0.1 [−0.3, 0.0] | [−0.20, 0.00]; [−0.3, 0.00] | no |
| 96; 119 | t-lk − x1, S300-2; S300-1 | −0.1 [−2.0, 1.9]; −1.6 [−4.9, 2.2] | [−2.3, 2.2]; [−4.5, 1.1] | no |
| 97; 120 | k3 − x1, S300-2; S300-1 | +0.0 [−1.9, 2.0]; −1.1 [−3.9, 2.2] | [−2.3, 2.3]; [−3.7, 1.6] | no |
| 137, 157, 195, 200 | t-lx − x1, 600 | −0.1 [−0.2, 0.0] | [−0.24, 0.00] | no |
| 138, 194, 203 | t-lk − x1, 600 | −0.8 [−2.5, 0.9] | [−2.6, 1.0] | no |
| 139 | k3 − x1, 600 | −0.5 [−2.1, 0.9] | [−2.3, 1.2] | no |
| 140 | gates − x1, 600 | −2.5 [−4.5, −0.4] | [−4.6, −0.19] | no |
| 192 (= y.md:225) | x1 − gates, 600 | +2.5 [0.4, 4.5] | [0.19, 4.6] | no (still excludes 0, by less) |

### h.md (`tools/h-clean.js`, `tools/t-ladder.js`)

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 66 | h4 "clean" − gates, S300-2 (h-clean) | +1.03 [−0.1, 2.1] | [−0.17, 2.0] | no |
| 82 | h4 "clean" − gates, S300-1 (h-clean) | +1.96 [0.2, 3.5] | [0.29, 3.7] | no |
| 159 | S300-2: h7 − x1; h7 − j2 | +0.3 [−1.1, 2.1]; −0.5 [−1.4, 0.0] | [−1.1, 2.1]; [−1.4, 0.00] | no |
| 160 | S300-2: h8 − x1; h8 − j2 | +0.5 [−1.2, 2.3]; −0.3 [−1.3, 0.3] | [−1.0, 2.2]; [−1.4, 0.27] | no |
| 161 | S300-2: j2 − x1 | +0.8 [−0.2, 2.3] | [−0.20, 2.3] | no |
| 171 | S300-1: h7 − x1; h7 − j2 | +0.3 [−0.2, 1.3]; [0.0, 0.0] | [−0.27, 1.4]; [0.00, 0.00] | no |
| 172 | S300-1: h8 − x1; h8 − j2 | +0.3 [−0.8, 1.4]; +0.0 [−0.9, 0.9] | [−1.2, 2.1]; [−1.4, 1.4] | no |
| 173 | S300-1: j2 − x1 | +0.3 [−0.2, 1.3] | [−0.27, 1.4] | no |
| 174, 194 | h7 − x1; h7 − j2, 600 | +0.3 [−0.7, 0.9]; −0.2 [−0.7, 0.0] | [−0.5, 1.3]; [−0.7, 0.00] | no |
| 175, 194 | h8 − x1; h8 − j2, 600 | +0.4 [−0.8, 1.4]; −0.2 [−1.1, 0.8] | [−0.7, 1.6]; [−0.9, 0.6] | no |
| 176 (= y.md:86, 222) | j2 − x1, 600 | +0.6 / +0.56 [−0.2, 1.1] | [−0.14, 1.5] | no |
| 179 | h7 − gates; h8 − gates, 600 | +2.8 [0.7, 4.5]; +2.9 [1.0, 4.6] | [0.7, 4.8]; [0.8, 4.9] | no |

### y.md (`tools/y-sim.js`, `y-table.js`, `y-s100.js`)

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 85, 223 | m2 − x1, 600 | +0.14 [0.0, 0.3] | [0.00, 0.31] | no |
| 87, 224 | t-lx − x1, 600 | −0.10 [−0.2, 0.0] | [−0.24, 0.00] | no |
| 88 | y1 (simulated) − x1, 600 | +0.50 [−0.0, 1.0] | [−0.07, 1.3] | no |
| 89 | y2 (simulated) − x1, 600 | +0.40 [−0.1, 0.9] | [−0.17, 1.2] | no |
| 145; 146 | S300-2: y1 − gates; y2 − gates | +2.5 [−0.4, 5.2]; +2.4 [−0.5, 5.0] | [−0.5, 5.7]; [−0.6, 5.6] | no |
| 178; 179 | S300-1: y1 − gates; y2 − gates | +4.6 [0.6, 7.5]; +4.4 [0.4, 7.3] | [1.2, 7.9]; [1.1, 7.7] | no |
| 220–221 | y1 / y2 − x1 and − gates, 600 | see journal 407–408 | see journal | no |
| 221 | y2 − gates, 600 | +3.4 [1.7, 5.4] | [1.1, 5.7] | no |
| 222 | j2 − gates, 600 | +3.0 [1.0, 4.9] | [0.9, 5.1] | no |
| 223 | m2 − gates, 600 | +2.6 [0.6, 4.7] | [0.32, 4.7] | no |
| 224 | t-lx − gates, 600 | +2.35 [0.4, 4.5] | [0.08, 4.5] | no (still excludes 0, barely) |
| 262 | y1 − x1, S100-4 | +0.41 [0.0, 1.0] | [0.00, 0.95] | no |
| 263 | y1 − x1, S100-5 | −1.73 [−5.6, 0.5] | [−5.7, 0.54] | no |

### c.md (`tools/c-gold-eval.js`, `t-ladder.js`, `c-pooled.js`)

Gold-only render tables (`c-gold-eval.js`, period 419). Every old interval here is too narrow. Several do not even contain their own point estimate; FULL-1 threadh2 and markce were not printed but come out as [−1.1, −0.4] and [−2.2, −1.6] around a point of −1.6.

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 57; 58 | S300-1 thread; thread1 | +1.0 [−1.0, 2.5]; −0.5 [−2.0, 1.5] | [−1.5, 4.0]; [−2.5, 1.5] | no |
| 59 | S300-1 keys | −1.0 [−2.0, 1.5] | [−4.5, 2.5] | no |
| 60 | S300-1 hint | +0.5 [0.0, 2.0] | [−1.0, 2.0] | **lower bound no longer at 0**; no |
| 61; 62; 63 | S300-1 keysce; markce; tkce | −1.0 [−4.0, 1.0]; +1.0 [−0.5, 1.5]; −1.0 [−2.5, 1.0] | [−4.5, 2.5]; [−1.5, 4.0]; [−4.5, 2.5] | no |
| 64; 65 | S300-1 chrono; chronohint | −1.0 [−2.0, 1.0]; −1.0 [−1.0, 2.0] | [−3.5, 1.5]; [−4.0, 1.5] | no |
| 77 | S300-2 thread | +1.0 [0.5, 3.5] | [−1.5, 3.5] | **yes: no longer excludes 0**; the gold-only null is unaffected |
| 78 | S300-2 thread1 | +2.0 [0.5, 4.5] | [0.5, 4.0] | no |
| 79 | S300-2 keys | +0.5 [0.0, 2.5] | [−2.5, 3.5] | **lower bound no longer at 0**; no |
| 90 | FULL-1 thread | −1.8 [−1.8, −0.9] | [−3.56, −0.22] | no (still excludes 0) |
| 91 | FULL-1 thread1 | −0.9 [−1.6, −0.7] | [−2.22, 0.44] | **yes: no longer excludes 0.** "FULL-1 negative for every presentation" holds as point estimates only; only `thread` is significantly negative. |

End to end:

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 115 | c-gT − gates, S300-1 (t-ladder) | +2.3 [−0.6, 4.6] | [−0.7, 5.3] | no |
| 116 | c-gC − gates, S300-1 | −0.5 [−3.5, 1.5] | [−3.3, 2.2] | no |
| 128 | c-fin1 − x1, S300-2 | +2.3 [0.5, 5.5] | [0.00, 4.9] (0.00–0.07 across 5 seeds) | **yes, mildly: it now only touches 0.** This dev-set result motivated the screening slot; c's final verdict (null) does not depend on it. |
| 128 | c-fin1 − gates, S300-2 | +3.4 [0.9, 5.9] | [0.7, 6.3] | no |
| 130 | c-fin2 − gates, S300-2 | +0.3 [−2.9, 2.7] | [−2.5, 3.1] | no |
| 143 | c-fin1 − x1; − gates, S300-3 | +0.5 [−2.0, 3.7]; +2.8 [0.0, 6.3] | [−2.6, 3.4]; [−0.58, 6.1] | old lower bound +0.02 only touched 0; no |
| 145 | c-fin2 − gates, S300-3 | +1.1 [−1.3, 3.8] | [−1.6, 3.8] | no |
| 157; 158 | c-fin3 − x1, S300-4; S300-5 | −0.1 [−2.9, 3.7]; +1.7 [−1.2, 4.7] | [−3.2, 3.1]; [−1.3, 4.7] | no |
| 159 | c-fin3 pooled 600: − x1; − gates | +0.8 [−1.1, 2.9]; +0.1 [−1.9, 1.7] | [−1.4, 3.0]; [−2.1, 2.2] | no |
| 160; 161 | c-fin4 − gates, S300-4; S300-5 | −3.1 [−5.3, −0.9]; +1.7 [−2.3, 4.6] | [−5.8, −0.6]; [−1.5, 5.0] | no |
| 162, 196 | c-fin4 pooled 600: − gates; − x1 | −0.7 [−2.3, 1.3]; +0.0 [−2.0, 2.6] | [−2.8, 1.4]; [−2.6, 2.6] | no |
| 172 | x1 + labels, dev 600 (c-pooled) | +1.40 [−0.66, 3.09] | [−0.53, 3.40] | no |
| 173 | x1 + labels, screening 600 | +0.80 [−1.07, 2.87] | [−1.43, 3.00] | no |
| 174 | x1 + labels, all four, 1,200 | +1.10 [−0.62, 2.36] | [−0.36, 2.60] | no |
| 175 | gates + labels, dev 900 | +1.20 [−0.16, 2.95] | [−0.40, 2.82] | no |
| 176, 182, 196 | gates + labels, all five, 1,500 | +0.44 [−0.87, 1.96] | [−0.84, 1.70] | no |
| 177 | x1 + labels, FULL-1 (c-xT) | −0.7 [−3.8, 0.9] | [−2.9, 1.5] | no |
| 178, 196 | x1 + labels, 1,800 | +0.47 [−0.92, 1.58] | [−0.75, 1.70] | no (null) |

### l.md (`tools/l-lib.js` via `l-lexsel`, `l-sim`, `l-xeval`)

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 40 | lexical selector x1 + {commit, single} | +0.57 [0.0, 1.4] | [−0.46, 1.63] | **old lower bound printed 0.0 (−0.0); now clearly includes 0.** Descriptive; no |
| 40 | x1 + {commit, single, CAD} | +0.66 [0.2, 1.6] | not reproducible: today's candidate pool gives +1.11 [0.7, 2.2] with the old tool and +1.11 [−0.02, 2.26] fixed. More CAD texts have been graded since. | the reported number cannot be re-derived; on today's data the corrected interval touches 0 |
| 76 | offline sim, single read, m = 1 | +1.45 [0.8, 2.7] | [0.41, 2.63] | no (already flagged as an in-sample artefact) |
| 77 | commit + single, m = 1 | +1.34 [0.3, 2.5] | [0.21, 2.59] | no |
| 78 | commit + single + labels, m = 1 | +1.66 [0.6, 2.9] | [0.45, 2.95] | no |
| 107 | l-xs1 S300-1: − x1; − gates | −1.74 [−4.8, 1.0]; +2.1 [−1.8, 5.7] | [−4.5, 1.0]; [−1.5, 5.6] | no |
| 108 | l-xs1 S300-3: − x1; − gates | −1.74 [−4.3, 0.7]; +0.6 [−2.2, 3.4] | [−4.5, 1.0]; [−3.1, 4.2] | no |
| **109, 119, 132** | **l-xs1 − x1, 600** | **−1.74 [−3.4, −0.1]** | **[−3.74, 0.16]** (upper bound 0.16–0.26 across 5 seeds) | **yes: no longer excludes 0.** l.md:119 says "−1.7, CI excludes 0", which is no longer true. The decision (no decision-set run) stands on the point estimate, the +1/−19 switches with a non-gold YES email, and the circularity argument. |
| 109 | l-xs1 − gates, 600 | +1.3 [−1.0, 4.6] | [−1.2, 3.8] | no |
| 118 | replayed rule, single read m = 1 | −1.51 [−3.2, −0.4] | [−3.34, 0.26] | **yes: no longer excludes 0.** Descriptive; no |
| 118 | replayed, always the labelled answer | +0.66 [−1.1, 2.4] | [−0.84, 2.23] | no |

### x.md, z.md, g.md

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| x.md:31 | τ −0.1 policy − gates, pooled S300-2 + S300-1 (x-tau, set × stratum) | +2.4 [0.7, 3.8] | [0.55, 4.31] | no |
| x.md:31 | τ −0.1 policy − k3, pooled | +0.5 [−0.9, 1.7] | [−0.84, 1.83] | no ("x1 ≈ k3" stands) |
| z.md:39 | x1 − gates, S300-2 (z-eval) | +1.1 [−2.0, 3.6] | [−1.9, 4.1] | no |
| z.md:40 | z-think1 − gates; − x1, S300-2 | +0.6 [−2.7, 3.7]; −0.5 [−2.7, 1.8] | [−3.0, 4.3]; [−2.9, 2.0] | no |
| z.md:41 | z-ext1 − gates; − x1, S300-2 | +1.5 [−2.0, 5.2]; +0.4 [−1.6, 3.4] | [−1.9, 4.9]; [−2.1, 2.9] | no |
| z.md:63 | x1 − gates, S300-1 (reference row) | +3.8 [−0.1, 6.6] | [0.6, 7.1] | **now excludes 0** (cli2 report already printed [0.9, 6.9]); no |
| z.md:64 | z-think1 − gates; − x1, S300-1 | +1.6 [−1.9, 5.1]; −2.3 [−4.9, 0.3] | [−2.3, 5.3]; [−5.1, 0.4] | no |
| z.md:65 | z-ext1 − gates; − x1, S300-1 | +1.7 [−2.7, 5.2]; −2.1 [−5.1, 0.8] | [−1.8, 5.1]; [−4.9, 0.4] | no (z's nulls stand) |
| g.md:86 | g5 − gates, 600 (§8 one-off script) | +1.0 [−1.0, 2.5] | [−1.3, 3.2] | no |
| g.md:87 | g2 / g6 − gates, 600 | +0.2 [−0.5, 0.6 / 0.7] | [−0.39, 0.65] (both) | no |
| g.md:88 | g1 − gates, 600 | −1.3 [−4.1, 1.2] | [−3.7, 1.1] | no |

### u.md (tool not named; every interval matches `t-ladder.js`'s old bootstrap exactly and not the cluster bootstrap)

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| 40, 84, 111 | u-orep − oracles, S300-2 (gold-only) | +3.5 [1.0, 6.5] | [0.68, 6.48] | no |
| 112; 113; 114 | u-orep, S300-1; S300-3; FULL-1 | −0.9 [−3.7, 2.0]; −0.6 [−3.7, 2.4]; +0.3 [−1.2, 3.4] | [−3.52, 1.67]; [−3.46, 2.34]; [−1.73, 2.32] | no |
| 115 | u-orep pooled 1,500 | +0.5 [−0.3, 2.4] | [−0.75, 1.80] | no |
| 82 | u-ocad − oracles, S300-2 | +1.2 [−1.5, 4.3] | [−1.99, 4.33] | no |
| 83, 124 | u-ocad5 − oracles, S300-2 | +3.9 [1.6, 6.9] | [1.20, 6.93] | no |
| 126; 187 | u-ocad5, S300-1; FULL-1 | −0.3 [−3.9, 2.1]; +0.6 [−1.2, 3.6] | [−3.13, 2.40]; [−1.59, 2.89] | no |
| 123; 125 | u-opad − oracles, S300-2; S300-1 | +1.6 [−1.1, 4.6]; −0.4 [−2.5, 1.3] | [−1.13, 4.40]; [−2.47, 1.60] | no |
| 156 | 3-set pooled vs oracles: u-opad; **u-ocad5**; u-orep | −0.0 [−1.5, 1.0]; +2.1 [0.6, 3.6]; +0.7 [−1.1, 2.2] | [−1.55, 1.40]; [0.47, 3.89]; [−0.97, 2.32] | no ("CAD reads one email better" still excludes 0) |
| 94; 95 | u-grep − gates, S300-2; S300-1 | +1.3 [−1.6, 4.5]; −1.3 [−5.1, 1.4] | [−2.00, 4.58]; [−4.72, 1.93] | no |
| 98 | u-grep − gates, 600 | 0.0 [−2.9, 2.3] | [−2.40, 2.26] | no |
| 53, 96; 97 | u-xrep − x1, S300-2; S300-1 | +1.1 [−1.3, 5.3]; −3.3 [−5.6, −0.9] | [−2.06, 4.34]; [−6.19, −0.74] | no |
| 99 | u-xrep − x1, 600 | −1.1 [−3.1, 0.6] | [−3.19, 1.00] | no |
| 140 | u-xcad − x1, S300-2 | +0.3 [−2.5, 2.5] | [−2.33, 2.93] | no |
| 146 | u-gcad − gates, S300-2 | −0.1 [−3.9, 2.8] | [−3.72, 3.48] | no |
| 179; 180 | u-gpad − gates, S300-4; S300-5 | −1.1 [−3.7, 1.7]; +2.5 [−0.7, 5.7] | [−3.86, 1.40]; [−0.73, 5.80] | no |
| 181 | u-gpad pooled 600 (placebo calibration) | +0.7 [−1.3, 2.8] | [−1.40, 2.82] | no |

### BRIEF.md, PREREG-X1-DRAFT.md, p.md, e.md

| where | quantity | old | corrected | conclusion changed? |
|---|---|---|---|---|
| BRIEF.md:187 | gates − x1, S300-4 + S300-5 (t-ladder) | +0.7 [−1.0, 3.1] | [−1.33, 2.83] | no |
| BRIEF.md:187 | x1 − gates, 7 sets | +1.1 [0.1, 1.7] | [0.15, 2.0] | no |
| PREREG-X1-DRAFT.md:65 | copies of the y1 confirmation intervals (journal 418–420) | −2.1 [−5.1, 0.9]; +0.2 [−1.2, 2.4]; −0.5 [−1.6, 1.6] | [−4.9, 0.6]; [−1.4, 1.9]; [−1.9, 0.9] | no. Not edited (PREREG file). |
| p.md:36–57 | `p-logit.js` 5-fold CV fire / gain counts (not an interval) | logit > 0: 67 (6.2%) / 92 / 115 | 65 (6.0%) / 95 / 118. The other thresholds move by 1–3 questions. | no. The full-data weights frozen in `p-perfect.js` do not use the RNG and are unchanged. |
| e.md | `e-lib.js` `bootDelta` | e.md quotes only point estimates from these tools | – | nothing to correct |

## Conclusions that change

No promotion, null or confirmation decision in the journal changes. The y1 confirmation (−0.5 [−1.9, 0.9]) and the c, z, u, h and e nulls stand. Every journal-level claim that an interval excludes 0 still does: x1 − gates over 2,700, the ladder's t1, t2 and g5 steps, and u's CAD gold-only read. The statements below change.

1. **l.md:109 / 119 / 132:** the l-xs1 selector over 600 fresh dev questions is −1.74 [−3.74, 0.16], so the "CI excludes 0" in l.md:119 is wrong. "No decision-set run" stands on its other grounds: the point estimate, the +1/−19 switches with a non-gold YES email, and circularity.
2. **t.md:158 / 178:** k1 − gates over 600 questions is +1.2 [−0.38, 2.8], so it does not exclude 0 (it was "at the edge"). The ladder's reading that the per-email commit check is the useful control step is a point-estimate statement and stands.
3. **c.md gold-only tables (`c-gold-eval.js`):** every interval was roughly half the correct width. Corrected, S300-2 thread (+1.0) and FULL-1 thread1 (−0.9) no longer exclude 0, and S300-1 hint and S300-2 keys no longer sit at 0. On FULL-1 only `thread` is significantly negative ([−3.56, −0.22]); "negative for every presentation" holds as point estimates only. c's null conclusion is unaffected, and if anything firmer.
4. **c.md:128:** c-fin1 − x1 on S300-2 is +2.3 [0.00, 4.9] instead of [0.5, 5.5]. It touches 0, so the dev-set signal that sent labels to screening was weaker than shown. c's final null is unaffected.
5. **l.md:118 and l.md:40** (descriptive): single read m = 1 −1.51 [−3.34, 0.26] and lexical selection +0.57 [−0.46, 1.63] no longer exclude 0. l.md:40's CAD figure (+0.66 [0.2, 1.6]) cannot be re-derived from today's candidate pool.
6. **z.md:63** (reference row only): x1 − gates on S300-1 now excludes 0 ([0.6, 7.1]), in line with cli2 report's [0.9, 6.9].

Use `tools/q-stats.js`, `analyze.js` (`cli2 report`) or any tool that imports `tools/rng.js` for new intervals.
