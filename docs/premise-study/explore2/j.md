# j: hit-side reading errors on top of x1 (round 3)

Prefix `j`. Code: `explore2/variants/j-reread.js` (wraps x1, no copy), offline tools `explore2/tools/j-*.js`.
Angle: hits are 93% of the weight; every system reads hits at ~88–90, gold-only 92.2. Find the systematic part of the hit errors and fix only that, without perturbing correct hits.

## 1. J1 (the judge) — what it penalises

`judge.js referencePrompt`: gpt-oss-20b (think low), reference answers = gold + alternates. CORRECT if the same fact(s) as a reference, "even if worded differently, much longer, or quoting the email literally"; every requested part must be present; extra detail is fine unless it contradicts a reference; INCORRECT on refusal / "not available". So J1 is lenient on length and wording; it bites on (1) missing parts, (2) anything it reads as contradicting the reference (a second date, an extra name, a hedge "the email does not specify X"), (3) spelling/typo differences against the gold (in both directions).

## 2. Taxonomy of x1's wrong hit answers (read one by one)

Sets: S300-2 (22 wrong of 200 hits), S300-1 (19/200), FULL-0 (43/450; lead's x1 run, offline only). Tools: `j-dump.js` (answers + references + J1 reason + x1 step + gates/oracle verdicts), `j-taxonomy.js` (labels, counts).

| label | n | S300-2 / S300-1 / FULL-0 | where in x1 | what it is |
|---|---|---|---|---|
| WF wrong fact / relation from the right email | 23 | 4 / 6 / 13 | sure commit 11, handover 9, explore 3 | inverted requester/sender, wrong date of two, wrong amount, "previous administration" for Pete Wilson |
| PART incomplete or vague | 15 | 5 / 3 / 7 | **handover 11**, sure 2, explore 2 | "seeking assistance with something", "the website", omitted report name / outcome |
| STRICT correct-looking, judged wrong | 12 | 4 / 1 / 7 | **sure commit 11** | typo copied from the email ("God I s First", "Port Aranasas", "BBBOnLine" vs gold's "BBBOnLinec"), "you and Whaley" for the recipient, "continue until" vs "cease once", restated question dropping "invoices", a literal extra sentence (June 28) |
| WE another email read | 10 | 2 / 2 / 6 | **handover 7** (g5 read other emails), sure 2, explore 1 | Tradespark notice, other advisory, other contest email |
| AMB ambiguous question / gold is an inference | 6 | 0 / 4 / 2 | handover 4, sure 2 | "Haiduk line", "no specific event mentioned" |
| GRAN other granularity/format | 5 | 2 / 1 / 2 | mixed | full number vs extension x3-9890, "Jim" vs James Griffin, "RE: FW: erin pics", one project name split in two |
| HDR header / thread confusion | 4 | 2 / 0 / 2 | sure 2, explore 2 | forwarder vs original sender, cc vs to |
| HEDGE "does not specify" though present | 4 | 3 / 0 / 1 | handover 2, explore 2 | "Wed your time, and the email does not specify the time zone" |
| OVER extra contradicting detail / several candidates | 4 | 0 / 1 / 3 | handover 3, sure 1 | lists all three wire amounts, adds an extra recipient |
| TRUNC cut at 160 tokens | 1 | 0 / 1 / 0 | sure 1 | a 25-organisation list |

Readings:
- **Confident commits (gates' answer kept) fail mostly by STRICT (11) and WF (11).** STRICT is judge behaviour, not something a pipeline should chase (fixing it means copying the gold's spelling or dropping literal email text: judge-gaming; not attempted). WF there is e2b's reading limit (the oracle fails them too: n's who-analysis).
- **The handover path (unsure commit → g5) concentrates PART (11/15) and WE (7/10).** g5 reads other emails or answers vaguely. That is a reading-side failure the pipeline causes and can change.
- Surface-pattern second passes are nearly empty for x1: over all stored graded answers (29,650 hit answers, all variants; `j-patterns.js`) hedges are 1.2% of hit answers at 12% right, multi-candidate lists 0.6% at 61%, truncated 0.15% at 2% — but x1 already routes hedged/abstained commits to g5, so x1's *final* hit answers hedge/list/truncate only 7 times in 850 (`j-hedges.js`). Ceiling ≈ +0.4 hit points: not a lever on its own. Answer-length / "Additionally" / source-attribution cuts: o6 showed J1 is indifferent (0 verdict flips), o1 showed concision loses.

## 3. Hypothesis: re-read the YES email alone on unsure commits (j1, j2)

x1 hit accuracy by step (`j-steps.js`; FULL-0 also has the gold-only oracle):

| set | sure commit (gates' answer) | unsure commit → g5 | explore |
|---|---|---|---|
| S300-2 hits | 101/109 | 63/72 (gates' first answer 63) | 14/19 |
| S300-1 hits | 103/110 | 59/67 (gates' first answer 48/56 graded) | 19/23 |
| FULL-0 hits | 254/272 (oracle 258) | 120/141 (gates' first answer 119/140, oracle 124) | 33/37 |

Within the FULL-0 handover, splitting by whether x1's first YES email is the gold (`j-yesalone.js`): YES = gold on 120 hits, g5 103 right, **gold-alone oracle 107**; YES = gold on 20 misses, 15 vs 18; YES = another email on 15 hits (g5 11) and 26 misses (g5 8). The oracle answer is exactly what "answer from the YES email alone with the sandwich prompt" produces when the YES email is the gold, so: replacing the handover by a single-email read is ≈ +4 hits / +3 misses where YES = gold; where YES is not the gold it probably loses some misses (g5's own search finds 8/26). Simulated on FULL-0 (YES ≠ gold left at x1): 87.4 → 88.4 (+1.0; hit 90.4 → 91.3). With the cost of lost false-YES misses ≈ +0.7.

Why it should be systematic, not a coin flip: n showed alternatives are a coin flip on unsure hits when they are *another five-email reading*. The single YES email removes the distractors that caused WE (7 of the handover's errors) and the dilution behind PART; the gold-only ceiling (92.2 vs ~90) is the one consistent reading gain seen in the study. It also replaces g5's ~4 calls with 1 short call (cheaper).

- **j1** = x1; unsure commit → sandwich prompt over the YES email alone (logprobs logged); if that abstains or hedges → g5 (x1's handover).
- **j2** = j1, but the single-email answer must also be confident (mean token logprob ≥ −0.1), else g5 (keeps g5 for false-YES misses whose single read is shaky).
- Both: a final single-context answer cut at 160 tokens is re-asked with num_predict 400 (same prompt; honest fix, rare).

Implementation: x1 is called unchanged; its g5 handover is intercepted for the duration of the call (stub, no model call), then the wrapper reads the YES email (from x1's own probe log) and calls the real g5 only if the rule says so. Every non-handover path is the same call sequence as x1. Stub check (`j-check.js`): routing and that the single prompt holds exactly the YES email, 10/10.

## 4. GPU results

### S300-2 (J1)

| id | weighted | Δ vs gates [CI] | Δ vs x1 [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| j2 | 86.9 | +1.9 [−0.7, 4.8] | **+0.8 [−0.2, 2.4]** | 45.0 | 90.0 | 1,778 | 5.5 |
| j1 | 84.7 | −0.3 [−3.6, 3.1] | −1.4 [−3.7, 1.0] | 47.0 | 87.5 | 1,485 | 4.7 |
| x1 | 86.1 | +1.1 | – | 47.0 | 89.0 | 1,820 | 5.6 |

Flips vs x1 (`j-flips.js`): outside the handover both are **byte-identical to x1 on every question** (sure commits 130/130, explore 66/66), so all changes sit in the handover.
- j1 (single read on all 101 handovers): hits +3/−6, misses +3/−3. Its losses are single-email misreads with low confidence ("zero or one" for "1 to 5 missed", Livia's mother "gained weight" instead of "depressed", "October 24 agenda"), single-read mean logprob −0.12 to −0.22.
- j2 (single read kept only when its own mean logprob ≥ −0.1, 35 of 101; else g5): hits **+2/−0** (the Tradespark → Enron Corp. notice, Susan Mara's concern), misses +0/−2. Confident single reads were right on 22/22 hits. The g5 fallback reproduced x1's g5 text on 45/50 hits.
- Offline τ sweep for the single-read gate from j1's logged answers (`j-tau.js`; reproduces j2's real +0.8 exactly at −0.1): −0.15 +1.0, −0.11 +1.4, −0.1 +0.8, −0.08 +0.4, no gate −1.4. τ = −0.1 was fixed before the run (n's value); not re-tuned.

Reading: a single-email reread is not better per se (j1); what works is the *absolute* confidence of the single read as a second gate. That is between-question calibration (n: AUC ≈ 0.7), not within-question selection.

### S300-1 (J1)

| id | weighted | Δ vs gates [CI] | Δ vs x1 [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| j2 | 88.0 | +4.1 [1.2, 7.2] | +0.3 [−0.3, 1.4] | 47.0 | 91.0 | 1,703 | 5.2 |
| j1 | 87.4 | +3.5 [0.4, 6.9] | −0.3 [−3.0, 2.4] | 45.0 | 90.5 | 1,455 | 4.5 |
| x1 | 87.7 | +3.8 | – | 49.0 | 90.5 | 1,999 | 5.4 |

- j2 vs x1: same verdicts outside the handover except one sure-commit hit (+1, cross-run noise; sure-commit hit texts 109/110 identical, explore paths identical). Confident single reads (41): hits 29 vs 29 (0/0), misses 2 vs 4 (−2). g5 fallback hits 30 vs 30.
- j1 vs x1 on S300-1 is noisier (x1 itself did not reproduce across runs here, as x.md noted): handover hits +2/−1, misses +2/−5.
- τ sweep (`j-tau.js`): every gate value is within ±0.3 of x1 on S300-1 (−0.1: −0.07). S300-2's best τ (−0.11, +1.4) is −0.14 here: no τ is systematically good.
- Post-hoc split (confident single reads by YES position / switch; not run): restricting to "YES at W0 rank 1, not switched" gives hits +2/0 and misses −1/0 pooled — too small to justify another degree of freedom.

## 5. Conclusions

**Best: j2** (x1; an unsure committed answer is re-read from the YES email alone and kept only if that single read is itself confident, mean token logprob ≥ −0.1; otherwise x1's g5 handover; truncated answers re-asked with a longer limit).

| id | set | weighted | Δ vs gates [CI] | Δ vs x1 [CI] | miss / hit | wall ms | calls | flips vs x1 hits / misses |
|---|---|---|---|---|---|---|---|---|
| j2 | S300-2 | 86.9 | +1.9 [−0.7, 4.8] | +0.8 [−0.2, 2.4] | 45.0 / 90.0 | 1,778 | 5.5 | +2/−0 / +0/−2 |
| j2 | S300-1 | 88.0 | +4.1 [1.2, 7.2] | +0.3 [−0.3, 1.4] | 47.0 / 91.0 | 1,703 | 5.2 | +1/−0 / +0/−2 |
| j1 | S300-2 | 84.7 | −0.3 | −1.4 [−3.7, 1.0] | 47.0 / 87.5 | 1,485 | 4.7 | +3/−6 / +3/−3 |
| j1 | S300-1 | 87.4 | +3.5 | −0.3 [−3.0, 2.4] | 45.0 / 90.5 | 1,455 | 4.5 | +4/−4 / +2/−6 |

Pooled (600): j2 vs x1 **+0.55**, vs gates **+3.0** (x1 +2.45). Formally j2 passes the "Δ vs gates ≥ +2.5 pooled" clause, but not the "Δ vs x1 ≥ +1.0" one, and honestly its own mechanism is worth about +0.2–0.5: on hits +3/−0 (one of them cross-run noise on a path j2 does not change), on misses 0/−4 (a confident single read of a *false* YES email is confidently wrong, where g5's own search sometimes recovers). It is slightly cheaper than x1 (≈ −170 ms, −0.1 calls). If the lead wants a zero-risk add-on to x1 for FULL-1, j2 is it; expected Δ vs x1 ≈ +0.3.

What the hit errors are and why they mostly can't be fixed by the pipeline:
1. Of 84 wrong x1 hit answers (3 sets), the largest classes are wrong fact/relation from the right email (23) and judge strictness on correct-looking answers (12, almost all on confident commits). The first is e2b's reading limit (oracle fails most of them too); the second would need judge-gaming (copying the gold's spelling, removing literal email text) and was not attempted.
2. The handover path concentrates incomplete/vague answers (11/15) and wrong-email reads (7/10). A single-email reread fixes some of these (Tradespark → Enron Corp., "different fax number") but introduces as many misreads unless its own confidence is high (j1 vs j2).
3. Surface-shape second passes (hedges, candidate lists, truncation) have almost nothing to act on in x1's final answers (7 of 850 hits), because x1 already routes hedged commits to g5. Concision/attribution cuts are known losers (o1, o6).

What failed: j1 (unconditional single-email reread on unsure commits: −1.4 / −0.3 vs x1). Not tried by design: answer-form instructions by question type (n: who-type errors are relation inversions at oracle level; o1/o-series: prompt rules move hits at random), gold-spelling/format post-processing (judge-gaming).

Tools: `j-dump.js`, `j-taxonomy.js`, `j-steps.js`, `j-yesalone.js`, `j-patterns.js` / `j-lib.js`, `j-hedges.js`, `j-check.js` (stub, no GPU), `j-flips.js`, `j-tau.js`. J1 spend ≈ $0.002.
