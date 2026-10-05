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

Expected cost: s1 (~1.24 s) + 1 probe (~0.1–0.3 s) + 16 probes on ~25% of questions (~0.5 s) + a re-answer on ~12%.

## 3. Results

(pending)
