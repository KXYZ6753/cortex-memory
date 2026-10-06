# Worker e: ensembles and answer selection across systems (round 3)

Prefix `e`. Code: `benchmarks/premise2/explore2/variants/e-ens.js` (variants), `variants/e-common.js` (answer similarity), offline tools `explore2/tools/e-*.js` (`e-lib.js` shared loaders).
Question: we have many systems with different error patterns (gates, p3, k3, g5, x1, r4/r5, s1, o4, h4, …) on the same questions. Can **agreement between answers** pick the right one where n showed e2b's logprobs cannot? And what would a deployable ensemble within 3,243 ms look like?

Answer similarity (`e-common.js` `sim`): content words of the answer that are not in the question ("novel" words), mean of overlap coefficient and Jaccard; abstentions match only abstentions; disjoint numbers → 0. "Agree" = sim ≥ 0.5. Calibration over all answer pairs on S300-2 (23 systems): P(same J1 verdict) is 0.62 at sim 0, 0.87 at [0.4, 0.6), 0.94 at ≥ 0.6, 0.996 for identical texts. So the measure separates "same answer" from "different answer" well; what it cannot do is say which of two different answers is right (below).

## 1. Offline ceilings and agreement (stored answers; S300-2, S300-1; FULL-0 dev only)

`tools/e-ceil.js`, `e-noise.js`. Weighted J1 (miss / hit).

| oracle "any system right" | S300-2 | S300-1 |
|---|---|---|
| x1 alone | 86.1 (47 / 89.0) | 87.7 (49 / 90.5) |
| x1 + gates | 88.8 | 89.3 |
| x1 + g5 | 88.5 | 88.6 |
| x1 + p3 | 89.2 | 89.8 |
| x1 + h4 | 88.8 | 90.5 |
| x1 + h4 + g5 | 90.0 | 90.8 |
| all systems (23 / 17) | 93.2 (68 / 95.0) | 92.4 (71 / 94.0) |
| greedy best 5 | 92.9 (x1, o12, g5, n-cs2, h4) | 92.3 (x1, h4, x2, o4, g5) |

- Part of every multi-system oracle is pure run-to-run noise: on S300-1, x1 and k3 run the *same* algorithm on 201 questions (everything but x1's g5 handover), 57 texts differ, and oracle(x1, k3) there is 90.4 vs 89.0 for either one (+1.4). On S300-2 and FULL-0 the two runs were byte-identical there (oracle = either).
- Agreement is a weak *between-question* signal: when two systems agree (sim ≥ 0.5), the shared answer is right 86–90% (weighted) vs 85–87% overall; when they disagree, each is right 55–75% and either-right 70–97%. Pairs that agree most (gates~p3 278/300, n-g5~r5 288/300) are near-copies; the useful pairs (x1~g5, x1~h4, x1~o4) disagree on 60–70 questions.

Where the headroom sits relative to x1's steps (`tools/e-steps.js`; right answers miss/hit; ANY = any of 11 systems):

| x1 step | S300-2 n (miss/hit) | x1 | ANY | S300-1 n | x1 | ANY | FULL-0 n | x1 | ANY |
|---|---|---|---|---|---|---|---|---|---|
| commit & sure (gates' answer kept) | 130 (21/109) | 13/101 | 15/104 | 141 (31/110) | 16/103 | 20/105 | 314 | 20/254 | 27/258 |
| commit & unsure (→ g5 handover) | 104 (32/72) | 13/63 | 18/68 | 99 (32/67) | 14/59 | 23/61 | 187 | 23/120 | 29/129 |
| explore (no YES in W0) | 66 (47/19) | 21/14 | 32/17 | 60 (37/23) | 19/19 | 27/22 | 99 | 26/33 | 34/35 |

Confident commits have almost no headroom (n's finding again). The reachable part is the unsure handover (hits) and explore (misses).

## 2. Offline voting and agreement policies (`tools/e-vote.js`, `e-stepvote.js`)

Whole-question plurality votes (cluster by sim ≥ 0.5, plurality, ties → x1), Δ vs x1 (weighted):

| policy | S300-2 | S300-1 | FULL-0 (dev) |
|---|---|---|---|
| vote x1, k3, g5 | +0.5 | −0.5 | +0.2 |
| vote x1, gates, g5 | +0.9 | −0.1 | +0.4 |
| vote x1, g5, r5 | +1.1 | −0.3 | +0.4 |
| vote x1, gates, k3, g5, r5 | +1.1 | −1.0 | +0.6 |
| vote of all systems | +1.2 | −2.1 | – |
| soft vote (sum of sims) x1, gates, k3, g5, r5 | +0.5 | −1.9 | +0.4 |
| vote gates, k3, g5 (no x1) | +0.5 | −1.1 | −0.1 |
| escalate: gates ~ k3 → gates, else g5 | −0.3 | −4.1 | −0.1 |
| escalate: k3 ~ gates → k3, else g5 | +0.2 | −1.8 | −0.6 |
| escalate: k3 ~ g5 → k3, else x1 | 0.0 | −1.0 | −0.8 |
| override x1 only if g5 and r5 agree with each other and not with x1 | +1.1 | +0.1 | +0.4 |
| override x1 only if g5 and p3 agree … | +1.1 | +0.1 | – |

"Two cheap systems agree → keep, disagree → escalate to a third" loses to x1 on every set: x1's commit check already is a better "keep or escalate" decision than answer agreement. Broad votes help on S300-2 and hurt on S300-1: with x1 in the vote, any override is a coin flip.

**Step-restricted vote** (x1 everywhere, except on the unsure handover where both g5's and gates' answers already exist: if they disagree, a third opinion decides; gates' answer only if the third agrees with gates and not with g5):

| third opinion | S300-2 | S300-1 | FULL-0 | flips vs x1 (S2; S1) |
|---|---|---|---|---|
| r5 | +0.5 | −0.1 | +0.4 | miss +4/−3 hit +2/−1; miss +2/−4 hit 0/0 |
| o4 (rules-last prompt on W0) | +0.6 | +0.3 | – | miss +4/−2 hit +2/−1; miss 0/−2 hit +1/0 |
| r4 | +0.5 | −0.1 | +0.8 | |
| p3 | +0.5 | −0.1 | – | |
| replace g5 by gates whenever they disagree (no third) | 0.0 | −1.5 | −0.1 | |

Thresholds 0.3 / 0.7 and 4–5-voter versions move these by ±0.5 in both directions (no stable optimum).

**Can agreement pick between two answers? No better than logprob.** Pooled over the three sets, x1's handover has 120 questions where g5 and gates disagree: g5 right 67, gates right 69 (`tools/e-conf.js`). Splitting by the third: r5 sides with gates on 64 (g5 right 36, gates 37), not on 56 (31 vs 32): no signal. o4 sides with gates on 29 (11 vs 13), not on 33 (19 vs 16): +2 per ~30, noise-size. Gates' own answer logprob (firstMean) inside the unsure band: [−0.25, −0.15) 34 vs 35, [−0.15, −0.1) 28 vs 30. The perfect chooser between g5 and gates on these questions is worth only +1.2 (S300-2), +0.6 (S300-1), +0.85 (FULL-0) weighted.

## 3. GPU variant e1 (S300-2, S300-1)

`e1` = x1 run unchanged + on x1's handover questions where g5's and gates' answers disagree (~10% of questions), one o4-prompt call over gates' W0; gates' answer is used iff o4 agrees with gates and not with g5. Diagnostics logged on the same questions (not used by e1's answer): r5 as the third, and an e2b **pairwise choose step** (decision prompt "Decide which of two answers to a question is supported by the emails", question and both answers *before* the emails, so no prefix is shared with any answer or probe prompt; both A/B orders; first-token logprobs summed). `e1o` is a replay (no model calls) that outputs the candidate e1 did not pick, so both candidates get a J1 verdict and every selection rule is scored exactly from the same run (`tools/e-eval.js`). Stub check: `tools/e-stub.js`.

| | set | weighted | Δ vs gates [CI] | Δ vs x1 (stored) [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|---|
| **e1** | S300-2 | 86.7 | +1.7 [−0.8, 4.6] | +0.6 [−0.9, 2.2] | 49.0 | 89.5 | 2,004 | 6.0 |
| **e1** | S300-1 | 87.4 | +3.5 [0.9, 6.5] | −0.3 [−2.6, 2.1] | 45.0 | 90.5 | 1,976 | 5.8 |
| x1 (ref) | S300-2 / S300-1 | 86.1 / 87.7 | +1.1 / +3.8 | – | 47 / 49 | 89.0 / 90.5 | 1,820 / 1,999 | 5.6 / 5.4 |

Pooled over 600: e1 vs gates ≈ +2.6, vs stored x1 ≈ +0.15. **Not a candidate** (the bar is +1.0 vs x1).

Selection rules on the disagreement questions, exact, Δ vs the same run's internal x1 (= g5's answer always):

| rule | S300-2 (32 disagreements) | S300-1 (29) |
|---|---|---|
| e1: o4 third | +0.60 (miss +4/−2, hit +2/−1) | +0.33 (miss +1/−3, hit +1/−0) |
| gates' answer always | +0.47 | 0.00 |
| r5 third | +0.53 | −0.07 |
| o4 and r5 both side with gates | +0.67 | −0.20 |
| o4 or r5 sides with gates | +0.47 | +0.47 |
| e2b pairwise choose, both orders | +0.40 | +0.40 |
| e2b choose, one order only | +0.47 / +0.60 | +0.47 / +0.47 |
| choose + o4 agree | +0.47 | +0.33 |
| oracle(g5, gates) | +1.20 | +0.67 |

Every rule lands within ±0.2 of "always take gates' answer" and within 1–2 hit flips of each other: the third opinion and the e2b chooser carry no measurable information beyond that. The pairwise choose is position-biased (on 61 disagreements both orders gave the same letter 25 times; "B" 66% of replies); summing the two orders cancels that, and the remaining preference is right about as often as a coin.

**Simulation vs GPU (prompt cache / nondeterminism).** S300-2: x1 inside e1 reproduced stored x1 exactly (steps 300/300, texts 284/284 where g5 was kept, internal-x1 verdicts = stored), and the offline prediction (+0.60 vs x1) was hit exactly. S300-1: the same rules again reproduce the offline numbers against the run's own internal x1 (o4 rule +0.33 predicted and measured), but x1 itself did not reproduce (steps 275/300, texts 197 of ~285 identical, internal x1 −0.6 vs stored x1), so e1 vs stored x1 is −0.27. The run-to-run swing of x1 (±0.6 weighted on a set) is larger than the effect being measured. The extra calls (o4, r5, choose) all come *after* every answer used, so they cannot perturb the answers; the S300-1 drift is x1's own (its g5 handover after probes, as x.md found).

## 4. Conclusions

- **Best id: e1** (x1 + o4-third vote on x1's g5 handover when g5 and gates disagree). S300-2 86.7 (+1.7 vs gates, +0.6 vs x1), S300-1 87.4 (+3.5 vs gates, −0.3 vs x1); ≈2.0 s, 5.9 calls. Not a promotion candidate: pooled +0.15 vs stored x1, +0.47 vs its own internal x1.
- **Offline ceilings are large but not selectable.** Any-of-all-systems is 93.2 / 92.4 vs x1 86.1 / 87.7, x1 + one partner 88.5–90.5, but part of that is run-to-run noise (two runs of the same algorithm: +1.4 on S300-1), and no agreement-, confidence- or e2b-choice selector recovers more than ~+0.5. The useful headroom on x1's step structure is small: confident commits ≈ none; unsure handover ≤ +1.2 / +0.7 / +0.85 (perfect chooser between g5 and gates, S300-2 / S300-1 / FULL-0); explore misses ≈ +0.75 (but no selector found).
- **Agreement can't pick between two answers, just as logprob can't** (n). On 120 pooled handover disagreements, g5 is right 67 times and gates 69; a third answer siding with gates leaves it 37 vs 36 (r5) or 13 vs 11 (o4). An e2b pairwise "which answer do the emails support" step, debiased over both orders, does the same as always taking gates' answer.
- **What failed:** whole-question majority votes (S300-2 +0.5…+1.2, S300-1 −0.1…−2.1 vs x1); soft votes; "two cheap systems agree → keep, else escalate" (−0.3…−4.1 vs x1: x1's YES/NO commit check is a better keep/escalate decision than answer agreement); vote thresholds 0.3/0.7 and 4–5-voter versions (±0.5, no stable optimum); the e2b pairwise choose step.
- Answer agreement is a calibrated *between-question* signal (agreeing pairs right 86–90% vs 55–75% for each side of a disagreement), so it could replace or join logprob as an escalation trigger, but x1 already escalates on the questions where it matters.
