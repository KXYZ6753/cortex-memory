# Worker t: understanding and simplifying x1 (round 3)

Prefix `t`. Code: `benchmarks/premise2/explore2/variants/t-ladder.js`. Offline tools: `explore2/tools/t-ladder.js` (ladder table: J1, Δ with a paired stratified bootstrap CI, wall p50/p95/max, calls, gold-read), `t-steps.js` (x1 cost and accuracy by step), `t-explore.js` (explore anatomy), `t-sim.js` (handover substitutions).

Mission:
1. An ablation ladder from the frozen plain-text agent (≈37 in pool) to x1, adding one component per rung.
2. x1's run-to-run variation, wall-time distribution and calls.
3. A simpler or cheaper x1 that keeps its accuracy.

## 1. Ladder design

Rungs that are already stored on S300-2 and S300-1 are reused. Only the missing interface rungs (t1–t3) and the frozen agent on S300-2 are new runs.

| rung | id | component added | source |
|---|---|---|---|
| 0 | `agent` | frozen premise2-agent-v1: text SEARCH/OPEN/ANSWER, global BM25, 10 snippet results (first 200 chars), opens ≤3, 5 rounds, the agent's own answer | new run (S300-2) |
| 1 | `t1` | + native tool calls (search/open/answer); everything else frozen | new |
| 2 | `t2` | + top 3 results of each search shown in full (3,500 chars) | new |
| 3 | `t3` | + separate sandwich answer call over the emails seen in full (≤5) | new |
| 4 | `g5` | + small-model hygiene: mailbox-only search, query-focused previews, 3 tool calls, empty-turn re-ask, gates fallback / abstain retry | stored |
| 5 | `g2` | + harness runs the first search (gates' context in full + 10 previews); the agent decides by tool call | stored. g2 also offers search_all, but it never searched, and its re-ask variant g6 had byte-identical agent turns, so g2 ≡ "g5 with gates start" |
| 6 | `k1` | the tool-turn decision is replaced by a per-email YES/NO commit check (stop at first YES → gates' answer); no YES → model list pick + check, FROM/TO/ABOUT search, ≤3 opens | stored |
| 7 | `k3` | + cross-encoder-ordered pick list | stored |
| 8 | `x1` | + logprob handover: a committed but unsure answer (mean token logprob < −0.1) goes to the g5 agent | stored |
| ref | `gates` | the harness only: the same first search and prompt, no model decisions (= k1 with exploration disabled) | stored |

## 2. Offline findings on stored x1 (S300-2 / S300-1)

**Cost by step** (`t-steps.js`):

| step | n (S2 / S1) | wall ms | calls | hit acc | miss acc |
|---|---|---|---|---|---|
| commit, confident (gates' answer kept) | 130 / 141 | 937 / 1,031 | 2.2 | 101/109, 103/110 | 13/21, 16/31 |
| commit, unsure → g5 | 104 / 99 | 2,312 / 2,685 | 6.1 | 63/72, 59/67 | 13/32, 14/32 |
| explore, found | 24 / 21 | 2,238 / 2,588 | 8.9 | 1/1, 1/1 | 15/23, 15/20 |
| explore, nofound | 41 / 39 | 3,102 / 3,438 | 13.0 | 12/17, 18/22 | 6/24, 4/17 |

- **The g5 handover adds nothing on S300-2.** On the handed-over questions x1 equals k3 exactly (hits 63, misses 13). On S300-1 it adds hits +2 and misses +1.
- The handover costs about +1.4 s on 35% of questions, roughly 480 ms per question on average.
- The commit check stops at rank 0 in 200 of 234 commits.

**Explore anatomy** (`t-explore.js`):

| finds | S300-2 | S300-1 |
|---|---|---|
| total | 24 | 21 |
| at the first pick (open 1), before any model search | 19 (14 correct) | 16 (14 correct) |
| at open 2 or 3 | 5 (2 correct misses) | 5 (2 correct) |
| from the model's FROM/TO/ABOUT search | 1 (wrong) | 2 (1 correct, also in the first list) |

- **The model-written search contributes nothing measurable.**
- The extra opens cost about 5 calls per nofound episode, and nofound episodes are the most expensive path (13 calls, 3.1–3.4 s).

**Handover substitutes** (`t-sim.js`). This replaces the in-run g5 answer on x1's commit-unsure questions with stored answers. Every substitute lands within about ±1 weighted of x1, with flips splitting about evenly:

| substitute | S300-2 | S300-1 |
|---|---|---|
| gates' own answer (= k3) | 86.1 | 86.6 |
| stored g5 | 86.9 | 88.2 |
| r5 | 86.7 | 85.9 |
| p3 | 85.8 | 86.9 |
| o4 | 86.3 | 86.1 |

- Even g5 against g5 is not stable: the stored g5 run and the g5 run inside x1 differ by 6 flips on the same 104 questions.
- **There is no cheaper handover that is systematically better**, because the handover itself is noise-level.

**Batched YES/NO check: not pursued.** 86% of commits stop at the first probe, at about 150 ms per probe. A single 5-email decision call would read about 5× the prompt tokens on the 78% commit path, so it would cost more wall time than it saves. It would save calls only on the explore path, about 4 small calls on 22% of questions. k2, a context-level check, also showed that the single check is less sharp.

**Simplified candidates** (both reuse x1's exact probe and answer calls):
- `t-lx`: x1 with lean explore, meaning one CE-list pick plus a YES/NO check, no model search, and no 2nd or 3rd open.
- `t-lk`: t-lx without the handover. This is the minimal agent: commit check, then one pick.
- Expected: t-lx ≈ x1 − 0.2 and t-lk ≈ k3 − 0.2 (losing the ~2 open-2/3 misses per set), at roughly −170 ms and −1.2 calls (t-lx) or −650 ms and −2.5 calls (t-lk).

## 3. x1 run-to-run variation (S300-2)

`t-x1r` is x1's code under a new id, re-run on S300-2 (Mon 22:40 ET), checked with `tools/t-repro.js`.

**It is byte-identical to the stored x1 run on 300/300 questions.** That covers the answer text, the route taken (step), and the final context. The verdicts are the same (86.1; miss 47, hit 89.0).

- Wall time: 1,904 ms vs 1,820 ms for the stored run, which is ±5% timing noise.
- Calls: 5.59 in both runs.

**What this means:** e2b on this box is deterministic for an identical call sequence, including the logprob probes and the native-tools sub-agent. The noise noted in BRIEF and x.md is a different effect. It comes from changing the call sequence, through Ollama's prompt or KV cache and batch numerics:
- **The same g5 agent run in two contexts disagrees.** Run inside x1 (after the probes) vs on its own, it gives the same answer text on only 61/104 questions. Verdict flips vs stored g5 on S300-2 are hits 2 and misses 4, about ±0.6 weighted.
- **k3 vs x1 agrees wherever the call prefix is shared.** On the 196 questions where both take the same path, the answers are identical; all 104 differences sit on the handover path.

So the honest uncertainty for x1 is not "re-run noise" (which is zero here). It is "any change elsewhere in the call sequence re-rolls the affected answers": about 5% of texts flip, and verdicts move about ±1 point per 100 rerolled questions. Between-set sampling noise, with CIs of about ±2–3 on 300 questions, dominates.

## 4. Simplified x1, S300-2 (J1)

| id | weighted | Δ vs x1 [95% CI] | miss | hit | wall ms (p50 / p95 / max) | calls (p95) | gold read |
|---|---|---|---|---|---|---|---|
| x1 | 86.1 | – | 47.0 | 89.0 | 1,820 (1,917 / 3,356 / 4,326) | 5.59 (13) | 81.0% |
| t-x1r (x1 re-run) | 86.1 | +0.0 [0, 0] | 47.0 | 89.0 | 1,904 (1,954 / 3,530 / 4,472) | 5.59 (13) | 81.0% |
| **t-lx** (lean explore + g5 handover) | 86.1 | −0.1 [−0.3, 0.0] | 46.0 | 89.0 | 1,681 (1,839 / 2,986 / 3,684) | 4.84 (8) | 80.3% |
| **t-lk** (lean explore, no handover) | 86.1 | −0.1 [−2.0, 1.9] | 46.0 | 89.0 | 1,204 (958 / 2,415 / 3,309) | 3.52 (8) | 81.7% |
| k3 (ref) | 86.1 | +0.0 [−1.9, 2.0] | 47.0 | 89.0 | 1,288 (905 / 3,244 / 4,278) | 4.28 (13) | 82.3% |

`t-repro.js` confirms both simplified variants are byte-identical to their parents on every path the simplification does not touch:
- **t-lx vs x1:** 295/300 identical texts and contexts.
- **t-lk vs k3:** 294/300 identical texts (all 130 commits, all 103 unsure commits but one, and every found/nofound path).

The only changed questions are the 5 episodes where x1 found the YES email at open 2 or 3. Those became nofound (W0 top 4 + first pick), losing 1 miss.

As predicted:
- The model's FROM/TO/ABOUT search plus opens 2–3 are worth about 1 miss per 100 (≈ 0.07 weighted).
- Dropping them saves about 140 ms and 0.75 calls per question, and cuts the worst case from 13–14 calls to 8–9.
- Dropping the handover as well (t-lk) saves 620 ms (−34%) and 2.1 calls (−37%) vs x1, at an identical score on this set.

### x1 replicate on S300-1 and simplified variants on S300-1 (J1)

**t-x1r on S300-1 is byte-identical to the stored x1 again (300/300 texts, steps and contexts).** Across both sets x1 reproduces on **600/600** questions. Run-to-run variation of x1 under an identical call sequence is **0.0 points**.

| S300-1 | weighted | Δ vs x1 [95% CI] | miss | hit | wall (p50 / p95 / max) | calls (p95) |
|---|---|---|---|---|---|---|
| x1 | 87.7 | – | 49.0 | 90.5 | 1,999 (1,971 / 3,919 / 5,361) | 5.41 (13) |
| t-x1r | 87.7 | +0.0 [0, 0] | 49.0 | 90.5 | 1,771 (1,880 / 3,172 / 4,498) | 5.41 (13) |
| **t-lx** | 87.5 | −0.1 [−0.3, 0.0] | 47.0 | 90.5 | 1,643 (1,734 / 2,882 / 4,543) | 4.69 (8) |
| t-lk | 86.1 | −1.6 [−4.9, 2.2] | 46.0 | 89.0 | 1,177 (959 / 2,284 / 3,078) | 3.47 (8) |
| k3 | 86.6 | −1.1 [−3.9, 2.2] | 47.0 | 89.5 | 1,259 | 4.17 |

**t-lx vs x1 on S300-1:**
- 292/300 identical texts.
- Every change is on the 5 open-2/3 finds (−2 misses).
- One commit-g5 question became commit: its handover-or-not flag flipped on a logprob near τ.

**t-lk vs k3 on S300-1:** 294/300 identical texts (−1 miss on an open-2/3 find, −1 hit on a nofound).

**Cache side-effect.** On S300-1, x1's own commit-path texts match t-lk and k3 on only 106/127 questions, and 22 questions changed route between unsure and sure. t-lk issues exactly x1's probe and commit-answer calls, but it never runs the g5 sub-agent. So the g5 calls on earlier questions perturb later questions' commit answers through Ollama's cache. This is a sequence effect, not a run-to-run effect.

### Pooled S300-2 + S300-1 (600 q; Δ vs x1, paired stratified bootstrap)

| id | weighted | Δ vs x1 [95% CI] | miss | hit | wall (p50 / p95 / max) | calls (p95 / max) |
|---|---|---|---|---|---|---|
| x1 | 86.9 | – | 48.0 | 89.8 | 1,910 (1,939 / 3,634 / 5,361) | 5.50 (13 / 14) |
| t-x1r | 86.9 | 0.0 [0, 0] | 48.0 | 89.8 | 1,837 (1,920 / 3,387 / 4,498) | 5.50 (13 / 14) |
| **t-lx** | **86.8** | **−0.1 [−0.2, 0.0]** | 46.5 | 89.8 | **1,662** (1,809 / 2,895 / 4,543) | **4.76** (8 / 10) |
| t-lk | 86.1 | −0.8 [−2.5, 0.9] | 46.0 | 89.0 | 1,191 (959 / 2,378 / 3,309) | 3.50 (8 / 9) |
| k3 | 86.4 | −0.5 [−2.1, 0.9] | 47.0 | 89.3 | 1,273 | 4.22 |
| gates | 84.5 | −2.5 [−4.5, −0.4] | 32.5 | 88.3 | 759 | 1.03 |

## 5. The ablation ladder (J1, weighted; `tools/t-ladder.js`)

Each rung adds one component to the rung above. "Step Δ" is the paired Δ vs the previous rung (stratified bootstrap 95% CI), shown for S300-2 / S300-1 / pooled. Gold read = the gold email (or its twin) is among the emails the answer was generated from; for own-answer agents, that means every email seen in full. Shown → read = of the episodes where the gold was shown in any form, how often it was read in full.

| # | rung (id) | component added | S300-2 | S300-1 | pooled W (miss / hit) | step Δ pooled [CI] (S2 / S1) | wall ms | calls | gold read | shown→read |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | frozen agent (`agent`) | text SEARCH/OPEN/ANSWER | 41.6 | 36.8 | 39.2 (11.5 / 41.3) | – | 946 | 2.87 | 32.5% | 44% |
| 1 | `t1` | native tool calls | 57.7 | 54.9 | 56.3 (16.0 / 59.3) | **+17.1 [12.3, 22.6]** (+16.1 / +18.0) | 869 | 3.03 | 48.0% | 63% |
| 2 | `t2` | top-3 results in full, not snippets | 79.1 | 79.7 | 79.4 (13.0 / 84.3) | **+23.1 [18.2, 28.1]** (+21.4 / +24.8) | 974 | 3.03 | 65.8% | 86% |
| 3 | `t3` | separate sandwich answer call | 80.0 | 82.6 | 81.3 (13.5 / 86.3) | +1.9 [−1.2, 4.4] (+0.9 / +2.9) | 1,430 | 4.03 | 65.8% | 86% |
| 4 | `g5` | mailbox-only search + focused previews + hygiene | 84.9 | 86.0 | 85.4 (43.5 / 88.5) | **+4.1 [2.0, 6.9]** (+4.8 / +3.4) | 1,477 | 3.83 | 79.5% | 91% |
| 5 | `g2` | harness runs the first search (gates' context in full) | 85.0 | 84.3 | 84.7 (39.0 / 88.0) | −0.8 [−2.1, 1.2] (+0.1 / −1.7) | 1,656 | 2.66 | 79.3% | 90% |
| 6 | `k1` | per-email YES/NO commit check + model list-pick explore | 86.1 | 85.3 | 85.7 (47.0 / 88.5) | +1.0 [−0.2, 2.9] (+1.1 / +0.9) | 1,241 | 4.25 | 82.0% | 97% |
| 7 | `k3` | CE-ordered pick list | 86.1 | 86.6 | 86.4 (47.0 / 89.3) | +0.7 [0.0, 1.4] (+0.1 / +1.3) | 1,273 | 4.22 | 82.0% | 97% |
| 8 | **`x1`** | logprob handover of unsure commits to g5 | 86.1 | 87.7 | **86.9** (48.0 / 89.8) | +0.5 [−0.9, 2.1] (+0.0 / +1.1) | 1,910 | 5.50 | 81.2% | 93% |
| – | `t-lx` (simplified x1) | − model search, − opens 2–3 | 86.1 | 87.5 | 86.8 (46.5 / 89.8) | −0.1 [−0.2, 0.0] vs x1 | 1,662 | 4.76 | 80.5% | 93% |
| ref | `gates` | harness only, no model decisions (= k1 without explore) | 85.1 | 83.9 | 84.5 (32.5 / 88.3) | k1 vs gates +1.2 [0.0, 3.1] | 759 | 1.03 | 76.3% | 100% |

Behaviour notes:
- **Frozen agent:**
  - It answers from snippets without opening anything in 130/300 episodes (S300-2).
  - It opens the shown gold in 44% of episodes; the main study reported 41%.
  - It makes 1.3 searches per episode and 3 protocol errors in 300 episodes. The protocol is parsed fine; the decisions are the problem.
- **t1 (native tools):**
  - The same information and budget as the frozen agent give a clean search > open > answer in 278/300 episodes. It always opens before answering.
  - Shown → read rises from 44% to 63%.
  - Accuracy is still low (56): it opens from 200-character email starts, which are a poor basis for choosing.
- **t2 (top 3 results in full):** this makes "reading the top results" free. Hits jump from 59 to 84, and shown → read reaches 86%.
- **t3 (separate sandwich answer):**
  - It helps a little (+1.9 pooled, CI includes 0), mostly on hits.
  - It costs one extra call (+460 ms).
- **g5 (mailbox scoping and hygiene):**
  - The gain is almost entirely on misses (13.5 → 43.5). Searching the asker's own mailbox lifts gold read from 66% to 80%.
  - This step bundles mailbox-only search, query-focused previews, a 3-call cap, the empty-turn re-ask, and gates' fallback and abstain retry. g notes that g5 had no fallbacks (300/300 own queries), so mailbox scoping is the active part.
- **g2 (harness first search):** on its own this adds nothing (−0.8). Given a full context, e2b rarely leaves it (0 searches; it reads a bearing preview in only about 1/3 of misses).
- **k1 (commit check + explore):**
  - Moving the stop decision to per-email YES/NO is what pays (k1 vs g2 +1.0; k1 vs gates +1.2 [0.0, 3.1]). Shown → read becomes 97%.
  - The CE list (+0.7) and the handover (+0.5) are each within noise. The handover is +0.0 on S300-2 and +1.1 on S300-1, and it adds +640 ms and +1.3 calls.

## 6. Conclusions for the paper

1. **"Scaffolding closes e2b's agentic gap" holds, and it decomposes cleanly.** The gap from the frozen agent (39) to x1 (87), about 48 points, splits as follows:
   - **Interface: about 40 points.**
     - Native tool calls: +17. The model actually opens emails instead of answering from snippets.
     - Showing the top results in full: +23. Reading costs no decision.
   - **Retrieval scope: about 4 points.** Searching the asker's mailbox; this is entirely on misses.
   - **Answer formatting: about 2 points.** A separate sandwich answer call over what was read.
   - **Control: about 2.2 points over g5.** The per-email YES/NO commit check with list-pick explore (+1.0 over a gates-start agent, +1.2 over gates), the CE list (+0.7), and the handover (+0.5). Only the commit check is individually reliable, and even it sits at the edge of significance on 600 questions.
2. **For e2b, the agent's failure was the interface, not reasoning.** Through a structured channel with full-text results, the same 2B model is a competent agent (g5: 85.4, at gates' level). Every model decision after that is a small, constrained choice: YES/NO, pick a number, call a tool.
3. **What does not matter:** the model-written FROM/TO/ABOUT search, opens 2–3, a harness-run first search, and the choice of handover target. Each is worth ≤ 1 miss per 100 or is a coin flip.
4. **x1 is fully deterministic run-to-run** (600/600 byte-identical). Its measured edge over k3 (+0.5) comes from re-rolled answers on the handover path. The sub-agent's calls also shift *other* questions' answers through the prompt cache (x1's S300-1 commit texts match k3 and t-lk on only 106/127). Report x1 vs k3 as a tie, and x1 vs gates as the robust result: +2.5 [0.4, 4.5] pooled on the screening sets, and lead confirmations of +2.3 (S300-3) and +1.3 (FULL-1).
5. **Simplest form for the paper:**
   - **t-lk** (≈ k3; S300-2 86.1, S300-1 86.1; pooled −0.8 [−2.5, 0.9] vs x1). The agent does two things: checks the open top results one by one (YES/NO), and if none answers, picks one email from a CE-ordered list. It needs 1,191 ms and 3.5 calls (worst case 9).
   - **t-lx** if the handover is kept. It is accuracy-identical to x1 (−0.1 [−0.2, 0.0]) at −13% wall and −0.74 calls, with the worst case down from 14 calls to 10 and p95 wall from 3.6 s to 2.9 s.

## 7. Recommendation

- **Best simplified id: `t-lx`.**
  - Pooled vs x1: −0.1 [−0.2, 0.0]. It loses 3 misses out of 200 (the open-2/3 finds) and is otherwise byte-identical to x1.
  - Wall 1,662 vs 1,910 ms, calls 4.76 vs 5.50, max calls 10 vs 14.
  - It does not meet the formal "Δ ≥ 0 at clearly lower cost" bar (−0.1), so it is not a promotion candidate. It is the cheaper equivalent if the lead wants one.
- **For the paper's minimal agent: `t-lk`.** At −38% wall and −36% calls vs x1, it sits within the CI of x1 (−0.8 [−2.5, 0.9]) and at k3's level.
- **No variant beat x1 by ≥ +1.0.**
