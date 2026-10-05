# Hybrid perfecter (prefix h), round 2

Mission: best hybrid (fixed pipeline + conditional extra steps) for e2b within 3,243 ms, gains from misses without touching hit answers.
Code: `explore2/variants/h-hybrid.js`; offline tools `explore2/tools/h-common.js`, `h-calib.js`, `h-sim.js`, `h-depth.js`, `h-check.js`.
Caches: r's dev caches (`<scratch>/r-features.json`, `r-ce.json`; FULL-0 + S300-1 + S100-x) and, for evaluation only, `<scratch>/h/r-features-S300-2.json`, `r-ce-S300-2.json` (same tools, S300-2; not used for tuning).

## Design

Base = s1 (gates + r5 swap + mailbox dedup), reimplemented so that unfired answers are byte-identical to s1: the cross-encoder scores s1's exact batch first (an all-candidates batch changed 2/60 swaps through batch numerics; with the split batch `h-check.js` reproduces s1's stored first context on 60/60).
Failure detector on s1's answer: `src` = the context email holding most of the answer's novel words (a-common `attribute`).

## 1. Offline trigger calibration (no GPU; `h-calib.js`, stored answers gates FULL-0, gates S300-1, r5 S300-1; n = 1,200)

Fire rates (%) by stratum × correctness of the stored answer; "fixable" = wrong misses with an AB email unseen in mailbox top 30.

| trigger | ok hit | bad hit | ok miss | bad miss | fixable |
|---|---|---|---|---|---|
| ceGap > 1 (best unseen CE − CE of src) | 8.6 | 13.8 | 54.7 | 64.3 | 67.1 |
| ceGap > 3 | 3.7 | 10.6 | 32.8 | 29.1 | 28.7 |
| CE of src < 0 | 15.5 | 17.0 | 59.9 | 53.1 | 50.3 |
| coverage of src < 0.4 | 2.8 | 7.4 | 17.5 | 26.3 | 26.6 |
| covGap ≥ 0.15 (best unseen mailbox-20 coverage − src coverage) | 0.9 | 6.4 | 11.7 | 35.7 | 39.9 |
| ceGap > 1 & covGap > 0 | 1.1 | 5.3 | 11.7 | 39.9 | 45.5 |
| src not at position 1 & CE of src < 0 | 1.7 | 4.3 | 22.6 | 24.4 | 23.1 |
| abstention | 0 | 0 | 0 | 6.6 | 6.3 |

Lexical/CE detectors reach <2% of correct hits only at ~40–45% recall of fixable misses. CE alone is a poor detector (the CE disagrees with BM25 on many correct hits).

The sharper detector is e2b itself: **one YES/NO probe on src** (w7's relevance prompt). Measured on S300-2 from w7's stored probe lists (w7 probed gates' 10 + header mailbox 15; src covered for ~97%), against s1's answers:

| s1 answer | n | src probe NO | src NO and some unseen email YES (= replacement fires) |
|---|---|---|---|
| hit correct | 181 | 20 (11%) | 4 (2.2%) |
| hit wrong | 19 | 3 | 0 |
| miss correct | 41 | 11 | 4 |
| miss wrong | 59 | 38 (64%) | 23 (39%) |

Composition simulated offline on S300-2 (`h-sim.js`, base s1, alt = w7's stored answer when fired): never 87.13 (s1); always w7 85.74; **src NO & unseen YES → w7: 87.61** (miss 41 → 48, flips miss +9/−2, hit 0/0); best lexical trigger (t1) + same guard 87.47. (This simulation used S300-2, but no parameter was tuned on it: the guard is the probe's own YES/NO.)

Probe depth (`h-depth.js`, dev wrong answers with a non-AB src, n = 154): AB email among the unseen candidates (mailbox 30 ∪ global 10) within top N: by CE @8 50.6 / @16 59.1 %; by retrieval order 52.6 / 64.3; **by RRF(CE rank, retrieval rank) 57.8 / 65.6** / @30 71.4. → N = 16, RRF order.

## 2. Variants

| id | behaviour |
|---|---|
| h1 | s1; probe src; if NO (or s1 abstained), probe top-16 unseen (RRF order); if any YES, re-answer (sandwich) from the YES emails (≤5) and replace unless it abstains |
| h2 | h1, re-answer context = YES emails (≤4) filled to 5 from s1's final context minus src |
| h3 | h1 pre-gated by the lexical detector t1 (covGap ≥ .15, or ceGap > 1 & covGap > 0) |

| h4 | h1's escalation on an **r4 base** (gates + conditional CE swap); after the lead's FULL-0 result (r5's always-swap changes every non-switched hit prompt and lost 1.5 hit points on FULL-0) the base must leave hit prompts unchanged |
| h5 | h1's escalation on plain gates |
| h6 | h4 with h2's re-answer context |

`h-check.js`: h4's first context = r4's stored one on 50/50 S300-2 questions, h5's = gates' on 50/50 (stub generator).
Offline prediction (`h-sim.js`, w7's stored answers as the re-answer, guard src NO & unseen YES): r4 base 85.53 → 86.28 (miss 38 → 49, miss flips +12/−1, hit 0/0); gates base 85.06 → 86.01.

Expected cost: s1 (~1.24 s) + 1 probe (~0.1–0.3 s) + 16 probes on ~25% of questions (~0.5 s) + a re-answer on ~12%.

## 3. Results (S300-2, J1; gates 85.1 = miss 31 / hit 89.0)

h1/h2 (s1 base) were withdrawn before running, after the lead's FULL-0 result. Smoke (h4, h6, first 30 = misses): replaced 12 / 8, all flips positive.

| id | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| h4 (raw) | 85.6 | +0.5 [−0.7, 1.5] | 52 | 88.0 | 2,017 | 6.0 |
| h4 "clean" (r4's stored verdict where h4 answered from r4's own prompt) | 86.1 | +1.03 [−0.1, 2.1] (h-clean.js bootstrap) | 53 | 88.5 | | |
| r4 | 85.5 | +0.5 [0.2, 0.9] | 38 | 89.0 | 1,246 | 1.0 |

h4 steps (`h-pair.js` vs r4): src YES 228 (175 hits), no YES 40, replaced 31 (27 misses, 4 hits), re-abstain 1.
- **Replaced: misses +16 / −1, hits 0 / −1** (lokey-t: src = gold at pos 2 got a false NO; the one YES email had lower CE than src, ceGap −1.05). Escalation alone ≈ +15 miss pts × 0.068 − 0.5 hit pts × 0.932 ≈ **+0.55 weighted** over r4.
- **Hit prompts changed: 4/200** (the replaced ones; 0 net gains, 1 loss). All other prompts are r4's, byte for byte (contexts checked 269/269).
- **Engine nondeterminism**: although the 269 unreplaced prompts are identical to r4's, 82 answer texts differ (first ~24 questions identical, then ~30% differ, independent of what the previous call was; no model reloads). Other multi-call runs (a5, s3, n-cr1) stayed byte-identical, so something in this run's interleaving (YES/NO probes with 3 output tokens?) perturbs e2b's greedy decoding. Verdict flips there: hit +1/−2, miss 0/−1, i.e. the raw −0.5 vs clean is noise from this, not from the method. A deterministic deployment (or the lead's re-run) should see ≈ the clean number.
- Possible guard (in-sample, 1 example, not run): skip replacement when ceGap < −1 (would remove the only hit loss and one 0/0 miss).

h6 (YES ≤4 filled to 5 from r4's final context minus src), S300-2: 85.0, Δ vs gates −0.0 [−1.5, 1.2], miss 51, hit 87.5, 1,991 ms; replaced misses +15/−1, **hits 0/−2**; clean 85.55 (+0.5). Filling the context with the old context hurts hits; dropped.

### Second set S300-1 (gates 83.9 = miss 34 / hit 87.5; r4 85.6)

| id | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| h4 (raw) | 85.4 | +1.6 [−1.1, 4.4] | 57 | 87.5 | 1,952 | 5.9 |
| h4 clean | 85.8 | +1.96 [0.2, 3.5] | 56 | 88.0 | | |
| r4 | 85.6 | +1.7 [0.7, 3.1] | 46 | 88.5 | 1,232 | 1.0 |

h4 vs r4: replaced misses 24 (+12/−2), replaced hits 2 (0/−1); unreplaced (identical prompts) hits +3/−4, misses +1/−0 (the same engine nondeterminism: only 186/274 unreplaced texts identical to r4).
The ceGap < −1 guard does not replicate (the S300-1 hit loss has ceGap −0.79, and 4 miss wins have ceGap < −0.5): dropped.

### Detector fire rates (both sets, 600 q)

| | S300-2 | S300-1 |
|---|---|---|
| src probe NO → 16 probes (cost step), hits | 25/200 (12.5%) | 30/200 (15%) |
| … misses | 47/100 | 41/100 |
| replacement, hits (hit prompt changed) | 4/200 (2.0%), net 0/−1 | 2/200 (1.0%), net 0/−1 |
| replacement, misses | 27/100, net +15 | 24/100, net +10 |

Wall: questions whose src got YES ≈ 1.53 s (r4 + one probe), probed ones ≈ 3.4 s; mean 1.95–2.0 s (under shared-CPU load), 5.9–6.0 calls.

## 4. Conclusions

- Best: **h4** = r4 + probe escalation. Escalation increment over r4 (replaced questions only, both sets): misses +28/−3 of 200 (+12.5 pts), hits 0/−2 of 400 (−0.5 pt) → ≈ **+0.4 weighted** (S300-2 +0.55, S300-1 +0.2). Same size as a5, with 6 hit prompts changed in 400 (net −2) vs a5's 0.
- vs gates: raw +0.5 (S300-2) / +1.6 (S300-1); "clean" (r4's own verdicts where the prompt was r4's) +1.0 / +2.0. Not a clean promotion: the gain over r4 is miss-side and modest.
- The e2b probe on the answer's own source email is a better failure detector than any lexical/CE feature (src NO on 64% of wrong misses vs 11% of correct hits; with "some unseen email YES" 39% vs 2.2%), but its false NOs on gold (≈10% of hits) are what costs the hit losses when a YES distractor exists.
- Engine nondeterminism: in h-runs, identical prompts gave different texts on ~30% of questions (other workers' multi-call runs did not). Worth checking before trusting small Δs from variants that interleave very short (3-token) calls.
- Not done: stacking with a5 (both target non-switched misses, expected overlap); re-answer context with src appended (h2-style "YES + best") — h6's result suggests old-context emails hurt.
