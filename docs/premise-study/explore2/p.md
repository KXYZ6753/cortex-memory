# p: one-shot perfecter (exploration phase 2, round 2)

Mission: best ONE-SHOT pipeline for e2b (fixed retrieval + one reading call + the abstain retry; CPU retrieval models allowed), building on r5 (gates + cross-encoder slot-5 swap from the asker's mailbox BM25 top 30).

Code: `explore2/variants/p-perfect.js` (`buildContexts` shared by variants and the simulator; `pdense` diagnostic), tools `explore2/tools/p-ce.js` (CE score cache, std / snippet text), `p-sim.js` (AB recall per slot + deterministic end-to-end simulation), `p-common.js`.

## Offline setup

- CE caches (`p-ce.js`): MiniLM scores for mailbox BM25 top 50 + global top 10 (+ nomic-dense mailbox top 30 / global top 10 where `pdense` lists exist), std text and question-snippet text (`snip` = Subject + Sender + the 1600-char body window covering the most question content words; differs only for long bodies). Sets: S300-2, S300-1, FULL-0 (+ r's r-ce.json for S100-0..9, std, depth 30).
- `pdense` (diagnostic, no generation, 262 ms/question incl. CPU query embedding) stored dense lists for S300-2.
- `p-sim.js`: builds contexts with the same `buildContexts` code the variants run, then (a) answer-bearing (AB) recall per slot, (b) a deterministic simulation: if the first context equals a stored sandwich-family answer's first context (gates, r1/r2/r4/r5, s1, o3, o11, p*), that answer's J1 verdict is used; otherwise P(correct | stratum, position of first AB in ctx0) from all stored sandwich-family answers. Sim is only trustworthy where "unknown" is small; for hit-changing configs it just returns the prior.
- Position prior (all stored sandwich-family answers): hits pos1 90%, pos2 87%, pos3 63%, pos4 83%, pos5 88%; misses none 7%, pos1 75%, pos2-3 76%, pos4 63%, **pos5 82%** (mostly r5's swapped emails).

## Offline recall (AB in ctx0, %; miss @1/@5/union, hit @5; ctx0 changed vs gates = prompts changed, misses/hits)

| config | S300-2 miss | S300-2 hit@5 | S300-2 changed m/h | S300-1 miss | S300-1 hit@5 | S300-1 changed | FULL-0 miss | FULL-0 hit@5 | FULL-0 changed |
|---|---|---|---|---|---|---|---|---|---|
| gates | 19/33/43 | 100 | – | 24/37/51 | 100 | – | 24.7/48.7/58.7 | 99.8 | – |
| r5 (swap slot 5 always) | 19/45/48 | 100 | 40/193 | 24/57/62 | 99.5 | 49/188 | 24.7/60.7/64.7 | 99.6 | 59/420 |
| r4 (CE margin −1) | 19/44/47 | 100 | 34/25 | 24/56/61 | 100 | 40/18 | 24.7/58.7/64.0 | 99.8 | 48/44 |
| slot 1 (swapped email first) | 31/45/48 | (hit@1 10.5) | | | | | | | |
| slots 2-4 | = r5 @5, but pos 2-4 read worse (prior pos4 63% vs pos5 82%) | | | | | | | | |
| depth 20 / 50 | 44 / 45 @5 | 100 | | 57 / 58 | 99.5 | | 61.3 / 60.7 | 99.6 | |
| snip CE text | 47 @5 | 100 | | | | | | | |
| + dense mailbox top 10/20/30 | 47 @5 (= snip; no gain) | 100 | | | | | | | |
| dedup mailbox ctx (s1) | 45 @5, union 52 | 100 | | 58, union 65 | | | 60.7, union 66.7 | | |
| reverse swap (switched: mbox slot5 <- best CE of pool) | 48 @5 | 100 | 60/7 | 60 | 99.5 | 51/12 | 60.7 | 99.8 | 91/30 |
| reverse swap, global top 10 source | 43 @5 | | | 56 | | | 59.3 | | |
| 2 swaps always (slots 4,5) | 50 @5 | 99.5 | 40/193 | 61 | 99.0 | 49/188 | 66.7 | 99.3 | 59/420 |
| 2 swaps, other-mailbox emails dropped first | 50 @5 | 100 | 40/193 | 61 | 99.0 | 49/188 | 66.7 | 99.6 | 59/420 |

Conclusions from recall alone: **slot 5** is right (slot 1 destroys hit@1; slots 2-4 add nothing to @5 and read worse); **depth 50, dense, reverse swap, dedup**: ≤ +1-3 miss points of AB, inconsistent; **a second swapped email** is the only consistent recall lever (+4-6 miss @5 on all three sets); snippet CE helps the pick a little.

## Lead's design rule (round 2, from FULL-0: r5 86.1 vs gates 86.8, hits 88.9 vs 90.4): changing a hit prompt flips ~5% of hit answers at random. So: make miss-side changes behind a sharp trigger and leave hit prompts unchanged.

## Swap trigger (non-switched questions; `p-trigger.js`, `p-logit.js`)

Dev = FULL-0 + S300-1 + S100-0..9: 1,084 non-switched hits, 320 non-switched misses (all lack AB in the global five); best unseen mailbox-30 CE email is AB for 113 misses (b1|b2: 140).

| rule | hit prompts changed | misses swapped | gains (b1 AB) | gains b1|b2 |
|---|---|---|---|---|
| always (r5) | 1084 (100%) | 320 | 113 | 140 |
| r4: b1 − gmax > −1 | 109 (10.1%) | 260 | 92 | 115 |
| b1 − gmax > 0 | 57 (5.3%) | 175 | 69 | 82 |
| b1 − gmax > 1 | 16 (1.5%) | 87 | 47 | 52 |
| gmax < 0 | 114 (10.5%) | 78 | 28 | 36 |
| **logistic, 5-fold CV, logit > 0** | **67 (6.2%)** | – | **92** | **115** |
| logistic, logit > −0.5 | 92 (8.5%) | | 102 | 128 |
| logistic, logit > 0.5 | 40 (3.7%) | | 81 | 101 |

Logistic features (standardised): b1 − gmax (+0.94), b1 − g1 (+0.90), b2 − gmax (+0.78), hdr(b1) − hdr(g1) (+0.55), gmax, g1 (≈0.2/0.1), log BM25 score of global #1 (−0.79), relative BM25 gap #1−#2 (−0.96), hdr(g1) (≈0). Weights frozen in p-perfect.js (fitted on dev only; S300-2 never used for fitting). Same miss gains as r4 with 40% fewer hit prompts changed.
Held-out check S300-2 (prompts changed vs gates): r4 34 misses / 25 hits; trigger logit>0 34 / **10**; logit>−0.5 37 / 18.

Switched questions (reverse swap into mailbox slot 5, `p-trigger-sw.js`): dev 430 switched misses / 66 hits; even at CE margin 0 the reverse swap gains AB on 17 misses but drops it on 4: ≈ +0.07 weighted. Dropped.

Picking the swapped emails (non-switched misses, `p-pick.js`, AB in top 1 / top 2 picks): dev (108): CE d30 38/51; CE d50 39/53; snip d50 41/56; **max(CE, snip) d50 42/57**; header or BM25 fusions worse (rrf(CE,BM25) 27/45). S300-2 (40): CE 12/17, max(CE,snip) d50 14/19.

## Variants (p-perfect.js; all: gates' contexts and prompt, swap only on non-switched questions when the logistic trigger fires)

| id | trigger | swap | pick |
|---|---|---|---|
| p1 | logit > 0 | best 2 unseen CE emails → slots 4-5 (best last), other-mailbox globals dropped first | std CE over mailbox BM25 top 30 |
| p2 | logit > −0.5 | as p1 | as p1 |
| p3 | logit > 0 | as p1 | max(std CE, snippet CE) over mailbox top 50 (trigger itself unchanged → same hit prompts as p1) |
| p4 | logit > 0 | as p3 | as p3, + near-duplicate collapse in the mailbox context (s1/o11 dedup; switched contexts only) |

## Results S300-2 (J1; gates 85.1 = miss 31 / hit 89.0, 763 ms; r5 87.0)

| variant | weighted | Δ vs gates [95% CI] | Δ vs r5 [CI] | miss | hit | wall ms | calls | hit prompts changed (flips) | miss prompts changed (flips) |
|---|---|---|---|---|---|---|---|---|---|
| p1 | 85.7 | +0.6 [0.3, 0.9] | −1.3 [−3.7, 1.0] | 40 | 89.0 | 1,228 | 1.0 | 11 (+0/−0) | 34 (+9/−0) |
| p2 | 85.7 | +0.7 [0.3, 1.0] | −1.3 [−3.6, 1.1] | 41 | 89.0 | 1,224 | 1.0 | 17 (+0/−0) | 36 (+10/−0) |
| p3 | 85.7 | +0.7 [0.4, 1.0] | −1.3 [−3.5, 1.0] | 41 | 89.0 | 1,301 | 1.0 | 11 (+0/−0) | 34 (+10/−0) |
| p4 | 85.8 | +0.7 [0.4, 1.2] | −1.2 [−3.4, 1.1] | 42 | 89.0 | 1,297 | 1.0 | 12 (+0/−0) | 50 (+11/−0) |
| r4 (ref) | 85.5 | +0.5 [0.2, 0.9] | −1.5 [−3.7, 0.8] | 38 | 89.0 | 1,246 | 1.0 | 25 (+0/−0) | 34 (+7/−0) |

p3 vs p1 (pick by max(std, snippet CE) over mailbox top 50): misses +2/−1, 4 hit prompts changed, 0 flips.

## Results S300-1 (second screening set; it is part of the trigger's dev data; gates 83.9 = miss 34 / hit 87.5, r5 84.3)

| variant | weighted | Δ vs gates [95% CI] | Δ vs r5 [CI] | miss | hit | wall ms | calls | hit prompts changed (flips) | miss prompts changed (flips) |
|---|---|---|---|---|---|---|---|---|---|
| p3 | 84.8 | +1.0 [0.3, 1.7] | +0.5 [−2.4, 3.3] | 48 | 87.5 | 1,317 | 1.0 | 10 (+0/−0) | 38 (+15/−1) |
| p4 | 84.8 | +1.0 [0.3, 1.7] | +0.5 [−2.4, 3.3] | 48 | 87.5 | 1,310 | 1.0 | 12 (+0/−0) | 49 (+15/−1) |
| p2 | 85.2 | +1.4 [0.5, 2.5] | +0.9 [−2.1, 3.8] | 47 | 88.0 | 1,233 | 1.0 | 13 (+1/−0) | 43 (+14/−1) |
| r4 (ref) | 85.6 | +1.7 [0.7, 3.1] | +1.3 [−1.5, 4.0] | 46 | 88.5 | 1,232 | 1.0 | 18 (+2/−0) | 40 (+13/−1) |

p1 vs r5: hits +2/−5 on the 193 hit prompts r5 changes (r5's hit "gain" on S300-2 is the random flip luck the lead found on FULL-0), misses +4/−3.


## Conclusions

- **Best one-shot: p3** (p4 = p3 + mailbox dedup, same accuracy within one question). vs gates: S300-2 +0.7 [0.4, 1.0], S300-1 +1.0 [0.3, 1.7], pooled ≈ +0.85; all of it from misses (+10/−0 and +15/−1 flips), **0 flips on the 10-11 hit prompts it changes per 300** (5% of hits vs r5's ~95%, r4's 9-12%). Wall ≈ 1.3 s (cap 3.24 s), 1.0 calls.
- vs r4 (the other hit-preserving swap): misses better on both sets (S300-2 +10 vs +7, S300-1 +14 net vs +12 net), fewer hit prompts changed (11 vs 25, 10 vs 18). r4's S300-1 lead (+1.7) comes from 2 hit flips on changed hit prompts (noise per the lead's FULL-0 analysis).
- vs r5: r5's S300-2 +1.9 was hit-flip luck (p1 vs r5 hits +2/−5 on r5's 193 changed hit prompts); on misses p3 ≥ r5.
- It is not a +1.5 candidate on its own: the lasting miss-side gain is ≈ +0.6-1.0 weighted. It should stack with other miss-side levers that leave hit prompts unchanged (a5's escalation, dedup).
- What the offline work killed: swapped email in slots 1-4 (slot 1 destroys hit @1; pos 2-4 read worse), depth 50 as such, nomic dense candidates (no AB gain on S300-2), reverse swap in switched contexts (≈ +0.07), unconditional 2nd swap (costs hit AB @5), CE+BM25/header fusions for the pick. The reading-side ideas o8/o10/o13 were not run: o6 showed the source cut is inert and o9's relevance sentence was −0.4, and every hit-prompt change is a ±5% lottery.

Pending at hand-off (03:06): `run S300-1 p2` + grade is still in the GPU queue (behind lead-priority runs); results will land in answers.jsonl / verdicts automatically (`cli2.js report S300-1 r5 gates`, `tools/p-flips.js S300-1 gates p2`).
