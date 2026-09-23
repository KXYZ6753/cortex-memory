# Results

Source: `benchmarks/results/premise2/report.md` (generated 2026-09-23; J1 openai/gpt-oss-20b, J2 nvidia/nemotron-3-nano-30b-a3b, adjudicator deepseek/deepseek-v4.1-flash, all via OpenRouter). Points = percentage points; intervals are 95% mailbox-cluster bootstrap CIs. Accuracy is the adjudicated score unless stated.

## Confirmatory

| test | result | label |
|---|---|---|
| H1 (gate): 31b − e2b, both given the gold email | 98.2 vs 96.3 → **+1.8** [0.2, 3.6], p = .040, n = 600 | SUPERIOR (gate passed); not robust under strict/span scoring |
| H2: e2b(E\*) − 31b(B), non-inferiority at −5 | 87.0 vs 91.8 → **−4.8** [−6.9, −2.8], Holm p = .87 | INCONCLUSIVE (CI crosses −5); INFERIOR at a 2.5-pt margin |
| H3: [e2b(E\*) − e2b(B)] − [31b(E\*) − 31b(B)] | **−1.7** [−4.0, 0.8] | INCONCLUSIVE (robust) |
| gap closure (primary estimand) | **−0.26** [−1.40, 0.21] | the tuned pipeline closed none of the gap |

**E\*** = BM25, k = 5, best-last ordering. It won DEV by +1.5 pts over B, then lost on TEST (e2b 86.5 vs 87.5). Pre-registration caught a DEV overfit that post-hoc selection would have reported as a gain.

## The finding worth the paper

Exploratory, post hoc, no Holm adjustment. Every contrast is paired on the same 600 questions.

| contrast | estimate |
|---|---|
| **e2b(oracle) − 31b(B)**: perfect retrieval on 2B vs real retrieval on 31B | **+4.5** [2.0, 7.1], p = .0006 |
| e2b(B) − 31b(B): the deployed gap | −3.8 [−6.1, −1.7] |
| e4b(B) − 31b(B) | −1.2 [−2.9, 0.5] (inconclusive) |
| what retrieval costs e2b: oracle − B | 7.6 [5.4, 9.8] |
| what retrieval costs the 31b | 6.3 [4.2, 8.5] |

**The scale curve at baseline B** (tiny → e2b → e4b → 31b): 47.9 → 87.5 → 90.5 → 91.8. Nearly all of the benefit arrives below 2B.

**Where retrieval loss comes from:**
- BM25's top 5 misses the gold for 51 of the 600 questions.
- Both e2b and the 31b lose ~4.7 pts to those recall misses.
- Dilution (the gold present among 4 others) costs e2b 2.9 pts and the 31b 1.7 pts.
- Accuracy when the gold is retrieved vs not: e2b 91.8 vs 33.3; 31b 96.5 vs 41.2.

**Own-headroom closure**, (E\* − B) / (oracle − B): tiny 0.37 [0.21, 0.51]; e2b −0.14; e4b −0.07; 31b 0.11. Retrieval engineering helps only the weakest reader: the 1b model gains +7.2 pts [3.8, 10.6] from E\*.

## Secondary family (Holm)

| test | result |
|---|---|
| S1: distraction hurts the small model more than the large one | +5.3 [1.9, 8.9], Holm p = .011, SUPERIOR |
| S2: R2 − R0, e2b, threaded emails | −0.6 [−3.3, 2.1] (null, tight) |
| S3: R2 − R0, e4b, threaded emails | 0.0 [−1.9, 1.8] (null, tight) |
| S4: answer-bearing R@5, BM25 − RRF-60 | +4.2 [3.3, 5.1], SUPERIOR |

R2 (thread attribution rendering) was the main novelty candidate; it is a clean null.

**Induced errors with 4 hard distractors** (wrong with distractors, given right on oracle):

| model | rate | distractor copied / fact lost / abstained |
|---|---|---|
| tiny | 39.4% | 66 / 93 / 3 |
| e2b | 8.3% | 14 / 33 / 1 |
| e4b | 2.9% | 6 / 9 / 2 |
| 31b | 2.7% | 1 / 5 / 2 |

With 9 distractors, e2b's rate rises to 11.0%.

## Retrieval (2,957 TEST + retrieval-only questions, answer-bearing recall@5)

| method | recall@5 |
|---|---|
| BM25 | 95.5 |
| BM25 in the asker's own mailbox | 98.1 |
| RRF-60 | 91.3 |
| BM25 + MiniLM rerank | 92.0 (reranking hurts) |
| dense | 79.8 |

R\* = BM25 on DEV (93.5%).

## Exploratory generation (e2b; deltas vs P-B on the J1 basis, since these cells are tier B)

| cell | delta |
|---|---|
| dense k5 | −15.5 |
| RRF k5 | −4.2 |
| k1 | −4.7 |
| k3 | −1.0 |
| k10 | −2.3 |
| rerank k5 | −4.3 |
| gate | −4.7 |
| best-last | +1.3 |
| per-mailbox BM25 | +2.0 [−0.3, 4.4] |
| rephrased question | −4.0 |
| latest message only (RL) | **−43.3** (dropping quoted history destroys answers) |
| gold-informed sentence selection | −18.3 |

**Other controls:**
- Floor (no email): 0–1% for every model, so there is no memorisation.
- Null-perturbation flip rate (the noise floor): 2.0% (oracle), 2.7% (retrieval).
- V1 bridge: V1's tag with V1's template scored 90.0; the QAT tag or the T2 template, 95.0.

## Cost (Windows box; hardware-specific; energy is CPU package + GPU, a lower bound)

| arm | accuracy | ms per answer | ms per correct | J per correct (gross / marginal) |
|---|---|---|---|---|
| e2b oracle | 95.2 | 291 | 306 | 49.5 / 36.2 |
| 31b oracle | 98.2 | 9,073 | 9,243 | 1,299 / 901 |
| e2b B | 87.5 | 566 | 740 | 114 / 86 |
| 31b B | 91.8 | 15,550 | 17,021 | 2,387 / 1,657 |

- **Time ratios:** 31b/e2b on warm answers is ~27–31×; the full pipeline, 31b(B) vs e2b(E\*), is 23.7×.
- **Energy:** the 31b costs ~19× the energy per correct answer, for +3.8 pts.
- **Hardware context:** the 31b runs 23.5% on the GPU (8 GB), decoding at ~3.3 tok/s against e2b's ~177.

## Judging quality

- **J1 vs J2 agreement:** 88.7% raw, κ 0.68 (tier A).
- **What the adjudicator did:**
  - overturned **20%** of consensus-INCORRECT answers to CORRECT, the false-negative pattern V1 showed;
  - resolved 88.6% of disagreements as CORRECT;
  - upheld 98.7% of audited consensus-CORRECT answers;
  - downgraded 128 CORRECTs whose quotes did not verify.
- **Drift:** J1 anchor test-retest 99.5%.
- **Reference errors:** 140 flags, never auto-upgraded.

## V1 pilot reanalysis (`benchmarks/results/v1-pilot-reanalysis.md`)

- **Contamination:** 37/100 of V1's dist4-hard sets carried the answer outside the gold.
- **Distraction on clean sets only:** e2b lost 7.9 (dist4) and 13.3 (dist9) pts; the 31b under 2 pts.
- **Preprocessing:** V1's −4 pts was answer deletion. On the 7 affected questions accuracy fell 71 pts; on the other 93 the change was +1.1.
- **Timing:** warm 31b/e2b ratio 30.5×.

## One correction to know about

Before 2026-09-23 the report compared tier-B cells (J1-only) against the adjudicated baseline, biasing those deltas down by about 4 pts. Fixed in commit `3f661d6`. The confirmatory and headline results were never affected.
