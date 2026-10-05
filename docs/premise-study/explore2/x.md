# Worker x: fused e2b agent (k3 x g5), round 2

Prefix `x`. Code: `benchmarks/premise2/explore2/variants/x-agent.js`, offline tools `explore2/tools/x-*.js`.
Goal: fuse the two round-2 agent winners (g5 = native-tools cold agent; k3 = commit-gated expand agent) and test whether the fusion beats both.

## 1. Offline simulation (stored answers, no GPU)

`tools/x-sim.js`: per-question policies built from stored k3 / g5 / gates / n-g5 (logprob gate flag) answers on S300-2 and S300-1. e2b is deterministic for identical prompts, so a policy that only routes between stored pipelines is simulated exactly (up to cache perturbation).

| policy (weighted, Δ vs gates) | S300-2 | S300-1 |
|---|---|---|
| gates | 85.1 | 83.9 |
| k3 | 86.1 (+1.1) | 86.6 (+2.7) |
| g5 | 84.9 (−0.2) | 86.0 (+2.1) |
| **H1**: k3 commit; no YES → g5 loop (instead of k3's list pick) | 85.5 (+0.4) | 85.3 (+1.5) |
| H1b: k3 commit or k3 found; else g5 | 85.7 (+0.7) | 85.6 (+1.7) |
| commit at rank 1 only → k3; else g5 | 85.3 (+0.3) | 85.5 (+1.6) |
| g10 (n gate: sure → gates, unsure → g5) | 86.7 (+1.6) | 85.7 (+1.9) |
| sure → gates, unsure → k3 | 86.3 (+1.3) | 86.8 (+2.9) |
| **x1**: k3 commit & sure → gates answer; commit & unsure → g5; no YES → k3 explore | **87.0 (+2.0)** | **86.7 (+2.9)** |
| oracle max(k3, g5) | 89.6 | 89.7 |

**Hypothesis 1 (no YES → g5 loop) is refuted offline**: on the questions where k3 explores, k3's list pick + YES check beats g5's own-query loop (misses correct: S300-2 21 vs 18, S300-1 18 vs 13; k3 "found" misses 15/23 and 14/20 correct vs g5 11 and 10 on the same questions). The recall check (`tools/x-recall2.js`) explains it: on k3's explored misses, g5's own query surfaces an answer-bearing (AB) email that k3 never listed/opened in only 1/24 (S300-2) and 3/18 (S300-1) "nofound" episodes. g5's search adds no new recall over k3's candidate pool; k3's problem there is the probe/pick, not recall.

**Hypothesis 2 (false YES stops) has a small ceiling** (`tools/x-recall.js`, `x-w7.js`):
- False-YES commits (YES on a non-AB email): 27 / 100 misses (S300-2), 39 / 100 (S300-1). g5 answers them no better than gates (6 vs 5, 13 vs 11), so handing them to g5 alone does not fix them.
- Gates' answer logprob does flag them: 21/27 false-YES misses are "unsure" (n's gate, τ −0.1) vs 9/26 true-YES misses, but also 69/176 true-YES hits.
- Recovery ceiling: on S300-2 commit & unsure misses (30), w7's per-email probes over 18 candidates find another YES email outside W0 in 25, but it is AB in only 8 and gates is wrong on only 4 of those → continuing to explore after a doubted YES can win ≤ 4 misses (≈ +0.3 weighted) while changing the context on 13 unsure hits. Dropped before GPU.
- k3 "nofound" misses: the AB email was opened but probed NO (and not in the final context) in only 3 / 2 cases: nothing to gain from re-ordering the final context.

**What is left: the logprob doubt on committed answers.** x1 = k3, but a committed answer whose gates-prompt answer is unsure is handed to g5. τ sweep (`tools/x-tau.js`, Δ vs gates S300-2 / S300-1): −0.08 +1.9/+2.9, **−0.1 +2.0/+2.8**, −0.13 +1.9/+2.3, −0.2 +1.5/+2.7. Pooled vs gates **+2.4 [0.7, 3.8]**, but **vs k3 only +0.5 [−0.9, 1.7]**: the handover changes ~100 questions per set (commit & unsure) and gains S300-2 hits +2 / misses −1, S300-1 hits 0 / misses +2: within noise. Expected: x1 ≈ k3 (+0.5), not a systematic fusion gain.

## 2. GPU runs

x1 (S300-2) queued at ~04:00 ET behind lead jobs. It logs the YES/NO token logprobs of every probe, so YES-margin stop rules (hypothesis 2, literal form) can be simulated afterwards from the logged margins + stored g5/k3 answers.

### x1 on S300-2 (J1)

| | weighted | Δ vs gates [95% CI] | Δ vs k3 | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| **x1** | 86.1 | +1.1 [−1.9, 4.3] | +0.0 [−2.3, 2.3] | 47.0 | 89.0 | 1,820 | 5.6 |
| k3 | 86.1 | +1.1 [−0.8, 2.8] | – | 47.0 | 89.0 | 1,288 | 4.3 |
| g5 | 84.9 | −0.2 | −1.3 | 42.0 | 88.0 | 1,484 | 3.8 |
| gates | 85.1 | – | −1.1 | 31.0 | 89.0 | 763 | 1.0 |

Reproduction (`tools/x-repro.js`): every non-handover path is byte-identical to stored k3 (commit & sure 130/130 texts, found 24/24, nofound 41/41, nopick 1/1; the logprob probes reproduce k3's YES/NO decisions on all 300). The handover went to g5 on 104 questions (simulation: 102; unsure flag agrees with n-g5 on 92/104). **The g5 agent did not reproduce its stored answers when run after k3's probes**: same text on 61/104 (hits 39/72, misses 22/32). Against k3 on those 104 questions the handover is an exact coin flip: misses +4/−4, hits +3/−3. So x1 = k3 on S300-2, and the simulated +0.9 vs k3 was the stored g5 run's luck on those questions, not a property of the fusion.

**YES-token margin (logged by x1; `tools/x-yesdetect.js`, `x-margin.js`).** The probe's YES logprob separates false-YES commits from true ones about as well as the answer-logprob gate: AUC 0.73 (answer-lp gate 0.68). Committed questions (234): yesLp < −0.2 fires on 44, catching 13/27 false-YES misses but also 24/176 true-YES hits and 5/26 true-YES misses; < −0.1 fires 79 (18/27 false-YES misses, 45 true-YES hits). With stored g5 as the fallback, margin-only rules simulate at +1.2 to +1.6 vs gates (k3 +1.1), i.e. ≤ +0.5 vs k3, and the fallback itself does not reproduce (see above). A detector is not the bottleneck; recovery is (≤ 4 recoverable false-YES misses on S300-2, section 1).

## 3. Lead's round-3 suggestions: p3 context as W0 (x2), doubted YES (x3)

Lead update (09:30 ET): k3 S300-3 +3.2, FULL-0 +0.5, FULL-1 −0.1; p3 FULL-1 +1.0. Suggestions: start k3 from p3's triggered-swap context, and attack false YES stops.

- **x2** = k3 with W0/W1 = p3's contexts (p-perfect.js `buildContexts`, p3 options; the commit check sees the CE-swapped emails in slots 4–5; a committed answer is then byte-for-byte p3's prompt). Stub check (`tools/x-check.js`): W0 = stored p3 contextPaths 300/300. On non-triggered questions (≈ 85%) x2 = k3 (deterministic; x1 showed 100% reproduction of k3's paths).
  Offline bound on the triggered questions (`p3` context ≠ gates'): S300-2 34 misses / 11 hits, S300-1 38 / 10. There k3 is right on 10 / 11 misses vs p3 12 / 18; k3 false-commits on 12 / 17 of these misses (AB not in gates' W0) while p3's W0 holds an AB email in 15 / 23. A committed x2 answers with p3's prompt, so x2 should take most of p3's edge there: expected ≈ +0.1 (S300-2) to +0.5 (S300-1) weighted vs k3; hits unchanged on 189/200.
- **x3** = x2 + doubted YES: a YES with token logprob < −0.2 (x1 logs: catches 13/27 false-YES misses, 24/176 true-YES hits on S300-2) doesn't stop the agent: it keeps probing W0 for a confident YES, else explores (k3 pick/search ≤ 3 opens). Only a new YES email changes the prompt ([E, W0 top 4]); otherwise W0 is answered unchanged (hit-safe by construction except when a new YES appears). Expected small (recovery ceiling ≤ 4 misses on S300-2).

### x1 on S300-1 (J1)

| | weighted | Δ vs gates [95% CI] | Δ vs k3 | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| **x1** | 87.7 | +3.8 [0.9, 6.9] | +1.1 [−1.6, 3.6] | 49.0 | 90.5 | 1,999 | 5.4 |
| k3 | 86.6 | +2.7 [−0.2, 5.8] | – | 47.0 | 89.5 | 1,259 | 4.2 |
| g5 | 86.0 | +2.1 | −0.6 | 45.0 | 89.0 | 1,471 | 3.9 |
| gates | 83.9 | – | −2.7 | 34.0 | 87.5 | 756 | 1.0 |

Flips vs k3 by step: handover (commit & unsure → g5, 99 questions) hits +3/−1, misses +4/−3; found +1/0; everything else +1/−1. Here the k3 paths were *not* byte-identical to stored k3 (commit & sure hit texts 82/110 identical; verdicts +1/−1), so cross-run determinism is weaker than on S300-2. Pooled over both sets the g5 handover is hits +6/−4, misses +8/−7 vs k3 (x1 pooled vs k3 ≈ +0.55): consistent with n's "unsure hits are a coin flip", no systematic fusion gain. YES-margin replicates: AUC 0.73 for false-YES detection (answer-lp gate 0.61); yesLp < −0.2 fires on 16/40 false-YES misses, 29/170 true-YES hits.

### x2 on S300-2 (J1)

x2: **85.4**, Δ vs gates +0.4 [−1.8, 2.6], vs k3 −0.7 [−2.1, 0.4]; miss **50.0** (k3 47), hit 88.0 (k3 89.0); 1,748 ms, 4.2 calls.
- Non-triggered questions (p3 ctx = gates ctx, 255): byte-identical to k3 on 252 (commit 212/212, found 14/14); one hit lost on a non-identical "nofound" text (run-to-run noise).
- Triggered (swapped) questions: misses +5/−2 vs k3 (committed 22: x2 11 vs k3 7 — the predicted effect: the commit now answers over p3's context, which holds the AB email); hits 11: 7 vs 9 (−1 on a found path where the context changed, −1 noise-level).
- So the mechanism works on misses as predicted (+3 net), but two hit flips (−0.9 weighted) erase it on this set.

### x3 on S300-2 (J1)

x3: **84.9**, Δ vs gates −0.1 [−2.7, 2.2], vs k3 −1.2; miss 50.0, hit 87.5; 1,903 ms, 5.2 calls. Byte-identical to x2 outside the doubted cases. The doubt rule (YES logprob < −0.2) fired on 30 questions (10 misses, 20 hits): kept W0 on 24 (no change by construction), found a new YES email on 6 (AB 4/6). Changes vs x2: misses +1/−1, hits 0/−1 (the one doubted hit whose explore found a new email lost its answer). As the ceiling analysis predicted, detecting false YES stops is not enough: the explore after a doubted YES rarely reaches a better email, and the reorder costs as much as it wins.

## 4. Lead confirmation of x1 and behaviour stats

Lead (10:xx ET): x1 Δ vs gates S300-3 +2.3 [0.2, 4.3], FULL-1 +1.3 [−0.4, 2.9] (86.0 vs 84.6; miss 42.7 vs 29.3, hit 89.1 vs 88.7; 1,772 ms, 5.4 calls); with S300-2 +1.1 and S300-1 +3.8 ≈ +2.0 pooled over 1,500 questions. x1 is frozen (any change → new id).

x1 behaviour (`tools/x-stats.js`):

| | S300-2 | S300-1 |
|---|---|---|
| stops on its own YES (commit) | 234/300 (78%): hits 91%, misses 53% | 240/300 (80%): hits 89%, misses 63% |
| of which kept gates' answer (confident) | 130 (43%) | 141 (47%) |
| of which handed to the g5 tools agent (unsure answer) | 104 (35%) | 99 (33%) |
| explored (no YES in W0) | 66 (22%) | 60 (20%) |
| gold email shown to the agent → in the final reading context | 243/261 (93%) | 243/259 (94%) |
| AB email shown → AB in final context | 254/269 (94%); misses 57/69 | 254/269 (94%); misses 55/69 |
| model-written searches / episode | 0.50 (k3 plan search on explore + g5's own query on handover) | 0.48 |
| explore picks: list held an AB email → picked one | 35/64 | 23/49 |
| calls / wall | 5.6 / 1,820 ms | 5.4 / 1,999 ms |

(Frozen e2b agent: opened shown gold 41%; g5: 91%.)

### x2 on S300-1 (J1)

x2: **87.0**, Δ vs gates +3.2 [0.3, 6.2], vs k3 **+0.4 [0.1, 0.8]**; miss 53.0 (k3 47), hit 89.5 (= k3); 1,721 ms, 4.0 calls. All changes are on the 48 swapped questions: misses +8/−2, hits 0/0; the 252 others are identical in verdict to k3.
Pooled (S300-2 + S300-1) x2 vs k3: swapped misses +13/−4, hits −2/0 → ≈ −0.15 weighted (S300-2 −0.7, S300-1 +0.4). The p3 context is a real miss mechanism for the agent (≈ +4.5 miss points), but its weighted value (≈ +0.3) is within one or two hit flips.

**x4 (x1 + p3 first context), offline only** (`tools/x-sim4.js`: x1 where p3 does not swap, x2 where it does): S300-2 +0.7, S300-1 +4.2 vs gates → pooled +2.45, the same as x1 (+1.1, +3.8 → +2.45). Not run: no expected gain over x1 at this sample size.

### x3 on S300-1 (J1)

x3: **87.2**, Δ vs gates +3.3 [0.5, 6.4], vs x1 −0.5; miss 55.0, hit 89.5; 1,921 ms, 5.3 calls. vs x2 the only changes are on doubted YES: misses +2/0 (doubt-found 10, AB found 3), hits 0/0 (doubt fired on 25 hits, 24 kept). Pooled with S300-2, x3 vs x2: misses +3/−1, hits 0/−1 → nil.

## 5. Final table (J1; Δ vs gates [95% CI] from `cli2.js report`)

| id | set | weighted | Δ vs gates | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| **x1** | S300-2 | 86.1 | +1.1 [−1.9, 4.3] | 47.0 | 89.0 | 1,820 | 5.6 |
| **x1** | S300-1 | 87.7 | +3.8 [0.9, 6.9] | 49.0 | 90.5 | 1,999 | 5.4 |
| x2 | S300-2 | 85.4 | +0.4 [−1.8, 2.6] | 50.0 | 88.0 | 1,748 | 4.2 |
| x2 | S300-1 | 87.0 | +3.2 [0.3, 6.2] | 53.0 | 89.5 | 1,721 | 4.0 |
| x3 | S300-2 | 84.9 | −0.1 [−2.7, 2.2] | 50.0 | 87.5 | 1,903 | 5.2 |
| x3 | S300-1 | 87.2 | +3.3 [0.5, 6.4] | 55.0 | 89.5 | 1,921 | 5.3 |
| k3 (ref) | S300-2 / S300-1 | 86.1 / 86.6 | +1.1 / +2.7 | 47 / 47 | 89.0 / 89.5 | 1,288 / 1,259 | 4.3 / 4.2 |
| g5 (ref) | S300-2 / S300-1 | 84.9 / 86.0 | −0.2 / +2.1 | 42 / 45 | 88.0 / 89.0 | 1,484 / 1,471 | 3.8 / 3.9 |

Pooled S300-2 + S300-1 vs gates: x1 +2.45, x2 +1.8, x3 +1.6, k3 +1.9, g5 +1.0. Lead's confirmation of x1: S300-3 +2.3, FULL-1 +1.3 (≈ +2.0 over 1,500 questions).

## 6. Conclusions

- **Best: x1** (k3 commit check → confident gates answer kept; unsure committed answer → g5 native-tools agent; no YES → k3 explore). It is the best by the numbers on both screening sets, and the lead's confirmation holds it ahead of gates on every fair set. Be honest about where the margin comes from: against k3 it is +0.0 (S300-2) and +1.1 (S300-1). The g5 handover on unsure commits is close to a coin flip in flips (pooled hits +6/−4, misses +8/−7). The handover routes only the ~⅓ of questions where e2b's own answer is unsure, the place n showed alternatives can't lose much. That keeps confident hits byte-identical (or, across runs, verdict-identical) to gates.
- **Hypothesis 1 (no YES → g5's loop instead of k3's list pick) is refuted** offline: k3's explore beats g5's own-query loop on the same questions (found misses 15 vs 11, 14 vs 10). g5's query adds an unseen AB email in only 1/24 and 3/18 of k3's unresolved episodes, so the recall is already there.
- **Hypothesis 2 (false YES stops):** the YES-token logprob is a usable detector (AUC 0.73 on both sets; better than the answer-logprob gate, 0.68 / 0.61). Recovery is the bottleneck: after a doubted YES, a new YES email is rarely the AB one, and the w7-based ceiling is ≤ 4 misses per 100. x3 confirmed this: nil (misses +3/−1, hits −1 pooled vs x2).
- **p3 context as the first working set (x2):** a real miss mechanism (+13/−4 swapped misses pooled), but it is worth about +0.3 weighted and is lost in hit noise (S300-2 −0.7 vs k3, S300-1 +0.4 [0.1, 0.8]). x4 (x1 + p3 context) simulates equal to x1; not run.
- **Determinism caveat:** k3's paths reproduced byte-identically within the S300-2 rerun, but only ~75% of texts on S300-1 (verdicts nearly identical). The g5 agent reproduced only ~60% of its texts when run after the probe calls. So simulations that route to stored g5 answers overstate (x1 sim +0.9 vs k3 on S300-2, real +0.0).
