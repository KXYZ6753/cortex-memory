# Worker z: new methodology (round 3)

Prefix `z`. Code: `benchmarks/premise2/explore2/variants/z-*.js`, offline tools `explore2/tools/z-*.js`.
Brief: look for a step change with a method nobody has tried, on top of the champion x1 where possible.

## 0. Where x1's remaining errors are (offline, stored x1 answers + J1)

`tools/z-pairs.js`, `z-fails.js`, `z-falseyes.js`.

| x1 step (S300-2) | hits right / n | misses right / n |
|---|---|---|
| commit (YES in W0, confident gates answer) | 101 / 109 | 13 / 21 |
| commit-g5 (YES, unsure answer → g5 agent) | 63 / 72 | 13 / 32 |
| found (no YES in W0, explore found a YES email) | 1 / 1 | 15 / 23 |
| nofound / nopick | 13 / 18 | 6 / 24 |

S300-1 has the same profile (commit 103/110 hits; commit-g5 59/67; nofound 18/22).

- The non-commit half of the questions (170 / 159 per set) holds 14 of the 22 wrong hits and 45 of the 53 wrong misses on S300-2.
- **No room for an answer selector on the handover.** On x1's commit-g5 questions, gates' answer (A, over W0) and g5's answer (B) are both right or both wrong on 90 of 104 (S300-2): hits A1B1 60, A0B0 6, A1B0 3, A0B1 3. A perfect selector between them would gain 3 hits per set. Brief idea (d) in the form "pick between two candidate answers" is capped at ≈ +1.4 weighted even with a perfect selector, and n showed e2b's own confidence picks at chance. Not built.
- Wrong hits by type (S300-2, 22, read by hand): **under-specific / hedged answers 8** ("the email does not specify …", "the website", "something") although the email has the fact; judge strictness on correct-looking answers 6; wrong fact or person (relation, header) 6; similar-email confusion 2. The first class is the one a different *reading method* could plausibly fix systematically.
- Wrong misses: AB email at mailbox BM25 ranks 1–5: 14 / 18 (S300-2 / S300-1), 6–10: 11 / 12, 11–50: 14 / 17, beyond 50 or not in the BM25 top 200: 14 / 6. False YES commits (YES on a non-AB email) are 27 / 33 of them. Many of these questions are vague ("What is the term of the contracts mentioned in the email?", "the main topic of the article forwarded by Jeff Dasovich") and have several plausible emails.

## 1. Phase-1 thinking evidence (offline, `tools/z-think.js`)

pbu vs pbuthink (S100-3, identical contexts, thinking unlimited): hits 4 / 4 flips, misses 2 / 4; 585 output tokens on average (p50 505, p90 929, max 1,935), 3.7 s per call, ≈ 160 tok/s. No sign of a systematic gain, but n = 50 hits and it was applied everywhere, including the confident questions where every change loses (n.md).

## 2. Replay screening (diagnostic)

`variants/z-replay.js`. A replay variant returns x1's stored answer on x1's confident commits (130 / 141 questions per set) and re-reads **x1's final context unchanged** with a new reading method on the other questions (the handover, found and nofound steps). Every changed verdict is then a paired effect of the reading method on an identical context, without the agent's run-to-run noise.

- `z-think1`: thinking mode (`think: true`), sandwich prompt, num_predict 1,024 for thinking + answer; out of budget → x1's answer.
- `z-ext1`: JSON-schema output `{email, quote, answer}`; the answer is used only when the quote is verbatim (4-gram support ≥ 0.8) in the named email, else x1's answer.

### S300-2 (J1; `tools/z-eval.js`, `z-vote.js`, `z-extdiag.js`)

| id | weighted | Δ vs gates [95% CI] | Δ vs x1 [95% CI] | miss | hit | wall ms (est. real) | calls |
|---|---|---|---|---|---|---|---|
| x1 | 86.1 | +1.1 [−2.0, 3.6] | – | 47.0 | 89.0 | 1,820 | 5.6 |
| z-think1 | 85.7 | +0.6 [−2.7, 3.7] | −0.5 [−2.7, 1.8] | 47.0 | 88.5 | ≈ 3,180 (x1 − g5/final + 3.6 s per thinking read) | ≈ 5.6 |
| z-ext1 | 86.5 | +1.5 [−2.0, 5.2] | +0.4 [−1.6, 3.4] | 46.0 | 89.5 | ≈ 1,610 (replacing g5's final call) | ≈ 5.6 |

(CIs: paired stratified bootstrap, 2,000 draws, `z-eval.js`.)

Flips vs x1 (re-read questions only, identical contexts):
- z-think1: hits +3/−4 (handover +3/−2, nofound 0/−2), misses +4/−4 (found +3/0, commit-g5 +1/−2, nofound 0/−2). Thinking used 588 tokens median (p90 848; 5/170 ran out of the 1,024 budget), 3.6 s per call.
- z-ext1: hits +4/−3, misses +5/−6. Only 9/170 extractions failed the verbatim-quote check.

**Both null.** On x1's unsure half the three readings of the same emails (x1's answer, thinking, extraction) are wrong together: hits 72 all right, **8 all wrong**, 11 split; misses 24 all right, **38 all wrong**, 17 split. A token-F1 majority (medoid) of the three = x1 exactly on hits (77 / 91) and +1 on misses; even the oracle union of the three adds only 6 hits. The reading lottery that n saw *across prompts on gates' confident half* does not exist on x1's unsure half: x1's handover already moved those questions to a second reading, and what is left is reading errors every method shares plus wrong contexts.

**Why the quote check cannot help** (z-ext1 diagnostics): when x1's final context holds no answer-bearing (AB) email (39 misses), e2b still names an email and quotes it verbatim in 38 / 39 (35 wrong, 3 right by a non-AB near-duplicate). When the context holds an AB email, it names one in 85 / 88 hits and 34 / 40 misses, and still answers wrong in 8 hits / 6 misses from a correct, verbatim quote. Grounding is not the failure: e2b copies faithfully from the wrong email (misses) or misreads the right sentence (hits). This is a.md's "wrong answers are copied faithfully" in a deterministic, schema-checked form.

## 3. Directions checked offline and dropped

- **(d) contrastive selection between candidate answers**: on x1's handover, gates' answer vs g5's answer disagree in correctness on 6 / 72 hits and 8 / 32 misses (S300-2), 4 / 56 and 4 / 27 (S300-1). A perfect selector gains ≤ 3 hits per set; e2b's own confidence selects at chance (n.md). Not built.
- **(c) decomposition of two-part questions**: x1 hits on two-part questions 33 / 38 (86.8%) vs 90.1% on single ones (S300-2 + S300-1). Ceiling ≈ 1–2 hits per 400; not built.
- **(e) reverse HyDE / doc2query**: per-question generation of "the question this email answers" for 15 candidates costs ≈ 3 s, and it targets the false-YES detector, which x.md showed is not the bottleneck (recovery ceiling ≤ 4 misses / 100). The index-time form (e2b doc2query over the askers' mailboxes) needs ≈ 24k generations per screening set (≈ 80 GPU-minutes), not possible on the shared FIFO GPU.

### S300-1 (replication)

| id | weighted | Δ vs gates [95% CI] | Δ vs x1 [95% CI] | miss | hit | wall ms (est. real) | calls |
|---|---|---|---|---|---|---|---|
| x1 | 87.7 | +3.8 [−0.1, 6.6] | – | 49.0 | 90.5 | 1,999 | 5.4 |
| z-think1 | 85.4 | +1.6 [−1.9, 5.1] | −2.3 [−4.9, 0.3] | 50.0 | 88.0 | ≈ 3,290 | ≈ 5.4 |
| z-ext1 | 85.5 | +1.7 [−2.7, 5.2] | −2.1 [−5.1, 0.8] | 45.0 | 88.5 | ≈ 1,790 | ≈ 5.4 |

Flips vs x1: z-think1 hits +2/−7, misses +5/−4; z-ext1 hits +2/−6, misses +2/−6. Three-reader patterns: hits 67 all right / **10 all wrong** / 13 split; misses 24 / **31** / 14; medoid = x1 on hits (78/90); union +2 hits.

**Pooled S300-2 + S300-1 vs x1: z-think1 −1.4, z-ext1 −0.9.** Both lose hits on the identical contexts (pooled hits think +5/−11, ext +6/−9). x1's sandwich answer is a slightly better reading than thinking or schema-bound extraction on the same emails, and probably closer to J1's reference style (the thinking and JSON answers differ in wording on 64–69 of ~70 handover hits).

## 4. Conclusions

- **No step change found; nothing to promote.** x1 stays the champion. Best z id by the numbers is z-ext1 (S300-2 +0.4, S300-1 −2.1 vs x1); neither replay variant is a candidate.
- **The main finding is negative, but it is measured cleanly.** On x1's unsure half (the ~55% of questions that are not confident commits, where 14/22 wrong hits and 45/53 wrong misses sit), re-reading x1's *exact final context* with a different reading method moves nothing. That includes e2b's own reasoning (thinking mode, ~590 tokens, 3.6 s) and a verified-grounding JSON extraction. The errors left there are shared by every reader: 18 hits and 69 misses per 600 are wrong under all three methods, against 11 + 9 hits where the methods split. Hit-side reading is capped at e2b's ability, not at prompt, format or reasoning budget.
- **Grounding is not the failure mode.** e2b names the answer-bearing email and copies a verbatim quote from it on 96% of hits. On wrong-context misses it quotes the wrong email just as verbatim (38/39). A deterministic quote check therefore cannot catch errors, in either direction.
- **Thinking is now measured where it should help most.** Applied only to x1's unsure answers, on identical contexts (≈ 330 questions over two sets), it is net negative on hits. Phase 1 killed it for cost; at ≈ 3.2–3.3 s mean it would also sit at the cost cap.
- **Where the remaining points are:** wrong-context misses on the unsure half, 39 (S300-2) and 32 (S300-1). For about half of them an AB email sits in the asker's mailbox BM25 top 30 and is never probed, because they are false-YES handovers (`tools/z-reach.js`). That is x3's "doubted YES" recovery, which x.md showed nil (new YES emails are rarely AB). A per-question generative retrieval method (reverse HyDE) costs ≈ 3 s, and the index-time form (doc2query) needs ≈ 80 GPU-minutes per set, so neither fits this queue. Even full recovery of these at x1's found-email accuracy (~70%) is worth ≈ +1.5–1.8 weighted, the largest remaining lever, and it is a retrieval/recall problem.
- `variants/z-agent.js` `z-thx` (x1 with thinking on its unsure reading calls, as a real non-replay variant) is defined but was not run, because the replays killed the idea.
- J1 spend for z: ≈ $0.008.
