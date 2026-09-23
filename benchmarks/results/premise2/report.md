# premise2 results

Generated 2026-09-23T04:37:30.911Z. Judges: J1 openai/gpt-oss-20b, J2 nvidia/nemotron-3-nano-30b-a3b, adjudicator deepseek/deepseek-v4.1-flash. E* = k5-bestlast-R0; R* = bm25.

## Confirmatory (adjudicated score; points = percentage points)

| hypothesis | n | arm means | estimate | 95% CI | p | Holm p | label | robust | MDE (80%) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 oracle: 31b - e2b | 600 | 98.2 / 96.3 | 1.8 | [0.2, 3.6] | 0.0398 | – | SUPERIOR | no | 2.5 |
| H2 e2b(E*) - 31b(B), NI margin 5 pts | 600 | 87.0 / 91.8 | -4.8 | [-6.9, -2.8] | 0.873 | 0.873 | INCONCLUSIVE | no | 2.9 |
| H3 DiD [e2b(E*) - e2b(B)] - [31b(E*) - 31b(B)] | 600 | 87.0 / 88.0 / 92.5 / 91.8 | -1.7 | [-4.0, 0.8] | 0.2068 | 0.4136 | INCONCLUSIVE | yes | 3.5 |

Gate (H1) passed; H2 and H3 are Holm-tested.

**Gap closure** (primary estimand): -0.261 [-1.401, 0.214], n = 600.

H2 sensitivity:

- H2 at margin 2.5 pts: -4.8 [-6.9, -2.8] → INFERIOR
- H2 TOST +/-5 pts: -4.8 [-6.9, -2.8] → INCONCLUSIVE
- H2 vs 31b at max(B, E*) = P-Estar: -5.5 [-7.6, -3.4] → INCONCLUSIVE

### Engineering ladder (accuracy, %)

| model | B | R* (bm25 k5) = B | E* | gold-informed selection | oracle |
| --- | --- | --- | --- | --- | --- |
| tiny | 47.9 (J1 47.0, n=955) | 47.9 (J1 47.0, n=955) | 55.1 (J1 52.9, n=955) | – | 67.6 (J1 63.2, n=955) |
| small | 87.5 (J1 83.7, n=955) | 87.5 (J1 83.7, n=955) | 86.5 (J1 83.7, n=955) | 66.3† (J1 66.3, n=300) | 95.2 (J1 91.0, n=955) |
| mid | 90.5 (J1 84.8, n=955) | 90.5 (J1 84.8, n=955) | 90.0 (J1 85.9, n=955) | – | 96.9 (J1 92.3, n=955) |
| large | 91.8 (J1 86.7, n=600) | 91.8 (J1 86.7, n=600) | 92.5 (J1 88.2, n=600) | – | 98.2 (J1 92.8, n=600) |

† tier-B cell, scored by J1 alone: compare it with the J1 values of the other steps.

Own-headroom closure (E* − B)/(oracle − B):

- tiny: 0.365 [0.206, 0.510] (n=955)
- small: -0.137 [-0.426, 0.084] (n=955)
- mid: -0.066 [-0.383, 0.164] (n=955)
- large: 0.105 [-0.129, 0.314] (n=600)

### Scale vs retrieval (exploratory, no Holm adjustment)

| contrast | n | arm means | estimate | 95% CI | p | label |
| --- | --- | --- | --- | --- | --- | --- |
| e2b(oracle) - 31b(B): perfect retrieval on the small model vs real retrieval on the large one | 600 | 96.3 / 91.8 | 4.5 | [2.0, 7.1] | 0.0006 | SUPERIOR |
| e2b(B) - 31b(B): the deployed gap | 600 | 88.0 / 91.8 | -3.8 | [-6.1, -1.7] | 0.0002 | INFERIOR |
| e4b(B) - 31b(B): the deployed gap at the midpoint | 600 | 90.7 / 91.8 | -1.2 | [-2.9, 0.5] | 0.228 | INCONCLUSIVE |
| e2b(oracle) - e2b(B): what retrieval costs the small model | 955 | 95.2 / 87.5 | 7.6 | [5.4, 9.8] | 0.0001 | SUPERIOR |
| 31b(oracle) - 31b(B): what retrieval costs the large model | 600 | 98.2 / 91.8 | 6.3 | [4.2, 8.5] | 0.0001 | SUPERIOR |

## Secondary family (Holm)

| test | n | estimate | 95% CI | p | Holm p | label |
| --- | --- | --- | --- | --- | --- | --- |
| S1 distraction interaction [e2b(oracle-dist4)] - [31b(oracle-dist4)] | 300 | 5.3 | [1.9, 8.9] | 0.0038 | 0.0114 | SUPERIOR |
| S2 R2 - R0, e2b, BM25 k5, threaded | 330 | -0.6 | [-3.3, 2.1] | 0.7338 | 1 | INCONCLUSIVE |
| S3 R2 - R0, e4b, BM25 k5, threaded | 330 | 0.0 | [-1.9, 1.8] | 1 | 1 | INCONCLUSIVE |
| S4 answer-bearing R@5: bm25 - rrf60 | 2957 | 4.2 | [3.3, 5.1] | 0.0001 | 0.0004 | SUPERIOR |

## Accuracy by cell (final score, %; Δ vs natural reference with cluster CI)

| cell | model | n | acc | J1 | strict | span | abstain | Δ vs ref | Δ CI | Δ basis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-B | small | 397 | 84.1 | 80.9 | 70.8 | 77.2 | 5 | – | – | – |
| D-k1-rank-R0 | small | 397 | 78.6 | 78.6 | 72.3 | 72.8 | 22 | -2.3 | [-4.8, 0.3] | j1 |
| D-k3-rank-R0 | small | 397 | 80.3 | 80.3 | 72.3 | 77.2 | 12 | -0.5 | [-3.3, 2.1] | j1 |
| D-k3-rank-R2 | small | 397 | 80.6 | 80.6 | 73.4 | 76.3 | 12 | -0.3 | [-3.3, 2.8] | j1 |
| D-k3-bestlast-R0 | small | 397 | 84.9 | 81.1 | 72.0 | 79.0 | 9 | 0.8 | [-2.3, 3.8] | final |
| D-k3-bestlast-R2 | small | 397 | 80.3 | 80.3 | 74.1 | 77.2 | 12 | -0.5 | [-3.8, 2.8] | j1 |
| D-k5-rank-R0 | small | 397 | 80.9 | 80.9 | 70.8 | 77.2 | 5 | 0.0 | [0.0, 0.0] | j1 |
| D-k5-rank-R2 | small | 397 | 80.9 | 80.9 | 77.3 | 76.3 | 8 | 0.0 | [-2.8, 2.7] | j1 |
| D-k5-bestlast-R0 | small | 397 | 85.6 | 82.1 | 73.0 | 76.3 | 6 | 1.5 | [-2.0, 5.1] | final |
| D-k5-bestlast-R2 | small | 397 | 85.6 | 83.1 | 73.3 | 76.3 | 8 | 1.5 | [-1.0, 3.8] | final |
| D-kgate-rank-R0 | small | 397 | 78.1 | 78.1 | 70.3 | 74.6 | 21 | -2.8 | [-6.2, 0.8] | j1 |
| D-kgate-rank-R2 | small | 397 | 77.8 | 77.8 | 70.8 | 72.8 | 21 | -3.0 | [-6.6, 0.5] | j1 |
| D-kgate-bestlast-R0 | small | 397 | 78.3 | 78.3 | 70.2 | 73.7 | 22 | -2.5 | [-6.3, 1.0] | j1 |
| D-kgate-bestlast-R2 | small | 397 | 78.1 | 78.1 | 70.5 | 72.8 | 23 | -2.8 | [-6.8, 1.0] | j1 |
| P-oracle | tiny | 955 | 67.6 | 63.2 | 53.7 | 65.2 | 17 | – | – | – |
| P-oracle | small | 955 | 95.2 | 91.0 | 81.2 | 85.0 | 5 | – | – | – |
| P-oracle | mid | 955 | 96.9 | 92.3 | 82.9 | 85.4 | 4 | – | – | – |
| P-oracle | large | 600 | 98.2 | 92.8 | 86.0 | 79.8 | 4 | – | – | – |
| P-B | tiny | 955 | 47.9 | 47.0 | 38.4 | 51.3 | 8 | -19.8 | [-23.4, -16.4] | final |
| P-B | small | 955 | 87.5 | 83.7 | 73.9 | 80.6 | 13 | -7.6 | [-9.8, -5.5] | final |
| P-B | mid | 955 | 90.5 | 84.8 | 76.1 | 83.9 | 22 | -6.4 | [-8.3, -4.5] | final |
| P-B | large | 600 | 91.8 | 86.7 | 78.8 | 76.3 | 25 | -6.3 | [-8.5, -4.2] | final |
| S-floor | tiny | 100 | 1.0 | 4.0 | 0.0 | 2.7 | 52 | – | – | – |
| S-floor | small | 100 | 0.0 | 0.0 | 0.0 | 0.0 | 100 | – | – | – |
| S-floor | mid | 100 | 0.0 | 0.0 | 0.0 | 0.0 | 100 | – | – | – |
| S-floor | large | 100 | 0.0 | 0.0 | 0.0 | 0.0 | 100 | – | – | – |
| S-dist4hard | tiny | 599 | 49.8 | 47.8 | 40.7 | 59.3 | 5 | -18.9 | [-23.1, -14.6] | final |
| S-dist4hard | small | 600 | 89.7 | 84.7 | 74.0 | 83.8 | 1 | -6.7 | [-9.1, -4.3] | final |
| S-dist4hard | mid | 600 | 95.2 | 90.2 | 81.8 | 90.2 | 3 | -1.2 | [-2.8, 0.3] | final |
| S-dist4hard | large | 300 | 97.0 | 91.3 | 82.3 | 76.8 | 3 | -2.0 | [-4.2, 0.0] | final |
| S-dist9hard | small | 300 | 87.3 | 84.7 | 72.7 | 85.9 | 0 | -9.3 | [-12.9, -5.6] | final |
| S-dist4rand | small | 300 | 91.0 | 87.0 | 76.3 | 82.8 | 1 | -5.7 | [-8.7, -2.7] | final |
| S-dist4rand | large | 300 | 98.7 | 92.7 | 85.0 | 75.8 | 2 | -0.3 | [-1.0, 0.0] | final |
| S-format-T1 | small | 300 | 93.3 | 88.7 | 78.7 | 75.8 | 0 | -3.3 | [-6.1, -0.7] | final |
| S-null-oracle | small | 300 | 95.3 | 92.7 | 84.3 | 83.8 | 0 | -1.3 | [-3.0, 0.0] | final |
| S-null-B | small | 300 | 87.0 | 83.7 | 72.7 | 78.8 | 4 | -1.3 | [-3.3, 0.4] | final |
| S-oracle-R2 | small | 300 | 96.7 | 93.3 | 82.3 | 82.8 | 1 | 0.0 | [-1.6, 1.7] | final |
| S-oracle-R2 | large | 300 | 97.3 | 93.3 | 87.0 | 76.8 | 3 | -1.7 | [-3.6, 0.0] | final |
| S-R2-B | mid | 600 | 90.7 | 85.0 | 76.8 | 84.4 | 17 | 0.0 | [-1.2, 1.2] | final |
| G-R0-bm25 | small | 600 | 84.3 | 84.3 | 75.2 | 81.5 | 8 | 0.0 | [0.0, 0.0] | j1 |
| G-R0-dense | small | 600 | 68.8 | 68.8 | 63.1 | 70.5 | 63 | -15.5 | [-19.0, -12.1] | j1 |
| G-R0-rrf60 | small | 600 | 80.2 | 80.2 | 74.4 | 77.5 | 15 | -4.2 | [-6.8, -1.7] | j1 |
| G-R1-bm25 | small | 600 | 83.3 | 83.3 | 77.7 | 81.5 | 10 | -1.0 | [-2.8, 1.0] | j1 |
| G-R1-dense | small | 600 | 69.5 | 69.5 | 64.9 | 69.9 | 66 | -14.8 | [-18.5, -11.2] | j1 |
| G-R1-rrf60 | small | 600 | 80.2 | 80.2 | 75.7 | 79.8 | 18 | -4.2 | [-6.9, -1.5] | j1 |
| G-R2-bm25 | small | 600 | 83.2 | 83.2 | 77.6 | 80.3 | 9 | -1.2 | [-3.1, 0.5] | j1 |
| G-R2-dense | small | 600 | 70.2 | 70.2 | 65.2 | 69.9 | 63 | -14.2 | [-17.8, -10.7] | j1 |
| G-R2-rrf60 | small | 600 | 80.8 | 80.8 | 73.7 | 76.9 | 18 | -3.5 | [-6.0, -1.0] | j1 |
| X-bm25-k1 | small | 300 | 80.0 | 80.0 | 76.9 | 74.8 | 12 | -4.7 | [-8.8, -0.7] | j1 |
| X-bm25-k3 | small | 300 | 83.7 | 83.7 | 78.6 | 76.8 | 5 | -1.0 | [-4.0, 1.7] | j1 |
| X-bm25-k10 | small | 300 | 82.3 | 82.3 | 78.8 | 81.8 | 1 | -2.3 | [-5.9, 1.3] | j1 |
| X-bm25rr-k5 | small | 300 | 80.3 | 80.3 | 75.0 | 75.8 | 9 | -4.3 | [-8.1, -0.7] | j1 |
| X-bm25rr-gate | small | 300 | 80.0 | 80.0 | 76.7 | 71.7 | 13 | -4.7 | [-8.5, -0.7] | j1 |
| X-bm25-k5-bestlast | small | 300 | 86.0 | 86.0 | 76.3 | 78.8 | 5 | 1.3 | [-2.3, 4.9] | j1 |
| X-hybv1-k5 | small | 300 | 85.0 | 85.0 | 78.9 | 79.8 | 2 | 0.3 | [-2.1, 2.9] | j1 |
| X-peruser-bm25-k5 | small | 300 | 86.7 | 86.7 | 80.9 | 81.8 | 1 | 2.0 | [-0.3, 4.4] | j1 |
| X-rephrased-bm25-k5 | small | 300 | 80.7 | 80.7 | 75.7 | 78.8 | 5 | -4.0 | [-8.0, 0.0] | j1 |
| X-oracle-RL | small | 300 | 49.3 | 49.3 | 45.4 | 47.5 | 115 | -43.3 | [-49.0, -37.5] | j1 |
| X-goldsel-B | small | 300 | 66.3 | 66.3 | 51.1 | 65.7 | 44 | -18.3 | [-23.6, -13.0] | j1 |
| V1-bridge-T1 | bridge | 100 | 90.0 | 86.0 | 78.0 | 85.7 | 0 | -5.0 | [-10.7, 0.0] | final |
| V1-bridge-T1 | small | 100 | 95.0 | 89.0 | 82.0 | 82.9 | 0 | 0.0 | [-2.9, 2.9] | final |
| V1-bridge-T2 | bridge | 100 | 95.0 | 91.0 | 80.0 | 85.7 | 0 | – | – | – |
| V1-bridge-T2 | small | 100 | 95.0 | 91.0 | 84.0 | 88.6 | 0 | – | – | – |
| P-Estar | tiny | 955 | 55.1 | 52.9 | 45.3 | 60.4 | 4 | 7.2 | [3.9, 10.6] | final |
| P-Estar | small | 955 | 86.5 | 83.7 | 73.0 | 79.8 | 21 | -1.1 | [-2.7, 0.7] | final |
| P-Estar | mid | 955 | 90.0 | 85.9 | 76.5 | 82.0 | 16 | -0.4 | [-2.0, 1.1] | final |
| P-Estar | large | 600 | 92.5 | 88.2 | 80.3 | 76.9 | 25 | 0.7 | [-0.7, 2.0] | final |

"acc" is the final score: adjudicated for tier-A cells, J1 alone for tier-B cells (grid, exploratory, most DEV configs). Deltas involving a tier-B cell are computed on the J1 basis.

Null-perturbation flip rate (noise floor): oracle 2.0% (n=300), retrieval 2.7% (n=300).

## Distraction (induced errors = wrong with distractors | right on oracle)

| cell | model | n | oracle correct | induced | rate | capture / dilution / abstain |
| --- | --- | --- | --- | --- | --- | --- |
| S-dist4hard | tiny | 599 | 411 | 162 | 39.4 | 66 / 93 / 3 |
| S-dist4hard | small | 600 | 578 | 48 | 8.3 | 14 / 33 / 1 |
| S-dist4hard | mid | 600 | 578 | 17 | 2.9 | 6 / 9 / 2 |
| S-dist4hard | large | 300 | 297 | 8 | 2.7 | 1 / 5 / 2 |
| S-dist9hard | small | 300 | 290 | 32 | 11.0 | 11 / 21 / 0 |
| S-dist4rand | small | 300 | 290 | 19 | 6.6 | 0 / 18 / 1 |
| S-dist4rand | large | 300 | 297 | 1 | 0.3 | 0 / 1 / 0 |

## Retrieval (TEST + retrieval-only questions, global scope)

| list | n | strict R@5 | relaxed R@5 | answer R@5 | answer R@5 CI | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| bm25+rr|global|questions | 1457 | 87.5 | 88.5 | 92.0 | [90.7, 93.4] | 0.769 |
| bm25|global|questions | 2957 | 92.4 | 92.8 | 95.5 | [94.6, 96.4] | 0.819 |
| bm25|global|rephrased | 2957 | 88.6 | 89.2 | 91.9 | [90.7, 93.1] | 0.776 |
| bm25|user|questions | 2957 | 96.5 | 96.7 | 98.1 | [97.4, 98.7] | 0.889 |
| dense+rr|global|questions | 1457 | 78.2 | 78.9 | 83.1 | [81.1, 85.2] | 0.694 |
| dense|global|questions | 2957 | 74.4 | 75.3 | 79.8 | [78.2, 81.5] | 0.623 |
| dense|global|rephrased | 2957 | 70.5 | 71.4 | 76.8 | [75.2, 78.4] | 0.593 |
| dense|user|questions | 2957 | 87.1 | 87.3 | 90.0 | [88.6, 91.4] | 0.766 |
| hybv1|global|questions | 2957 | 92.7 | 93.2 | 95.6 | [94.8, 96.4] | 0.813 |
| hybv1|global|rephrased | 2957 | 89.4 | 90.0 | 92.6 | [91.5, 93.7] | 0.773 |
| rrf60+rr|global|questions | 1457 | 86.8 | 87.8 | 91.8 | [90.3, 93.3] | 0.764 |
| rrf60|global|questions | 2957 | 86.9 | 87.8 | 91.3 | [90.2, 92.3] | 0.739 |
| rrf60|global|rephrased | 2957 | 84.2 | 84.9 | 88.4 | [87.2, 89.6] | 0.709 |
| rrf60|user|questions | 2957 | 93.7 | 94.0 | 95.7 | [94.9, 96.5] | 0.843 |

## Judging

- J1 vs J2, tier A: n=17298, raw 88.7%, κ 0.6754, PABAK 0.7744
- J1 vs J2, tier B: n=8104, raw 88.5%, κ 0.5836, PABAK 0.7705
- J1 vs J2, small: n=15083, raw 88.2%, κ 0.5847
- J1 vs J2, tiny: n=3478, raw 88.9%, κ 0.7793
- J1 vs J2, mid: n=4003, raw 88.8%, κ 0.5506
- J1 vs J2, large: n=2638, raw 90.5%, κ 0.498
- J1 vs J2, bridge: n=200, raw 89.0%, κ 0.5851
- adjudication (disagreement): n=2166, CORRECT 88.6%
- adjudication (auditCorrect): n=1699, CORRECT 98.7%
- adjudication (consensusIncorrect): n=3086, CORRECT 20.0%
- unverified CORRECT downgraded: 128; reference-error flags: 140
- anchor drift, session 2026-09-23: agreement 99.5% (n=200)

## Cost (hardware-specific; energy is a lower bound)

| arm | n | acc | gen ms | retrieval ms | pipeline ms / correct | FLOP proxy / correct |
| --- | --- | --- | --- | --- | --- | --- |
| tiny|P-oracle | 955 | 67.6 | 149.2 | 0 | 220.6 | 1.48e+12 |
| small|P-oracle | 955 | 95.2 | 291.3 | 0 | 306.1 | 2.86e+12 |
| mid|P-oracle | 955 | 96.9 | 433.7 | 0 | 447.8 | 5.88e+12 |
| large|P-oracle | 600 | 98.2 | 9073.3 | 0 | 9242.8 | 4.27e+13 |
| tiny|P-B | 955 | 47.9 | 292.7 | 81.5 | 781.9 | 8.82e+12 |
| small|P-B | 955 | 87.5 | 566.3 | 81.5 | 740 | 1.29e+13 |
| mid|P-B | 955 | 90.5 | 905 | 81.5 | 1090.4 | 2.63e+13 |
| large|P-B | 600 | 91.8 | 15549.7 | 81.5 | 17021.2 | 1.90e+14 |
| tiny|P-Estar | 955 | 55.1 | 289.7 | 81.5 | 673.9 | 7.66e+12 |
| small|P-Estar | 955 | 86.5 | 578.1 | 81.5 | 762.6 | 1.31e+13 |
| mid|P-Estar | 955 | 90.0 | 909.2 | 81.5 | 1100.1 | 2.64e+13 |
| large|P-Estar | 600 | 92.5 | 15514.9 | 81.5 | 16860.9 | 1.89e+14 |
| tiny|S-dist4hard | 599 | 49.8 | 291.8 | 0 | 586.6 | 8.27e+12 |
| small|S-dist4hard | 600 | 89.7 | 573.4 | 0 | 639.5 | 1.23e+13 |
| mid|S-dist4hard | 600 | 95.2 | 893.4 | 0 | 938.8 | 2.44e+13 |
| large|S-dist4hard | 300 | 97.0 | 15357 | 0 | 15832 | 1.76e+14 |
- P-oracle 31b/e2b: {"n":600,"ratioOfTotals":31.02,"geometricMeanRatio":30.46,"label":"hardware-specific (the 31b runs largely on CPU on the 8 GB GPU)"}
- P-B 31b/e2b: {"n":599,"ratioOfTotals":27.72,"geometricMeanRatio":27.22,"label":"hardware-specific (the 31b runs largely on CPU on the 8 GB GPU)"}
- pipeline 31b(B) / e2b(E*): {"ratio":23.7,"perCorrect":22.32}

Energy: CPU package + GPU only: a lower bound (DRAM, board and PSU losses are missing, which understates the CPU-bound 31b most).

- small|D-B: gross 123.2 J/correct, marginal 92.2 J/correct
- small|D-k1-rank-R0: gross 61.5 J/correct, marginal 44.5 J/correct
- small|D-k3-rank-R0: gross 98.1 J/correct, marginal 73.8 J/correct
- small|D-k3-rank-R2: gross 94.3 J/correct, marginal 69.9 J/correct
- small|D-k3-bestlast-R0: gross 88.5 J/correct, marginal 66 J/correct
- small|D-k3-bestlast-R2: gross 95 J/correct, marginal 70.8 J/correct
- small|D-k5-rank-R2: gross 129.8 J/correct, marginal 98.4 J/correct
- small|D-k5-bestlast-R0: gross 120 J/correct, marginal 90.5 J/correct
- small|D-k5-bestlast-R2: gross 122.1 J/correct, marginal 92 J/correct
- small|D-kgate-rank-R0: gross 84.6 J/correct, marginal 63.1 J/correct
- small|D-kgate-rank-R2: gross 73.9 J/correct, marginal 54.6 J/correct
- small|D-kgate-bestlast-R0: gross 91 J/correct, marginal 67.9 J/correct
- small|D-kgate-bestlast-R2: gross 94.3 J/correct, marginal 70.6 J/correct
- small|P-oracle: gross 49.5 J/correct, marginal 36.2 J/correct
- small|P-B: gross 114.3 J/correct, marginal 86.2 J/correct
- small|S-floor: gross – J/correct, marginal – J/correct
- small|S-dist4hard: gross 112.8 J/correct, marginal 84.9 J/correct
- small|S-dist9hard: gross 187.1 J/correct, marginal 142.6 J/correct
- small|S-dist4rand: gross 102 J/correct, marginal 76.8 J/correct
- small|S-format-T1: gross 36.8 J/correct, marginal 27 J/correct
- small|S-null-oracle: gross 48.2 J/correct, marginal 35.2 J/correct
- small|S-null-B: gross 111.5 J/correct, marginal 83.8 J/correct
- small|S-oracle-R2: gross 49.5 J/correct, marginal 36.3 J/correct
- small|G-R2-bm25: gross 122.6 J/correct, marginal 92.4 J/correct
- small|V1-bridge-T1: gross 37.8 J/correct, marginal 28 J/correct
- small|V1-bridge-T2: gross 50.5 J/correct, marginal 37.2 J/correct
- tiny|P-oracle: gross 34.5 J/correct, marginal 24.3 J/correct
- tiny|P-B: gross 106.1 J/correct, marginal 77.4 J/correct
- tiny|S-floor: gross 1193 J/correct, marginal 851 J/correct
- tiny|S-dist4hard: gross 102.1 J/correct, marginal 74.4 J/correct
- mid|P-oracle: gross 78.4 J/correct, marginal 59.2 J/correct
- mid|P-B: gross 188.7 J/correct, marginal 145.8 J/correct
- mid|S-floor: gross – J/correct, marginal – J/correct
- mid|S-dist4hard: gross 177.1 J/correct, marginal 137 J/correct
- mid|S-R2-B: gross 193.8 J/correct, marginal 149.9 J/correct
- bridge|V1-bridge-T1: gross 40.7 J/correct, marginal 29.9 J/correct
- bridge|V1-bridge-T2: gross 50.5 J/correct, marginal 37.8 J/correct
- small|X-goldsel-B: gross 81.7 J/correct, marginal 60.2 J/correct
- small|G-R0-dense: gross 128.1 J/correct, marginal 96.2 J/correct
- small|G-R0-rrf60: gross 117.1 J/correct, marginal 88 J/correct
- small|G-R1-bm25: gross 111.5 J/correct, marginal 83.6 J/correct
- small|G-R1-dense: gross 118.7 J/correct, marginal 89 J/correct
- small|G-R1-rrf60: gross 110 J/correct, marginal 82.5 J/correct
- small|G-R2-dense: gross 128.7 J/correct, marginal 96.8 J/correct
- small|G-R2-rrf60: gross 118 J/correct, marginal 88.7 J/correct
- small|X-bm25-k1: gross 55.1 J/correct, marginal 40.5 J/correct
- small|X-bm25-k3: gross 87.1 J/correct, marginal 65 J/correct
- small|X-bm25-k10: gross 204.3 J/correct, marginal 156.1 J/correct
- small|X-bm25rr-k5: gross 120.5 J/correct, marginal 90.8 J/correct
- small|X-bm25rr-gate: gross 77.2 J/correct, marginal 57.3 J/correct
- small|X-bm25-k5-bestlast: gross 115.3 J/correct, marginal 86.8 J/correct
- small|X-hybv1-k5: gross 117.9 J/correct, marginal 88.8 J/correct
- small|X-peruser-bm25-k5: gross 111 J/correct, marginal 83.4 J/correct
- small|X-rephrased-bm25-k5: gross 125.9 J/correct, marginal 94.5 J/correct
- small|X-oracle-RL: gross 62.9 J/correct, marginal 45.6 J/correct
- large|S-floor: gross – J/correct, marginal – J/correct
- large|P-oracle: gross 1298.8 J/correct, marginal 901.2 J/correct
- large|P-B: gross 2387 J/correct, marginal 1656.8 J/correct
- large|P-Estar: gross 2357.8 J/correct, marginal 1637.3 J/correct
- small|P-Estar: gross 120.2 J/correct, marginal 90.4 J/correct
- tiny|P-Estar: gross 93 J/correct, marginal 67.1 J/correct
- mid|P-Estar: gross 194.7 J/correct, marginal 149.1 J/correct
- large|S-dist4hard: gross 2264.4 J/correct, marginal 1567.1 J/correct
- large|S-oracle-R2: gross 1359.7 J/correct, marginal 940.9 J/correct
- large|S-dist4rand: gross 2057.6 J/correct, marginal 1420.4 J/correct

## Deviations from PREREG

**2026-09-23 — TEST grading runs on OpenRouter instead of Ollama Cloud.** The account's Ollama tier serialises cloud calls (J1 alone would take about 26 h for 15,463 calls) and returns HTTP 402 for every third-family adjudicator. TEST grading therefore runs through OpenRouter:

- J1 `openai/gpt-oss-20b` and J2 `nvidia/nemotron-3-nano-30b-a3b`: the same models as pre-registered, a different host. OpenRouter routes a model across providers, so the serving stack is not fixed; this is disclosed rather than controlled.
- Adjudicator `deepseek/deepseek-v4.1-flash`: the newer revision of the chain's first entry (`deepseek-v4-flash`), still a third family relative to J1 and J2, and about 5x faster here than the older revision.
- DEV answers are re-judged on the same OpenRouter J1 so DEV and TEST are comparable. **E\* is not re-selected**: it was chosen during the run from the Ollama-hosted J1 verdicts, as pre-registered, and that selection stands.
- Judge calls send `reasoning.exclude`, so a model's reasoning is not returned as content. A verdict that still fails to parse is retried once without the JSON-format and reasoning options.
