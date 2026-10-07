# Exploration winner on TEST (gates)

Tier A (J1 openai/gpt-oss-20b, J2 nvidia/nemotron-3-nano-30b-a3b, adjudicator deepseek/deepseek-v4.1-flash); paired mailbox-cluster bootstrap, B = 10000, seed 20260922. Code hash `9801148b3056002a9e5cf48b5972acb71cd218cd90ec5b24918d63590254f910`.

| test | n | arm means | Δ [95% CI] | p | Holm p | label |
|---|---|---|---|---|---|---|
| X1 e2b(winner) - e2b(P-B), superiority | 600 | 92.3 vs 88.0 | 4.3 [2.1, 6.6] | 0.0001 | 0.0003 | SUPERIOR |
| X2 e2b(winner) - 31b(P-B), non-inferiority at 5 pts | 600 | 92.3 vs 91.7 | 0.7 [-1.5, 2.9] | 0.0001 | 0.0003 | NON-INFERIOR |
| X2 e2b(winner) - 31b(P-B), superiority | 600 | 92.3 vs 91.7 | 0.7 [-1.5, 2.9] | 0.608 | 0.608 | INCONCLUSIVE |

Secondary:

| test | n | arm means | Δ [95% CI] | p | Holm p | label |
|---|---|---|---|---|---|---|
| X1, J1 only | 600 | 89.5 vs 84.3 | 5.2 [2.5, 7.9] | 0.0001 | – | SUPERIOR |
| X2, J1 only (superiority) | 600 | 89.5 vs 86.2 | 3.3 [0.3, 6.5] | 0.0344 | – | SUPERIOR |
| X1, winner overflow excluded | 600 | 92.3 vs 88.0 | 4.3 [2.1, 6.6] | 0.0001 | – | SUPERIOR |
| X2 NI, winner overflow excluded | 600 | 92.3 vs 91.7 | 0.7 [-1.5, 2.9] | 0.0001 | – | NON-INFERIOR |
| X1 on every TEST question run | 640 | 92.5 vs 87.7 | 4.8 [2.7, 7.0] | 0.0001 | – | SUPERIOR |

Latency (600): mean 744 ms, p50 714, p95 1099; calls/question 1.01; switched 75, retried 6; context overflow 0; unresolved 0.
Energy (lower bound): gross 116.91 J/answer, marginal 82.05 J/answer; per correct: gross 126.6 J, marginal 88.9 J.
