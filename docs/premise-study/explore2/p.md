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

