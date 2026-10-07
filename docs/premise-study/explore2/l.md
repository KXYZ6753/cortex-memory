# l: self-verification for selecting among candidate answers (round 5)

Prefix `l`. Code: `explore2/variants/l-common.js` (verification prompts and the YES/NO scorer), `explore2/variants/l-diag.js` (diagnostics on stored candidates), offline tools `explore2/tools/l-*.js` (`l-lib.js` shared loaders).
Question: can e2b tell its own right answers from its wrong ones **pointwise** ("Proposed answer: … Is it correct and complete according to this email? YES or NO", scored by the first output token's logP(YES) − logP(NO)) well enough to pick the best of several candidates?

Why it might work where earlier selectors failed: answers are diverse (c: 13% of hits split across presentations; n: union of prompts on gates' context 93 vs 85), but every selector tried was a coin flip: answer agreement (e, w: errors correlated), e2b's own answer logprob (n: calibrated between questions, not within), e2b's pairwise "choose" (e: position-biased, debiased ≈ coin). The YES/NO relevance probe is the one sharp pointwise judgement e2b makes here (w: YES on 70% of answer-bearing emails, 6.7% of others).

## 1. Candidate pools and the oracle-selection bound (offline, `l-pools.js`, `l-bound.js`; S300-1/2/3 + FULL-1 = 1,500 questions)

Candidates = distinct stored answer texts with a J1 verdict (verdicts are keyed by text, so a text graded for any variant counts), plus x1's internal commit answer (`gatesAnswer`) and j1/j2's single-email re-read.

| pool | candidates / q | mixed questions (miss / hit) | x1 | oracle selection |
|---|---|---|---|---|
| every stored variant (≈ 20–140 per set, incl. gold-only readers) | 12.3 | 392 / 429 (821 of 1,500) | 86.3 (44.0 / 89.4) | 98.1 (96.0 / 98.3) |
| deployable-like (x1, x1.commit, g5, gates, j1/j2 + single, c-fin1/c-xT, u-xcad, u-xrep, d8r, y1, t-lk, k3) | 3.6 | 187 / 152 | 86.3 | 92.9 (61.8 / 95.1) |
| x1-core (x1, x1's commit answer, g5, gates) | 2.2 | 143 / 95 | 86.3 | 90.2 (53.3 / 92.9) |

By x1 path, with deployable candidate sources (proxies from stored answers: "single" = the YES email read alone, i.e. j1/j2's stored re-read, else oracles' text when the YES email is the gold; "cad" = u-ocad5's text when the YES email is the gold). Δ = questions where some candidate is right and x1 is wrong; weighted over the 1,500:

| x1 path | n (hit) | x1 right | + commit answer | + single read | + commit + single | + commit + single + CAD | + thread labels |
|---|---|---|---|---|---|---|---|
| sure commit, hits | 582 | 540 | +0 | +18 | +18 | +23 | +7 |
| unsure commit (→ g5), hits | 377 | 329 | +15 | +18 | +22 | +24 | +11 |
| explore, hits | 91 | 70 | – | – | – | – | +7 |
| all misses | 450 | 198 | +10 | +12 | +18 | +22 | +8 |

A perfect pointwise selector over {x1, commit, single (+ CAD)} is worth ≈ +3.7 to +4.3 weighted (hits +40 to +47 of 1,050), split evenly between sure and unsure commits. The bound is the size of the prize; a verifier at pairwise accuracy p keeps roughly p·fixes − (1 − p)·breaks of it, so it needs p well above 0.5 and a prior for x1's sure answers.

Per alternative, fixes and breaks vs x1 are about equal on the unsure path (`l-xtab.js`, hits, YES email = gold): commit answer +14/−17, single read +18/−13, CAD single read +10/−8, thread labels +10/−9. On sure commits the CAD single read is +14/−1 (u's u-xyc case) and the plain single read +18/−10. So a selector's value is almost entirely its ability to tell a fix from a break.

**Trivial selectors to beat** (`l-baseline.js`, same candidate pools as the GPU diagnostic below, mixed questions, pairwise accuracy over (right, wrong) pairs within a question; four dev sets):

| selector | all pairs (7,485) | hits (3,397) | misses (4,088) |
|---|---|---|---|
| longer answer | 49.1 | 52.8 | 46.0 |
| more producing variants ("support") | 50.9 | 62.0 | 41.6 |
| lexical grounding in x1's YES email (share of the answer's novel words found there) | 58.8 | **69.8** | 49.7 |
| lexical grounding in the gold email (not deployable) | 82.1 | 73.6 | 89.3 |

Lexical grounding is far from a coin flip on these pools because many wrong candidates were read from other emails. As a deployable selector on x1's own candidates (`l-lexsel.js`, stored proxies; switch to a candidate only if its YES-email grounding is higher): x1 + {commit, single} +0.57 [0.0, 1.4], x1 + {commit, single, CAD} +0.66 [0.2, 1.6] vs x1 over 1,500 questions (hits sure +8/−4, unsure +13/−9; misses lose, unsure −13/+7). With a 0.1 margin: +0.60 / +0.77. So e2b's verifier has to beat ≈ 70% pairwise on hits and ≈ +0.7 weighted to be worth its calls.

## 2. Verifier diagnostics (GPU, `l-v1`, `l-v2`)

Candidate file `.data/premise2/explore/l-cands.json` (`l-build.js`): per question ≤ 8 distinct candidates (x1, x1.commit, g5, gates, oracles, u-ocad5, c-xT/c-fin1, d8r, y1, j2, t-lk, k3, p3, u-orep first, then by support), each with its own reading context; if the full pool is mixed but the first 8 are not, the most supported candidate of the missing class replaces the last one. Only mixed questions are scored; other questions return x1's answer with no call.

### 2.1 l-v1 on the four dev sets (S300-1, S300-2, S300-3, FULL-1: 821 mixed questions, 429 hits / 392 misses; 7,480 within-question (right, wrong) pairs)

Prompt "after" = the evidence first, then "Question: … / Proposed answer: …", then "Is the proposed answer correct and complete according to this email? Reply with only YES or NO." One output token, top-20 logprobs; s = logP(YES) − logP(NO). Wall per question (all 300/600, unscored questions take 0 ms): S300-2 1,528 ms (~27 verification calls per scored question), S300-1 1,702, S300-3 870, FULL-1 559. Pairwise = share of (right, wrong) pairs of the same question where the right answer scores higher (ties ½); per question this is the within-question AUC.

| evidence, form | pairwise all | **hits** | misses | AUC pooled (hits / misses) | hits, "hard" pairs (both answers ≥ 80% grounded in the evidence) |
|---|---|---|---|---|---|
| gold email, after (upper bound, not deployable) | 85.5 | **76.9** | 92.6 | 0.888 (0.796 / 0.933) | 52.2 (521 pairs) |
| **x1's YES email, after (deployable)** | 60.1 | **72.1** | 50.1 | 0.704 (0.743 / 0.579) | 50.6 (510) |
| candidate's own reading context, after | 76.7 | **74.6** | 78.4 | 0.763 (0.744 / 0.766) | |
| gold email, NO-framing ("is anything wrong or missing?", sign flipped) | 19.5 | 26.8 | 13.4 | 0.159 | |
| *lexical grounding in the YES email (no model)* | 58.8 | *69.8* | 49.6 | 0.652 | |
| *lexical grounding in the gold email (no model)* | 82.2 | *73.6* | 89.3 | 0.807 | |
| *longer answer* | 49.0 | 52.5 | 46.0 | 0.470 | |

S300-2 + FULL-1 alone (the first two runs): gold 74.6 / YES 70.1 / own 71.2 on hits; S300-1 + S300-3 replicate it.

- **The verifier is far better than a coin flip, but only a little better than word overlap.** On hits, with the gold email as evidence, e2b ranks the right answer above the wrong one 76.9% of the time; lexical grounding in the same email gets 73.6%. With the deployable YES email: 72.1% vs 69.8%.
- **NO-framing is read as the positive question.** Asked "is anything in the proposed answer wrong, or is part of what the question asks missing?", e2b says YES to right answers: the flipped score ranks the wrong answer higher 80.5% of the time. e2b does not process the negation; the un-flipped score (80.5% pairwise vs 85.5% for the positive form) is a weaker version of the positive question.
- **Calibration** (four sets, all scored candidates): YES email: P(right) 44% for s < −4, 41% for [−2, 0), 64% for [0, 2), 78% for [2, 4), 87% for s ≥ 4 (flat below 0: a NO against the YES email often means the answer came from another email). Gold email: 6% for s < −4, 25% for [−4, −2), 48% for [−2, 0), 75% for [0, 2), 87% for [2, 4), 95% for ≥ 4 (well calibrated).
- **What it detects: grounding, not reading** (`l-hard.js`). On pairs where both answers are lexically grounded in the evidence (≥ 80% of the answer's novel words appear in the email), the verifier is a coin flip: gold evidence 52.2% of 521 hit pairs, YES email 50.6% of 510; on the other pairs 79.8% / 73.9%. So e2b tells an answer read from *this* email from one read elsewhere (or invented), but not a right reading of the email from a wrong one (relation inversions, the wrong item of a list). The residual hit errors (j.md: wrong fact or relation from the right email) are exactly the hard pairs.
- On misses, the YES email is usually not the gold, so a check against it is uninformative (50.1%); against the candidate's own context it is 78.4% (wrong-context answers get NO).

Selection by argmax over the stored candidates, vs x1 (four sets): YES-email score, all ≤ 8 candidates: changed 663, fixes 75, breaks 80; x1-core (x1, its commit answer, g5, gates): +31/−35; x1 vs its commit answer: +14/−16. With the gold email (not deployable): all +257/−54, x1-core +59/−19. Own context: all +208/−59 (gold-only reads win on misses), x1-core +42/−43.

**Pair types a deployable selector faces** (`l-pairs.js`, four sets, x1's answer vs one stored alternative, decisive pairs only, YES-email score; hits where the YES email is the gold): x1 (g5) vs its commit answer, unsure hits, 65% (31 pairs; lexical 65%); vs the gold read alone, unsure hits 60% (30), sure hits 50% (28); vs the thread-labelled answer, unsure hits 84% (19). With a margin (switch only if the alternative scores > 1 higher) the switches look precise: commit +7/−1, single read +12/−3 (unsure) and +6/−1 (sure). (These pairs only exist where the YES email is the gold; §3 shows what happens when it is not.)

**Offline selection simulation** (`l-sim.js`, exact on stored candidates; x1 + deployable proxies, switch when the best alternative's score exceeds x1's by more than m; S300-2 + FULL-1, 900 questions; the margin was chosen here, so this is in-sample):

| pool (paths: sure + unsure commits + found) | m = 0 | m = 0.5 | **m = 1** | m = 2 | m = 3 |
|---|---|---|---|---|---|
| single read | +0.85 | +1.45 | **+1.45 [0.8, 2.7]** | +1.43 | +1.37 |
| commit + single | +0.63 | +1.23 | +1.34 [0.3, 2.5] | +1.20 | +1.32 |
| commit + single + labels | +0.74 | +1.52 | **+1.66 [0.6, 2.9]** | +1.52 | +1.49 |
| commit + single, lexical grounding instead of e2b (m = 0 / 0.1 / 0.2 / 0.3) | +0.46 | +0.66 | +0.31 | +0.74 | |

Flips for "commit + single + labels", m = 1: unsure hits +10/−4, sure hits +4/−0, found misses +4/−0, unsure misses +5/−7. Caveat: the single-read proxy exists only where j1/j2 stored it or the YES email is the gold (then oracles' text), so sure-commit hits with a non-gold YES email (where x1 is usually right from the other emails) are under-represented; the GPU run below is the real test.

Decision at this point: build the deployable selector (the verifier with a margin adds about +0.5 over lexical selection on the same candidates, and the switches it makes are mostly fixes). In hindsight (§3) the simulation was biased.

### 2.2 l-v2: answer before the evidence, and a "correct only" form (mixed hits, FULL-1 + S300-2)

Same 227 mixed hit questions and 1,703 (right, wrong) pairs as l-v1 on these two sets. "before" = question and proposed answer first, then the evidence, then both again and the YES/NO question (no prefix shared between candidates, so every call prefills the whole email: FULL-1 + S300-2 hits ≈ 150–730 ms per question in all). "plain" = the "after" form asking "correct" instead of "correct and complete".

| evidence, form | pairwise (hits) | AUC pooled | hard pairs (both ≥ 80% grounded) | easy pairs |
|---|---|---|---|---|
| gold, after (l-v1) | 74.6 | 0.775 | 51.1 (282) | 77.7 |
| gold, **before** | **76.8** | 0.798 | 56.0 | 79.5 |
| gold, plain ("correct" only) | 75.4 | 0.778 | | |
| YES email, after (l-v1) | 70.1 | 0.728 | 48.3 (263) | 72.2 |
| YES email, **before** | **72.2** | 0.753 | 57.8 | 72.9 |

Putting the question and the proposed answer before the email is about +2 pairwise points better (and a little above a coin flip on hard pairs, 56–58%; pairs cluster within questions, so this is weak evidence). Dropping "and complete" changes little (+0.8). Calibration of "before" is shifted up (more YES: 87–88% right at s ≥ 4, but 33–49% right below 2). §3.2 tests whether the better form rescues the deployable selector.

## 3. Deployable selector (`variants/l-sel.js`)

`l-xs1` = x1 unchanged (same calls, same order); then, when x1 ends on a sure commit, an unsure commit (→ g5) or explore-found, it generates the YES email read alone (sandwich prompt, as oracles / j1) and gates' prompt with c's thread labels over x1's final context, and verifies every distinct usable candidate (x1's answer, its commit answer, the single read, the labelled answer) against the YES email with the "after" prompt. It switches from x1's answer only if the best alternative scores more than 1 higher (margin fixed from the in-sample simulation above). Every candidate, score and lexical grounding is logged; `l-grade.js` grades all candidate texts, so `l-xeval.js` replays any rule (pool, margin, lexical) exactly on the run's own candidates, relative to the run's own x1 answer. `l-xs2` = the same without the labelled candidate (defined, not run).

### 3.1 S300-1 and S300-3 (fresh dev sets; neither was used for the margin)

| id | set | weighted | Δ vs x1 (stored) [CI] | Δ vs gates (stored) [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|---|
| l-xs1 | S300-1 | 85.9 | −1.74 [−4.8, 1.0] | +2.1 [−1.8, 5.7] | 44.0 | 89.0 | 3,018 | 9.33 |
| l-xs1 | S300-3 | 84.3 | −1.74 [−4.3, 0.7] | +0.6 [−2.2, 3.4] | 33.0 | 88.0 | 2,754 | 9.17 |
| **l-xs1** | **pooled 600** | 85.1 | **−1.74 [−3.4, −0.1]** | +1.3 [−1.0, 4.6] | 38.5 | 88.5 | 2,886 | 9.25 |
| x1 (stored) | pooled 600 | 86.8 | – | +3.0 | 43.5 | 90.0 | 1,999 / 1,702 | 5.4 / 5.3 |

Extra cost (S300-1): single read + labelled answer 975 ms per question, verification 160 ms (3–4 one-token calls on a cached prefix); the variant sits close to the 3,243 ms cap.

Reproduction: inside l-xs1, x1's own answer equals the stored x1 text on **300/300 questions on S300-3** (the extra calls come after x1's and did not perturb later questions there), so S300-3's −1.74 is entirely the selector's switches; on S300-1 198/300 texts and 267/300 steps match (the usual S300-1 re-roll, as for e1 in e.md), which is why the replayed rules are reported relative to the run's own x1 answer.

Flips vs stored x1 (pooled 600): hits sure → single +2/−7, unsure → single +2/−3; misses unsure → single +2/−7, found → single 0/−3, sure → single 0/−2; unchanged paths ±1 (re-rolls). On sure-commit hits the verifier picked the single read worse than chance (always taking the single read there: +9/−9).

Replayed rules on both runs (Δ vs the run's own x1 answer, 600 questions): single read m = 1 −1.51 [−3.2, −0.4], m = 2 −1.04; commit answer only 0.00; labelled answer only −0.03; commit + single + labels m = 1 −1.74; lexical selection (commit + single, m = 0.1) −1.51; always the single read −1.11; always the labelled answer +0.66 [−1.1, 2.4] (c's thread labels; c found them null over 1,800 questions).

**Why the in-sample simulation was wrong** (`l-feat.js`, `l-show.js`). Of the 129 would-be switches (gap > 1), those where the YES email is the gold went +5/−3, those where it is not went **+1/−19**; switches where x1's own answer scored < −4 against the YES email went +2/−17. The simulation's single-read proxy only existed where the YES email was the gold (oracles' text) or where j1/j2 had stored a re-read, so it never saw the dangerous case. In a real run the single read is grounded in the YES email by construction, and the verifier, shown that same email, rates it highly, while x1's five-email answer, read from another email (often the right one: the commit check stops at the first YES, which on misses and on some hits is a distractor), scores very low. Verifying a candidate against the email it was read from is circular. Among switches between two right answers (most of them), the verifier prefers the shorter answer without extra, unsupported sentences. No gate on the logged features is positive on both sets (x1's score ≥ −4: S300-1 +3/−3, S300-3 +1/−2; YES-probe logprob ≥ −0.05: +1/−0, +1/−3).

**Decision: no decision-set run.** The selector is negative on 600 fresh dev questions (−1.7, CI excludes 0), its safe sub-forms (no single read) almost never switch (commit or labels only: 0.00 / −0.03), and no gate has support on both sets. Neither S300-4/5 slot is used.

### 3.2 The better "before" form on the same candidates (`l-v3`, `l-build2.js`, `l-v3eval.js`)

`l-v3` re-scores exactly the candidates l-xs1 generated and verified on S300-1 and S300-3 (526 questions) with the "before" form against the same YES email (≈ 250 ms per question); rules replayed against the l-xs1 run's own x1 answer (600 questions):

| candidates | "after" (l-xs1's own scores), m = 0 / 1 / 2 | "before" (l-v3), m = 0 / 1 / 2 |
|---|---|---|
| single read | −0.57 / −1.51 / −1.04 | −0.84 / −0.11 [−2.0, 1.8] / −0.81 |
| commit + labels | −0.03 / −0.03 / −0.03 | +0.66 [−0.5, 1.9] / +0.23 / −0.27 |
| commit + single + labels | −1.04 / **−1.74** / −1.27 | −1.04 / −0.07 [−2.1, 2.0] / −1.04 |

The "before" form removes most of the hit-side damage (sure-commit hits +6/−5 instead of +2/−7 at m = 1) but not the circular miss-side losses (misses still +3/−12), and nothing is positive beyond noise: the best cell, commit + labels at m = 0 (+0.66, mostly c's thread labels), is the size of u's padding placebo on the decision sets (+0.7). So a better prompt does not rescue selection.

### 3.3 Side finding: the verifier as a between-question confidence signal (`l-trigger.js`)

On the 439 questions of the two runs where x1's answer was verified (≥ 2 distinct candidates; a selected subset), the verifier score of x1's own answer against its YES email predicts x1's correctness with AUC 0.714, vs 0.688 for the YES-probe logprob, 0.600 for lexical grounding and 0.589 for the commit answer's mean token logprob. On sure-commit hits (n = 174) it is 0.691, where the logprob gate has no signal left (0.43, range-restricted by the gate). So the verifier knows *which questions* x1 is likely wrong on, like n's logprobs, but within a question it cannot pick the right one of several grounded answers. Using it as an escalation trigger would need a better second answer than any found in rounds 3–5 (on hits every alternative is a coin flip: e.md, n.md, c.md, this note); not pursued.

## 4. Conclusions

- **e2b's pointwise self-verification is a grounding check, not a correctness check.** With the gold email as evidence it ranks a right answer above a wrong one in 76.9% of hit pairs (92.6% on misses, AUC 0.89), well above a coin flip, and it is well calibrated (P(right) 6% at s < −4, 95% at s ≥ 4). But word overlap with the same email already gets 73.6% on hits, and on pairs where both answers are drawn from the email (≥ 80% of their words) the verifier is at 52% (gold) / 51% (YES email). It tells an answer read from *this* email from one read elsewhere or invented; it cannot tell a right reading from a wrong reading of the same email, which is what x1's remaining hit errors are (wrong fact or relation from the right email, j.md).
- **NO-framing fails outright**: "is anything wrong or missing?" gets YES for right answers (flipped score 19.5% pairwise): e2b answers the positive question and ignores the negation.
- **Prompt form matters a little:** question and proposed answer before the email is +2 pairwise points (gold 76.8, YES email 72.2 on 1,703 hit pairs) and 56–58% on hard pairs; re-scoring l-xs1's candidates with it turns −1.74 into −0.07 [−2.1, 2.0], still no gain.
- **Deployable evidence makes it circular.** The only answer-bearing email a deployed x1 knows is its own first YES email. A single read of that email is grounded in it by construction, so the verifier prefers it, while x1's five-email answer, often read from another (right) email, scores low. On fresh dev sets the selector `l-xs1` is −1.74 [−3.4, −0.1] vs x1 over 600 questions (S300-1 −1.74, S300-3 −1.74); switches with a non-gold YES email went +1/−19. Lexical selection on the same candidates is no better (−1.5), and the non-circular candidates (x1's commit answer, the thread-labelled answer) almost never win by the margin (0.00 / −0.03).
- **The in-sample offline simulation (+1.45 to +1.66 on S300-2 + FULL-1) was an artefact** of which stored proxies exist: a "single read" proxy existed almost only where the YES email was the gold. Lesson for stored-answer simulations: a proxy's availability can be correlated with its correctness.
- **Side finding:** the verifier score of x1's own answer is a between-question confidence signal (AUC 0.71 on verified questions, vs 0.59 for x1's answer logprob, 0.69 for the YES-probe logprob), including on sure commits where the logprob gate has no signal left. It has nothing to escalate to: on hits, every alternative answer tried in this project is a coin flip.
- **Best id: none.** `l-xs1` is not a candidate; no S300-4/5 slot was used. Oracle selection among x1's own deployable candidates is worth ≈ +4 weighted (§1), but no e2b-internal selector found in this study (logprob, agreement, pairwise choice, pointwise verification, lexical grounding) recovers it.

## Files

- `benchmarks/premise2/explore2/variants/l-common.js`: `verifyPrompt(form, question, answer, emails)` (forms after / plain / no / before), `verify(ctx, …)` (one-token YES/NO call, score = logP(YES) − logP(NO) over case variants, top-20 logprobs).
- `benchmarks/premise2/explore2/variants/l-diag.js`: diagnostics `l-v1` (stored candidates on mixed questions; gold / YES email / own context; after and NO forms; run on all four dev sets), `l-v2` (v2: mixed hits only; before forms on gold and YES email, plain form on gold; FULL-1, S300-2) and `l-v3` (re-scores l-xs1's logged candidates with the before form; S300-1, S300-3).
- `benchmarks/premise2/explore2/variants/l-sel.js`: deployable `l-xs1` (x1 + commit / single / labelled candidates + verification, margin 1; run on S300-1, S300-3), `l-xs2` (same without labels; not run); exports `selectAmong`, `yesOf`, `lexGround`.
- Tools `benchmarks/premise2/explore2/tools/`: `l-lib.js` (candidate pools, bootstrap, AUC), `l-inventory.js`, `l-pools.js`, `l-bound.js`, `l-xtab.js`, `l-baseline.js`, `l-lexsel.js`, `l-build.js` (writes `.data/premise2/explore/l-cands.json`), `l-stub.js` (no-GPU dry run), `l-eval.js`, `l-pairs.js`, `l-hard.js`, `l-sim.js`, `l-grade.js` (J1 for logged candidates), `l-xeval.js`, `l-show.js`, `l-feat.js`, `l-trigger.js`, `l-build2.js` (writes `.data/premise2/explore/l-xs-cands.json`), `l-v3eval.js`.
- J1 spend for l: ≈ $0.004 (`cli2.js grade` of l-xs1, 51 calls; `l-grade.js` of the logged candidates, S300-1 75 calls and S300-3 ≈ 85). The diagnostics needed no grading (stored, already graded texts).
