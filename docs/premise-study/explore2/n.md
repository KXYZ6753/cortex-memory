# n: new methods (round 2)

Worker: new-methods scientist, prefix n. Code: `benchmarks/premise2/explore2/variants/n-*.js`, offline tools `explore2/tools/n-*.js` (`n-lib.js` = shared loaders).

## Offline groundwork (S300-2, no GPU)

- **Union of prompt variants on gates' own first context** (`tools/n-union.js`): gates 85.1 (hit 89.0). gates ∪ o4 88.6, ∪ o5 89.0, ∪ pb 90.9, ∪ o4+o5+pb 93.0 (hit 97.0). The reading lottery is large: different prompts on the same five emails are right on different hits. A selector with any real signal could turn part of that into accuracy; answer voting (w-vote) failed because errors are correlated, so the selector has to come from somewhere else → e2b's own token probabilities.
- **Hedged answers** (`tools/n-hedge.js`, "does not specify / mention / provide …" that still answer): rare (S300-2 7/300, FULL-0 13/600) and ~10% correct; on FULL-0 11/13 are misses where the gold-only oracle is 92% right. A "soft abstain" signal, small upside (≈ +0.2–0.4).
- **Deterministic evidence sentences** (`tools/n-evrecall.js`): in gates' contexts (≈ 70 sentences per question), the answer sentence of the gold email (proxy: ≥ 50% of the gold answer's novel words) is in the top 3 by lexical overlap 54/137 (39%) and by MiniLM CE over the top 40 lexical 72/137 (53%), top 8 66%; CE ≈ 500 ms per question. An evidence block would put the wrong sentences first about half the time → deprioritised.
- **Question-type routing** (`tools/n-qtype.js`, `n-who.js`, FULL-0): hits by type: who 77.8% (n = 45; the gold-only oracle is also 77.8), when 86.4, other 91.4, url-contact 94.0, number 96.6. The who-failures are relation inversions (requester vs. sender, cc vs. to, "G-money") that the oracle gets wrong too: a model limit, not a format problem. Dropped.
- **Lexical grounding as a selector** (`tools/n-ground.js`): choosing among gates / o4 / o5 / pb answers by the share of the answer's novel words found in one context email: 85.7 at best (+8/−5 changed), noise. A selector needs a real confidence signal.

## Logprobs

This Ollama build returns token logprobs on /api/chat (`logprobs: true, top_logprobs: k`; confirmed by g-probe: `YES` −0.017, `NO` −5.06). Generating through `ctx.chatRaw` with `truncate: false` reproduces gates' contexts exactly (stub check, 300/300).

### n-lp0 on S300-2 (diagnostic; 3 calls, 2,036 ms; answer = gates')

gates through chatRaw with logprobs reproduces gates' stored text on 296/300 (o4 295/300, T2 = pb 238/300 where the context is the same). Tools: `tools/n-lpsel.js` (calibration + selection), `tools/n-calib.js` (buckets).

- **Calibration (between questions) is real.** AUC of gates' mean token logprob for "gates is right": hits 0.69, misses 0.72, all 0.73 (min-logprob 0.59 / 0.72; answer length ≈ 0.5).
- **Selection between prompts (within a question) is a coin flip.** Picking the answer with the higher mean / min / content-mean / first-10 logprob among gates, o4 and T2 on the same five emails: best rules 85.4–86.9 vs gates 85.1 with changed hits splitting about evenly (e.g. mean gates+o4: +6/−4; mean all three: +8/−5; min: +3/−3; first10: +5/−4). The one rule above +1.5 (summed logprob gates+T2, 86.9, +10/−6) is one of 60 tried, has 25 T2 answers without a verdict and favours short answers: multiple-comparison noise, not promoted. **Conclusion: e2b's confidence tells which questions it is likely wrong on, not which of its own answers is right.** When the prompts disagree, they are equally confident in both readings.
- **Where low confidence lives** (gates' mean logprob buckets, S300-2): bottom 10% (< −0.206): hits 11 at 91% right, misses 19 at 11% right with the gold in context in only 2. 10–30%: hits 37 at 76%, misses 23 at 22%. Top 50%: hits 110 at 94%, misses 40 at 40%. So the bottom decile is mostly *wrong-context misses* → a retrieval trigger, not a reading one.

### n-cs2@1: confidence selection on top of s1 (S300-2, graded)

(Queued as a placeholder before n-lp0's analysis; the runner loads variant code at queue time, so it ran the original definition.) s1's contexts; sandwich, o4 and T2 answers on the final context; the highest mean token logprob wins. **86.5 (miss 45, hit 89.5), Δ vs gates +1.4 [−1.6, 4.7], vs s1 −0.7 [−3.6, 2.3]**; 2,449 ms, 3.0 calls; picked sandwich 101, o4 122, T2 77. Same verdict as the offline simulation: confidence selection among prompts loses a little against just using the sandwich answer (s1 87.1). Killed.

### Replication: n-lp0 on S300-1 (diagnostic, 2,037 ms)

Texts match stored gates 299/300, o4 298/300. AUC of gates' mean logprob for correctness: hits 0.74, misses 0.63, all 0.71 — calibration replicates. Selection again a coin flip or worse: mean gates+o4 83.6 (+3/−6), mean all three 81.3 (+3/−10), min all three 84.1 (+8/−9), and S300-2's best rule (sum gates+T2, +1.8 there) is **82.3 (−1.5)** here. Pooled over 600 questions no selection rule beats gates. Buckets: bottom decile hits 12 at 83%, misses 18 at 17%; top half hits 110 at 95%.

### Confidence-triggered retry (n-cr): offline recall of the retry context

Trigger = first (gates) answer abstains, hedges, or mean logprob < −0.2 (`tools/n-trigrecall.js`). S300-2: fires on 34 misses (gates right on 3, gold in the first context 3) and 14 hits (10 right). Gold in the retry context: fresh unseen (other context, then header-ranked mailbox) 7/34; CE top 5 of unseen mailbox top 30 + global 6–20 11/34. S300-1: 30 misses (7 right), 17 hits (13 right); fresh 6/30, CE 9/30. Ceiling ≈ +6–8 miss points ≈ +0.5 weighted; hits only change when the second answer is more confident.

- n-cr1@1 (ran the queued early definition: s1 base, τ = −0.3, other context): **87.2 vs s1 87.1** (+1 miss), 1,249 ms, 1.1 calls; fired on 21, kept the second answer 14 times. The other context rarely has the gold.
- n-cr1 v3 (fresh context) and n-cr2 (CE retry context) were queued and then withdrawn before running in favour of the gated-swap idea below (ceiling ≈ +0.5).

## Key finding: confidence decides WHERE a change can help (n-gate)

Per hit question, split by gates' own confidence (mean token logprob of its answer from n-lp0, τ = −0.1 ≈ the median), and count the hit flips vs gates of every stored variant on the set (`tools/n-flips.js`):

| set | confident hits: right only in variant / only in gates | unsure hits: variant / gates |
|---|---|---|
| S300-2 (27 variants) | **+34 / −76** | +76 / −87 |
| S300-1 (23 variants) | **+15 / −122** | +112 / −104 |

On hits that gates answers confidently (~95% right), every alternative context or prompt only loses; on unsure hits (~70–75% right) alternatives are a fair coin. This is the mechanism behind "any prompt change flips ~5% of hits at random, net negative" (e.g. r5 on FULL-0: hits −1.5): the losses sit on confident hits. Unsure misses are mostly wrong-context, where retrieval changes help (r5/s1/k3 on unsure misses: +5…+13 / −0…1).

So: **answer with gates; only when its answer is unsure, answer with the retrieval-improved pipeline instead** (replace, no comparison: within-question confidence comparison is a coin flip). Offline composition (`tools/n-gatecompose.js`, stored answers, τ = −0.1, fires on ~49%):

| policy | S300-2 | S300-1 | hit flips (S2 / S1) | miss flips (S2 / S1) |
|---|---|---|---|---|
| gates | 85.1 | 83.9 | | |
| r5 alone | 87.0 (+1.9) | 84.3 (+0.4) | | |
| **gates, r5 if unsure** | **86.9 (+1.9)** | **85.5 (+1.7)** | +4/−1, +5/−3 | +7/−0, +12/−1 |
| r4 alone | 85.5 | 85.6 | | |
| gates, r4 if unsure | 85.5 (+0.4) | 85.5 (+1.6) | +0/−0, +2/−0 | +6/−0, +11/−1 |
| gates, s1 if unsure | 87.1 (+2.0) | – | +4/−1 | +9/−0 |
| gates, s3 if unsure | 87.2 (+2.1) | – | +4/−1 | +11/−0 |
| gates, o4 if unsure (prompt only) | 85.7 (+0.6) | 85.2 (+1.3) | +5/−4, +7/−4 | |
| gates, pb if unsure | 85.0 | 83.2 | pb alone hit 87.0 → 89.5 gated | |

τ sensitivity for gated r5: S300-2 −0.1 +1.9, −0.13 +1.8, −0.16 +1.3, −0.2 +1.2; S300-1 −0.1 +1.7, −0.13 +1.0, −0.16 +0.5, −0.2 −0.3. τ = −0.1 was picked after looking at both sets (a mild post-hoc choice; the lead's FULL-0 r5 answers + a gates logprob pass would be the clean test).

## GPU results: gated swap

| id | set | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls | fired (unsure) | flips vs gates (miss / hit) |
|---|---|---|---|---|---|---|---|---|---|
| n-g5 | S300-2 | 86.5 | +1.4 [−0.4, 3.2] | 38 | 90.0 | 1,241 | 1.4 | 147 (107 r5, 40 switched → gates) | +7/−0 / +3/−1 |
| n-g5 | S300-1 | 85.5 | +1.6 [−0.3, 3.9] | 44 | 88.5 | 1,258 | 1.4 | 147 (116 r5, 31 switched) | +11/−1 / +4/−2 |
| n-g6 (s1 when unsure) | S300-2 | 86.5 | +1.5 [−0.4, 3.3] | 39 | 90.0 | 1,254 | 1.5 | 147 | +9/−1 / +3/−1 |
| *ref: r5* | S300-2 / S300-1 | 87.0 / 84.3 | +1.9 / +0.4 | | | 1,230 | 1.0 | all | |
| *ref: s1* | S300-2 | 87.1 | +2.1 | | | 1,146 | 1.0 | all | |

n-g5 on S300-2: the 153 confident questions reproduce gates' text exactly (153/153), so no confident hit can flip; all 11 verdict changes are on unsure questions, 10 of them gains. r5's rerun texts differ from stored r5 on 26/107 fired questions (r5 not fully deterministic), which explains real +1.4 vs simulated +1.9.

n-g5 on S300-1 reproduces the same profile: 153/153 confident questions keep gates' exact text; changed verdicts +15/−3. **Pooled over 600 questions (S300-2 + S300-1): n-g5 ≈ +1.5 (miss +18/−1, hit +7/−3)**, vs r5 alone ≈ +1.15 (and −0.8 on FULL-0 per the lead, where it lost 1.5 hit points). Within-set CIs still include 0.

## Conclusions

1. **Logprobs work and are calibrated between questions** (AUC 0.69–0.74 on hits, both sets), **but not within a question**: choosing between two prompts' answers by confidence is a coin flip (60 rules on S300-2, replicated null on S300-1; n-cs2 on S300-2 −0.7 vs its base s1). e2b is equally sure of both readings when prompts disagree.
2. **Where e2b's remaining errors are:** unsure answers (bottom half by mean logprob) hold almost all fixable errors. Unsure misses are mostly wrong-context (gold in the first context ~10%), so retrieval helps there. Unsure hits are ~70–75% right and alternatives are a fair coin there. Confident hits are ~95% right and every alternative variant loses on them (S300-2 +34/−76, S300-1 +15/−122 summed over 23–27 variants). This is why every simple hit-side change looked like a coin flip with a negative drift, and why r5 lost hits on FULL-0.
3. **Gating changes by confidence is a systematic mechanism:** keep gates' exact answer when confident (≈ half of questions, zero flips by construction), apply the retrieval change only when unsure. n-g5 (gates → r5 when unsure): +1.4 / +1.6, pooled ≈ +1.5, 1.4 calls, ~1,250 ms. The unsure threshold τ = −0.1 (≈ the median) was picked after seeing both sets' offline curves (τ −0.13: +1.8 / +1.0 simulated), so treat it as one degree of freedom spent.
4. Dropped: confidence selection among prompts (n-cs*), deterministic evidence sentences (answer sentence in the CE top 3 only 53%), question-type routing (who-failures are oracle-level relation errors), lexical grounding selection, confidence retry on the other context (n-cr1@1 +0.1 vs s1; the other context rarely has the gold).

**For the lead:** the clean test of n-g5 is FULL-0/FULL-1/S300-3. It would be good to also run a gates-with-logprobs pass (n-lp0, or just n-g5's first call) on FULL-0, so the gated composition can be checked offline against the stored FULL-0 r5 answers (prediction: the gated r5 keeps most of r5's +10 miss points and removes most of its −1.5 hit loss). The same gate can wrap any other candidate (s1, s3, k*, w7): offline on S300-2, gated s3 is +2.1 and gated k3 +1.4.
