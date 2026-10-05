# Worker k: agent control loop & commitment (exploration phase 2, round 2)

Prefix `k`. Code: `benchmarks/premise2/explore2/variants/k-*.js`, offline tools `explore2/tools/k-*.js`.

Mission: a genuine e2b agent (the model decides when to stop, which email to open, what to search) that closes the gap to gates.

## 1. Offline evidence (S300-2 stored answers, no GPU; `tools/k-sim.js`, `tools/k-deep.js`)

w7 stores e2b's YES/NO relevance probe (clipped to 3,000 chars) for up to 20 candidates per question, so a commit rule on gates' first context W0 can be simulated exactly (e2b is deterministic: same prompt, same answer).

| S300-2 cell (W0 = gates' first context) | n | gates | w7 | r5 |
|---|---|---|---|---|
| hit, W0[0] YES | 172 | 154 | 155 | 156 |
| hit, some YES in W0 (not first) | 10 | 10 | 9 | 10 |
| hit, no YES in W0 | 18 | 14 | 14 | 15 |
| miss, YES in W0, AB in W0 | 29 | 22 | 20 | 22 |
| miss, YES in W0, no AB in W0 (false stop) | 24 | 4 | 3 | 5 |
| miss, no YES in W0, no AB in W0 | 43 | 1 | 15 | 8 |
| miss, no YES in W0, AB in W0 | 4 | 4 | 3 | 4 |

Policies (weighted / miss / hit): gates 85.1 / 31 / 89.0; w7 85.7 / 41 / 89.0; "stop on any YES in W0 → gates, else w7" **85.9 / 44 / 89.0**; oracle(gates, w7) 87.0 / 46 / 90.0.

- The commit check is sharp where it matters: it stops on 182/200 hits (gates' answer kept byte-identical) and lets 47/100 misses explore, 43 of which gates gets wrong 42 times.
- Explore arena (65 questions with no YES in W0): a2's single model pick (15-line list) picks an answer-bearing email in 13/16 misses where the probes also find one, and 7/12 where the probes don't. Pointing from a list is a decent selector *once the agent knows it must look further*.
- 17 arena misses have no AB email in the 20 candidates; many name the sender ("Louise Kitchen's response", "Kate Symes' email"), so a sender/recipient-filtered mailbox search written by the model is the natural extra tool.
