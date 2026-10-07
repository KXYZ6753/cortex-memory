# Addendum 4 on TEST: q-det-q1, lite-det-ub, i-det-x1

Tier A (J1 openai/gpt-oss-20b, J2 nvidia/nemotron-3-nano-30b-a3b, adjudicator deepseek/deepseek-v4.1-flash); paired mailbox-cluster bootstrap, B = 10000, seed 20260922. explore2 code hash `afbc5e254fdcded37f25dfc4de157faa3c195ff5c55ce9188f965053e24c0941`.

## Confirmatory (q-det-q1; Holm over Z1, Z2-NI, Z3)

| test | n | arm means | Δ [95% CI] | p | Holm p | label |
|---|---|---|---|---|---|---|
| Z1 e2b(q1) - e2b(P-B), superiority | 600 | 92.7 vs 88.0 | 4.7 [2.0, 7.3] | 0.0004 | 0.0008 | SUPERIOR |
| Z2-NI e2b(q1) - 31b(P-B), non-inferiority at 5 pts | 600 | 92.7 vs 91.7 | 1.0 [-1.7, 3.7] | 0.0001 | 0.0003 | NON-INFERIOR |
| Z3 e2b(q1) - e2b(gates), superiority | 600 | 92.7 vs 92.3 | 0.3 [-1.4, 2.0] | 0.768 | 0.768 | INCONCLUSIVE |

## Secondary (estimates and 95% CIs; unadjusted p; no confirmatory claim)

| test | n | arm means | Δ [95% CI] | p | Holm p | label |
|---|---|---|---|---|---|---|
| Z1 e2b(q1) - e2b(P-B), superiority, own overflow/failures excluded | 600 | 92.7 vs 88.0 | 4.7 [2.0, 7.3] | 0.0004 | – | SUPERIOR |
| Z2-NI e2b(q1) - 31b(P-B), non-inferiority at 5 pts, own overflow/failures excluded | 600 | 92.7 vs 91.7 | 1.0 [-1.7, 3.7] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(q1) - e2b(gates), superiority, own overflow/failures excluded | 600 | 92.7 vs 92.3 | 0.3 [-1.4, 2.0] | 0.768 | – | INCONCLUSIVE |
| Z1 e2b(q1) - e2b(P-B), superiority, J1 only | 600 | 89.3 vs 84.3 | 5.0 [2.1, 7.9] | 0.0008 | – | SUPERIOR |
| Z2-NI e2b(q1) - 31b(P-B), non-inferiority at 5 pts, J1 only | 600 | 89.3 vs 86.2 | 3.2 [0.0, 6.4] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(q1) - e2b(gates), superiority, J1 only | 600 | 89.3 vs 89.5 | -0.2 [-2.2, 1.8] | 0.9174 | – | INCONCLUSIVE |
| e2b(q1) - 31b(P-B), superiority | 600 | 92.7 vs 91.7 | 1.0 [-1.7, 3.7] | 0.5152 | – | INCONCLUSIVE |
| Z1 e2b(lite) - e2b(P-B), superiority | 600 | 92.3 vs 88.0 | 4.3 [1.8, 6.9] | 0.0012 | – | SUPERIOR |
| Z2-NI e2b(lite) - 31b(P-B), non-inferiority at 5 pts | 600 | 92.3 vs 91.7 | 0.7 [-1.8, 3.2] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(lite) - e2b(gates), superiority | 600 | 92.3 vs 92.3 | 0.0 [-1.3, 1.3] | 1 | – | INCONCLUSIVE |
| Z1 e2b(lite) - e2b(P-B), superiority, own overflow/failures excluded | 600 | 92.3 vs 88.0 | 4.3 [1.8, 6.9] | 0.0012 | – | SUPERIOR |
| Z2-NI e2b(lite) - 31b(P-B), non-inferiority at 5 pts, own overflow/failures excluded | 600 | 92.3 vs 91.7 | 0.7 [-1.8, 3.2] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(lite) - e2b(gates), superiority, own overflow/failures excluded | 600 | 92.3 vs 92.3 | 0.0 [-1.3, 1.3] | 1 | – | INCONCLUSIVE |
| Z1 e2b(lite) - e2b(P-B), superiority, J1 only | 600 | 88.7 vs 84.3 | 4.3 [1.5, 7.2] | 0.0028 | – | SUPERIOR |
| Z2-NI e2b(lite) - 31b(P-B), non-inferiority at 5 pts, J1 only | 600 | 88.7 vs 86.2 | 2.5 [-0.7, 5.7] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(lite) - e2b(gates), superiority, J1 only | 600 | 88.7 vs 89.5 | -0.8 [-2.3, 0.5] | 0.3002 | – | INCONCLUSIVE |
| e2b(lite) - e2b(q1) | 600 | 92.3 vs 92.7 | -0.3 [-1.3, 0.7] | 0.6322 | – | INCONCLUSIVE |
| e2b(lite) - e2b(q1), J1 only | 600 | 88.7 vs 89.3 | -0.7 [-2.0, 0.7] | 0.3862 | – | INCONCLUSIVE |
| Z1 e2b(x1) - e2b(P-B), superiority | 600 | 92.3 vs 88.0 | 4.3 [1.7, 7.0] | 0.002 | – | SUPERIOR |
| Z2-NI e2b(x1) - 31b(P-B), non-inferiority at 5 pts | 600 | 92.3 vs 91.7 | 0.7 [-2.1, 3.5] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(x1) - e2b(gates), superiority | 600 | 92.3 vs 92.3 | 0.0 [-1.8, 1.7] | 1 | – | INCONCLUSIVE |
| Z1 e2b(x1) - e2b(P-B), superiority, own overflow/failures excluded | 600 | 92.3 vs 88.0 | 4.3 [1.7, 7.0] | 0.002 | – | SUPERIOR |
| Z2-NI e2b(x1) - 31b(P-B), non-inferiority at 5 pts, own overflow/failures excluded | 600 | 92.3 vs 91.7 | 0.7 [-2.1, 3.5] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(x1) - e2b(gates), superiority, own overflow/failures excluded | 600 | 92.3 vs 92.3 | 0.0 [-1.8, 1.7] | 1 | – | INCONCLUSIVE |
| Z1 e2b(x1) - e2b(P-B), superiority, J1 only | 600 | 88.7 vs 84.3 | 4.3 [1.5, 7.3] | 0.0022 | – | SUPERIOR |
| Z2-NI e2b(x1) - 31b(P-B), non-inferiority at 5 pts, J1 only | 600 | 88.7 vs 86.2 | 2.5 [-0.8, 5.9] | 0.0001 | – | NON-INFERIOR |
| Z3 e2b(x1) - e2b(gates), superiority, J1 only | 600 | 88.7 vs 89.5 | -0.8 [-2.8, 1.1] | 0.4332 | – | INCONCLUSIVE |
| e2b(x1) - e2b(q1) | 600 | 92.3 vs 92.7 | -0.3 [-1.4, 0.7] | 0.6368 | – | INCONCLUSIVE |
| e2b(x1) - e2b(q1), J1 only | 600 | 88.7 vs 89.3 | -0.7 [-1.9, 0.5] | 0.35 | – | INCONCLUSIVE |
| e2b(lite) - e2b(x1) | 600 | 92.3 vs 92.3 | 0.0 [-1.3, 1.3] | 1 | – | INCONCLUSIVE |

## Per arm

| arm | answers (600) | tier-A accuracy | unresolved | overflow | technical | mean ms | p50 | p95 | calls real (all) | paths |
|---|---|---|---|---|---|---|---|---|---|---|
| q-det-q1 | 600 | 92.7 | 0 | 0 | 0 | 2202 | 2133 | 4683 | 5.822 (11.643) | commit 256, commit+g5 138, explore 59, m2 80, m2+g5 67 |
| lite-det-ub | 600 | 92.3 | 0 | 0 | 0 | 1517 | 995 | 4565 | 3.828 (7.657) | commit 470, explore 59, m2+g5 67, m2 4 |
| i-det-x1 | 600 | 92.3 | 0 | 0 | 0 | 1699 | 1254 | 3289 | 4.422 (8.843) | commit 332, commit+g5 209, explore 59 |
| gates | 600 | 92.3 | 0 | 0 | 0 | 744 | 714 | 1099 | 1.01 (1.01) | one-shot 600 |
| e2bPB | 600 | 88.0 | 0 | – | – | – | – | – | – (–) | – |
| b31PB | 600 | 91.7 | 0 | – | – | – | – | – | – (–) | – |

## Energy

| arm | block basis gross / marginal J per answer | per correct | GPU gross J/answer | GPU marginal | CPU J (A / B) | total gross J/answer | **total J per correct** (gross / marginal) | CPU share | runner pid (source, CPU s/answer) |
|---|---|---|---|---|---|---|---|---|---|
| q-det-q1 | 333.48 / 223.01 | 359.9 / 240.7 | 191.4 | 172 | 36.2 / 36.3 | 227.6 | 245.6 / 224.7 | 0.159 | 22488 (manifest, 2.595) |
| lite-det-ub | 228.61 / 161.03 | 247.6 / 174.4 | 134.8 | 121 | 25.6 / 25.8 | 160.4 | 173.7 / 158.8 | 0.16 | 22564 (manifest, 1.522) |
| i-det-x1 | 263.45 / 189.5 | 285.3 / 205.2 | 165.9 | 151.4 | 20.8 / 21 | 186.7 | 202.2 / 186.5 | 0.112 | 14924 (manifest, 0.619) |
| gates | 117.31 / 81.67 | 127.1 / 88.5 | 78.2 | 69.6 | 10.1 / 10.2 | 88.3 | 95.6 / 86.3 | 0.114 | 7268 (detected, 0.147) |
| e2bPB | – | | | | | | | | |
| b31PB | – | | | | | | | | |

Energy: block basis = addendum 3's (CPU package + GPU, a lower bound); attribution = e2.md's (GPU per question window + runner/llama-server/ollama CPU-seconds x this run's J per CPU-second, method A; B = direct share). gates' runner pid is detected (no manifest); set CONFIRM2_GATES_RUNNER_PID to pin it.
