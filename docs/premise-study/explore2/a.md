# Worker a: agent & hybrid (exploration phase 2)

Prefix `a`. Code: `benchmarks/premise2/explore2/variants/a-*.js`, offline tools `benchmarks/premise2/explore2/tools/a-*.js`.

## 1. Failure data behind the designs (offline, no GPU)

### gates on FULL-0 (`tools/a-fail.js`, `tools/a-signal.js`)

- 463/600 correct (weighted 86.8). Wrong: 137 = **5 abstentions** (all miss) + **132 confident wrong** (89 miss, 43 hit). Abstention is almost never the failure mode: only 8/600 answers came from the second context, none correct.
- Where the evidence was for the confident-wrong answers: in the final context 63 (21 miss / 42 hit; 9.7 weighted pts), only in the other gates context 15, in the asker's mailbox top 20 but never shown 34 (all miss; 1.5 pts), nowhere in either top 20 20 (0.9 pts).
- So abstention-triggered escalation can touch at most 5 questions (0.2 pts). A trigger needs another signal.
- "Unsupported answer" check (answer's novel words / critical spans found in the shown emails): does not separate. wordShare < 0.7 fires on 20/132 wrong and 39/463 correct. Wrong answers are copied faithfully from the wrong email.
- Attribution (the shown email holding most of the answer's novel words) is answer-bearing for 37/43 wrong hits: hit errors are reading/distraction errors on the right email. Signals on the attributed email: question-word coverage < 0.4 fires 36 (18/89 wrong misses, but also 9 right misses and 8 right hits); name coverage is near 1 for nearly everything (the asker's mailbox mentions the asker's people). No cheap trigger reaches the 34 "in mailbox top 20, never shown" misses with good precision.
- gates vs oracles (gold email alone, sandwich), FULL-0 paired: hit 21 gates-wrong/oracle-right vs 13 the reverse (+8/450 → about +1.7 weighted if a step could read hits like the oracle); miss 70 vs 3.

### Frozen tool agent agent@1 on FULL-0 (`tools/a-agentfail.js`)

- 192/600 correct. 202 episodes answered without opening any email (13 correct): e2b answers from 200-char snippets. Evidence shown but never opened in 277 (18 correct). When the evidence was opened: 171/215 correct (80%). Mean 1.27 searches, first query 5.6 content words (it compresses the question and drops the distinctive terms); 68 abstentions; protocol errors rare (7).
- fba/fbb/auto2 (S100-1): 43–44/100; fba never searches (86/100 answered directly); fbb/auto2 leave the evidence shown-not-opened in 15–17.
- Conclusion: e2b cannot run the free-form protocol, but it reads well once the right email is open. Design rule: the harness writes the queries (from the question), the model only points (a number, or MORE/NONE), and the harness opens the pointed email alone.

### Candidate-list recall (FULL-0, `tools/a-recall.js`)

Answer-bearing email present: gates' first context miss 48.7 / hit 99.8; both contexts 58.7 / 100; list of first + second + header-reranked mailbox top 20, first 15 lines: **81.3** / 100; first 20: 85.3 / 100.

## 2. Variants

- `a1` (hybrid): gates, then attribute the answer to its source email (most novel answer words) and ask again with that email alone (sandwich). An abstaining reread keeps gates' answer. Target: hits (distraction).
- `a2` (agent): list picker. ≤15 one-line candidates (sender | subject | the body window that best matches the question). The model picks a number; the harness opens it alone; on NOT IN EMAILS it picks again (2 reads max), then falls back to gates' first context.
- `a3` (agent): read-and-point. The model reads gates' first context in full and replies with a number or MORE (second context); the pointed email is then read alone.

- `a4` (hybrid): a1 only when gates' answer "blends" another email (failure analyst's signal: Additionally / also mentions / in the email from / email [n]). Offline on FULL-0 gates: fires on 34/450 hits (82.4% correct vs 91.1% rest) and 23/145 misses (21.7% vs 41.8%).
- `a5` (hybrid, gates + one agent step): after gates, the model picks one of a2's ≤15 listed emails. Escalate only when the pick is outside gates' final context AND it covers the question's content words ≥ 0.15 better than the email gates' answer came from; then the pick is read alone and replaces gates' answer (unless it abstains). The rule was picked offline on S300-2 from stored a2/gates answers (`tools/a-switch.js`: "outside" alone is −2.3 weighted, it fires on 10/200 hits; with the coverage margin, 12 misses / 0 hits, +6 misses net, about +0.4 in-sample), so it is validated on S100-2 and S100-8.

## 3. Results (S300-2, J1, 100 miss / 200 hit, weighted with miss share 6.8%)

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| gates (ref) | 85.1 | – | 31.0 | 89.0 | 763 | 1.0 |
| **a5 hybrid** | **85.5** | **+0.4 [0.2, 0.6]** | 37.0 | 89.0 | 987 | 2.1 |
| a4 hybrid | 85.1 | +0.0 [0.0, 0.0] | 31.0 | 89.0 | 792 | 1.1 |
| a1 hybrid | 84.1 | −0.9 [−5.5, 3.3] | 31.0 | 88.0 | 1,128 | 2.0 |
| a3 agent | 82.7 | −2.3 [−6.6, 1.7] | 31.0 | 86.5 | 918 | 2.1 |
| a2 agent | 81.5 | −3.5 [−8.6, 1.2] | 34.0 | 85.0 | 1,057 | 2.2 |
| pb | 81.4 | −3.6 | 5.0 | 87.0 | 653 | 1.0 |

- The agents: far above the frozen agent (≈37) and level with P-B, but below gates. a2 (list picker) reads an answer-bearing email for 41/100 misses (gates' final context has one for about 31) and has the best miss accuracy (34.0), but it points to the wrong email on 11/200 hits. a3 (read-and-point) mis-points on 9/200 hits. Every wrong point on a hit costs about 0.47 weighted pts here, which cancels the miss gains.
- a1: the reread changes hit answers both ways (9 lost, 7 gained vs gates); reading the attributed email alone is 174/193 = 90.2% on hits, about gates' rate. The oracle's hit advantage (FULL-0) does not appear when the model's own answer picks the email: the ~2-point oracle gap is mostly reading noise, not removable distraction. 5 hit losses come from attribution to a non-bearing email.
- a5: escalates on 12/300 (all misses, 0 hits); 9 of the 12 escalated reads carry the answer; +6 misses, 0 losses, no hit answer changes. Hit answers are byte-identical to gates (the "agree"/"outside-weak" paths keep gates' answer). The threshold was chosen on S300-2, so this result is in-sample. **Out of sample** (S100-2, S100-8, 50 miss / 50 hit each, vs stored gates): S100-2 escalates on 6 (all misses; miss +1, 0 losses, hit flips 0); S100-8 escalates on 6 (all misses; miss +4, 0 losses, hit flips 0). Mean wall ≈ 985 ms. Safe and positive, but the ceiling is small (misses carry 6.8% of the weight): about +0.3 to +0.4 weighted.
- a4: e2b was deterministic against the stored gates run here (0 flips on the 285 unchanged answers); its 15 blend rereads on hits were all already correct in gates, and 12/13 blend misses had no evidence to reread. On S300-2 the blend signal marks misses, not fixable hits.

## 4. Conclusions

- Best agent: **a3** (read-and-point; −2.3 [−6.6, 1.7] vs gates, 918 ms, 2.1 calls). a2 is close behind (−3.5) and has the best miss accuracy. Both fix the frozen agent's failure modes (≈37 → 82–83) because the model only points and the harness opens. They still lose to gates because every wrong point on a hit costs more than a miss gained.
- Best hybrid: **a5** (+0.4 [0.2, 0.6], 987 ms; in-sample threshold, confirmed directionally on S100-2/S100-8 with zero hit changes). Not a promotion candidate (needs +1.5). It is a safe add-on to whatever wins the one-shot track: it never touched a hit answer in 500 questions.
- Negative results: abstention triggers (5/600 FULL-0 answers abstain), answer-support checks (wrong answers are copied faithfully from the wrong email), single-email rereads (a1: hit reading noise both ways), and blend-triggered rereads (a4: 0 change).
- Ceiling argument: on S300-2 weights, all miss-side agent/hybrid gains together are worth at most ≈2 weighted points, and the hit-side "oracle gap" did not prove recoverable by any email-selection step. A +1.5 promotion through agent/hybrid machinery would need hit-side reading gains, which none of these designs found.
