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

### k3 on S300-2 (cross-encoder-ordered explore list)

k3 scored **86.1** (miss 47.0, hit 89.0; Δ vs gates **+1.1 [−0.8, 2.8]**), at 1,288 ms and 4.3 calls.
- **Better picking.** The model picks the AB email when listed 30/38 times, and a found email is AB 19/24 times (k1: 16/23).
- **Net:** misses gain +1 over k1, hits are the same. The CE ordering helps the pick a little; it is not a second lever.

### k1 replication on S300-1 (second screening set)

| S300-1 | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| **k1** | **85.3** | **+1.4 [−1.1, 4.1]** | 48.0 | 88.0 | 1,150 | 4.2 |
| r4 | 85.6 | +1.7 | 46.0 | 88.5 | 1,232 | 1.0 |
| r5 | 84.3 | +0.4 | 47.0 | 87.0 | 1,233 | 1.0 |
| gates | 83.9 | – | 34.0 | 87.5 | 756 | 1.0 |

The mechanism replicates:
- **Found misses:** 20, of which 15 are correct (gates 3); +12/0.
- **Committed hits:** 177 (+3/−2 vs gates, prompt-level noise).
- **Explored hits:** 22 (+1/−1).
- **Selection:** the model picked a listed AB email 21/31 times.

Pooled over S300-2 and S300-1 (600 q), k1 is **+1.2 weighted** vs gates. All of that comes from misses (+14.5 points), with hits unchanged.

### k4 on S300-2: weak commit (rejected)

k4 scored **85.2** (miss 47.0, hit 88.0; Δ vs gates +0.1), at 1,268 ms and 4.9 calls. A YES below the top result now triggers exploration (34 questions).
- **Misses:** weak-found 13 gained only +1 (4 correct vs gates 3).
- **Hits:** the 2 hits where exploration found a new YES email lost both, because that email was put first.

A YES anywhere in the top 5 is the right stop signal; second-guessing it costs hits. k5 (k4 + k3) was cancelled before running and replaced by k6 (k3 + strict plan parsing + 4 opens).

### Is the selection really the model's? (first pick in the explore step)

| run | lists containing an AB email | model's first pick is AB | harness's #1 is AB | AB listed at position 6+ |
|---|---|---|---|---|
| k1 S300-2 (BM25 + header list) | 34 | **20** | 4 | 16 |
| k3 S300-2 (cross-encoder list) | 35 | **23** | 12 (CE top 1) | 10 |
| k1 S300-1 | 31 | **17** | 7 | 13 |

- **The model's pick beats the harness's top-1 by 2–5×.** It picks the AB email from deep in the list, and its picks spread across all 15 positions.
- **Where the gain comes from:** the model's selection skill, applied only after its own commit check says the open evidence is not enough.

### k3 replication on S300-1

k3 scored **86.6** (miss 47.0, hit 89.5; Δ vs gates **+2.7 [−0.2, 5.8]**), at 1,259 ms and 4.2 calls.
- **Found misses:** +11/0.
- **Explored hits:** +3/0. These are context changes; treat them as noise.

**k3 pooled over S300-2 and S300-1 (600 q): +1.9 weighted vs gates** (S300-2 +1.1, S300-1 +2.7). On S300-2 alone it is below the +1.5 promotion bar; pooled it is above it.

### Confidence-gated agent (n's logprob gate), offline (`tools/k-gated.js`)

The rule: keep gates' answer when n-g5 judged it confident (mean token logprob ≥ −0.1, no hedge, no abstention; 153/300); otherwise use the stored k answer.

| | S300-2 | S300-1 |
|---|---|---|
| gates | 85.1 | 83.9 |
| n-g5 (gate + r5 fallback) | 86.5 | 85.5 |
| k1 | 86.1 | 85.3 |
| gated k1 | 86.3 | 85.4 |
| k3 | 86.1 | 86.6 |
| gated k3 | 86.3 | 86.8 |

- **The gate adds only +0.1–0.3 to k.** The agent's own commit check already protects the confident hits; gating lowers miss accuracy (47 → 43) because confident-but-wrong misses never get to explore.
- **Decision:** no GPU run. The model's YES/NO commit check does the gate's job inside the agent, with no logprob access needed.

## 4. Conclusions

- **Best agent: k3**, a commit-gated "expand, don't replace" agent with a cross-encoder-ordered pick list.
  - S300-2: 86.1 (+1.1 [−0.8, 2.8] vs gates). S300-1: 86.6 (+2.7 [−0.2, 5.8]). Pooled: **+1.9**.
  - 1.26–1.29 s mean wall, 4.2 calls.
  - k1 (BM25 + header list, no cross-encoder) is close: +1.0 / +1.4, pooled +1.2.
- **The agentic gap is closed.** The frozen e2b agent scores ≈37 in pool; round-1 pick agents scored 82–83. k1/k3 score 85–87, above gates on both screening sets and about 10 points above the 31b frozen-protocol agent (75.8 on TEST; a different set, so the comparison is indicative). The model makes every decision: it checks the open evidence (YES/NO), picks what to open, writes the search, and decides when to stop.
- **Why it works:**
  1. **Commitment is moved to a sharp, per-email decision** (YES/NO, about 95 ms). With one, e2b stops on about 90% of hits, and every committed hit is read with gates' exact prompt. That is why hit accuracy matches gates.
  2. **Selection happens only where it is needed.** In the explore step the model picks an AB email from the list 60–65% of the time, against 12–35% for the harness's own top 1.
  3. **A wrong pick is cheap:** the working set keeps W0's top 4, and only a YES-checked email goes first.
- **What failed:**
  - k2, a context-level check (−1.9): it is less sharp, and its prefix sharing with the answer prompt flipped committed hit answers.
  - k4, the weak commit (+0.1): second-guessing a YES below rank 1 cost 2 hits for 1 miss.
  - The logprob gate on top (offline +0.1–0.3): redundant with the commit check.
- **What remains:**
  - Misses are still 46–48 vs the oracle's 82.
    - **False stops** (about 25 misses per 100): e2b says YES to a wrong email in W0, mostly at rank 1, so it can't be told apart from hits.
    - **Never found** (about 11 per 100): the AB email is not in mailbox top 30 + global, and e2b's FROM/TO/ABOUT search rarely surfaces it.
  - Hits stay at e2b's reading ceiling (89), as in round 1.

k6 (k3 + strict plan parsing + 4 opens) was queued but did not start before the time box ended, because lead-priority FULL-0 jobs went first. I cancelled it to keep the GPU free. The code is in `k-agent.js` if wanted; I expect a small effect (≤ +1 miss).
