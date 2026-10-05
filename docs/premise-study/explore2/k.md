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

## 2. Variants (`variants/k-agent.js`)

All share one control loop (`expandAgent`). The model makes every decision through tiny constrained outputs; the harness only executes them and keeps the working set.

1. The harness runs the first search on the raw question, as gates does. The first context W0 (5 emails) is the open working set.
2. **Commit check (model).** For each email of W0 in rank order, the model is asked "does this email contain the answer? YES/NO" (w7's probe, clipped to 3,000 chars, 3 tokens). It stops at the first YES, and a YES means answer from W0, which is exactly gates' prompt.
3. **Explore (model)**, only when nothing open is judged answer-bearing:
   - PICK: one number from a 15-line list of unopened candidates (sender | subject | focused excerpt). The pick is opened and checked (YES/NO).
   - SEARCH: after the first NO, the model writes `FROM: … | TO: … | ABOUT: …`. The harness runs a mailbox BM25 search with FTS5 sender/recipient column filters. The results go to the top of the list, then the model picks again.
   - At most 3 opens; it stops at the first YES.
4. **Answer over the working set.** If a YES email was found, it goes first, followed by W0's top 4. With no YES, the answer uses W0's top 4 plus the model's first pick in slot 5. An abstention retries once on the second context, as gates does.

- **k1**: as above.
- **k2**: k1 with a single context-level commit check (one YES/NO over all 5 open emails, same prefix as the answer prompt).
- **k3**: k1 with the explore list ordered by the MiniLM cross-encoder.
- **k4**: k1 plus a weak commit (a YES only below the top result still explores; W0 is kept unless a new YES email is found) plus strict plan parsing. In k1, e2b sometimes echoes the template, e.g. `FROM: <name of the person who wrote the email>`.

## 3. Results

### k1 on S300-2 (J1)

| | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| **k1** | **86.1** | **+1.0 [−0.9, 2.8]** | **46.0** | 89.0 | 1,332 | 4.3 |
| gates | 85.1 | – | 31.0 | 89.0 | 763 | 1.0 |
| a3 (round-1 agent) | 82.7 | −2.3 | 31.0 | 86.5 | 918 | 2.1 |
| a2 (round-1 agent) | 81.5 | −3.5 | 34.0 | 85.0 | 1,057 | 2.2 |

Behaviour (300 q):
- The model stopped on the commit check in 234/300 questions: 181/200 hits (W0 = gates' context, hit answers unchanged: +2/−1 vs gates) and 53/100 misses (24 of them false stops, with no AB email in W0).
- It explored in 66 questions: 159 picks, 50 searches, 157 opens.
- **Selection:** when the list showed an AB email, the model picked it 28/35 times (80%; the frozen agent opened shown gold 41%).
- **Commitment:** the YES on an opened email was AB-correct 16/23 times.

Arena outcomes on misses: found 22 (14 correct, gates 2: +13/−1); explored with no YES found 25 (6 correct, gates 3). In 11 of these misses the AB email was never listed, opened or found by the model's search.

### k2 on S300-2: context-level commit check (rejected)

k2 scored **83.2** (miss 45.0, hit 86.0; Δ vs gates −1.9), at 999 ms and 2.9 calls.
- **Weaker stop signal.** The single YES/NO over all 5 open emails stops on 192/200 hits, but the 8 hits it sends exploring lose 3, because its NO is less sharp than the per-email probe's.
- **Hit answers flip on identical prompts.** On the 192 committed hits the prompt is byte-identical to gates', yet the answers went 170 correct vs 173 for gates (−3). The check call shares the answer prompt's prefix, so Ollama answers from a reused KV cache. That reuse plausibly shifts the numerics of the answer pass; in round 1, e2b was byte-deterministic only on cold, identical prompts.
- **Lesson:** never let a decision call share the answer prompt's prefix. The per-email probe (k1) doesn't, and its committed hits matched gates (+2/−1).
