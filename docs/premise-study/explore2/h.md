# Hybrid perfecter (prefix h), round 2

Mission: best hybrid (fixed pipeline + conditional extra steps) for e2b within 3,243 ms, gains from misses without touching hit answers.
Code: `explore2/variants/h-hybrid.js`; offline tools `explore2/tools/h-common.js`, `h-calib.js`, `h-sim.js`, `h-depth.js`, `h-check.js`.
Caches: r's dev caches (`<scratch>/r-features.json`, `r-ce.json`; FULL-0 + S300-1 + S100-x) and, for evaluation only, `<scratch>/h/r-features-S300-2.json`, `r-ce-S300-2.json` (same tools, S300-2; not used for tuning).

## Design

Base = s1 (gates + r5 swap + mailbox dedup), reimplemented so that unfired answers are byte-identical to s1: the cross-encoder scores s1's exact batch first (an all-candidates batch changed 2/60 swaps through batch numerics; with the split batch `h-check.js` reproduces s1's stored first context on 60/60).
Failure detector on s1's answer: `src` = the context email holding most of the answer's novel words (a-common `attribute`).

## 1. Offline trigger calibration (no GPU; `h-calib.js`, stored answers gates FULL-0, gates S300-1, r5 S300-1; n = 1,200)

Fire rates (%) by stratum × correctness of the stored answer; "fixable" = wrong misses with an AB email unseen in mailbox top 30.

| trigger | ok hit | bad hit | ok miss | bad miss | fixable |
|---|---|---|---|---|---|
| ceGap > 1 (best unseen CE − CE of src) | 8.6 | 13.8 | 54.7 | 64.3 | 67.1 |
| ceGap > 3 | 3.7 | 10.6 | 32.8 | 29.1 | 28.7 |
| CE of src < 0 | 15.5 | 17.0 | 59.9 | 53.1 | 50.3 |
| coverage of src < 0.4 | 2.8 | 7.4 | 17.5 | 26.3 | 26.6 |
| covGap ≥ 0.15 (best unseen mailbox-20 coverage − src coverage) | 0.9 | 6.4 | 11.7 | 35.7 | 39.9 |
| ceGap > 1 & covGap > 0 | 1.1 | 5.3 | 11.7 | 39.9 | 45.5 |
| src not at position 1 & CE of src < 0 | 1.7 | 4.3 | 22.6 | 24.4 | 23.1 |
| abstention | 0 | 0 | 0 | 6.6 | 6.3 |

Lexical/CE detectors reach <2% of correct hits only at ~40–45% recall of fixable misses. CE alone is a poor detector (the CE disagrees with BM25 on many correct hits).

The sharper detector is e2b itself: **one YES/NO probe on src** (w7's relevance prompt). Measured on S300-2 from w7's stored probe lists (w7 probed gates' 10 + header mailbox 15; src covered for ~97%), against s1's answers:

| s1 answer | n | src probe NO | src NO and some unseen email YES (= replacement fires) |
|---|---|---|---|
| hit correct | 181 | 20 (11%) | 4 (2.2%) |
| hit wrong | 19 | 3 | 0 |
| miss correct | 41 | 11 | 4 |
| miss wrong | 59 | 38 (64%) | 23 (39%) |

Composition simulated offline on S300-2 (`h-sim.js`, base s1, alt = w7's stored answer when fired): never 87.13 (s1); always w7 85.74; **src NO & unseen YES → w7: 87.61** (miss 41 → 48, flips miss +9/−2, hit 0/0); best lexical trigger (t1) + same guard 87.47. (This simulation used S300-2, but no parameter was tuned on it: the guard is the probe's own YES/NO.)

Probe depth (`h-depth.js`, dev wrong answers with a non-AB src, n = 154): AB email among the unseen candidates (mailbox 30 ∪ global 10) within top N: by CE @8 50.6 / @16 59.1 %; by retrieval order 52.6 / 64.3; **by RRF(CE rank, retrieval rank) 57.8 / 65.6** / @30 71.4. → N = 16, RRF order.

## 2. Variants

| id | behaviour |
|---|---|
| h1 | s1; probe src; if NO (or s1 abstained), probe top-16 unseen (RRF order); if any YES, re-answer (sandwich) from the YES emails (≤5) and replace unless it abstains |
| h2 | h1, re-answer context = YES emails (≤4) filled to 5 from s1's final context minus src |
| h3 | h1 pre-gated by the lexical detector t1 (covGap ≥ .15, or ceGap > 1 & covGap > 0) |

| h4 | h1's escalation on an **r4 base** (gates + conditional CE swap); after the lead's FULL-0 result (r5's always-swap changes every non-switched hit prompt and lost 1.5 hit points on FULL-0) the base must leave hit prompts unchanged |
| h5 | h1's escalation on plain gates |
| h6 | h4 with h2's re-answer context |

`h-check.js`: h4's first context = r4's stored one on 50/50 S300-2 questions, h5's = gates' on 50/50 (stub generator).
Offline prediction (`h-sim.js`, w7's stored answers as the re-answer, guard src NO & unseen YES): r4 base 85.53 → 86.28 (miss 38 → 49, miss flips +12/−1, hit 0/0); gates base 85.06 → 86.01.

Expected cost: s1 (~1.24 s) + 1 probe (~0.1–0.3 s) + 16 probes on ~25% of questions (~0.5 s) + a re-answer on ~12%.

## 3. Results (S300-2, J1; gates 85.1 = miss 31 / hit 89.0)

h1/h2 (s1 base) were withdrawn before running, after the lead's FULL-0 result. Smoke (h4, h6, first 30 = misses): replaced 12 / 8, all flips positive.

| id | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| h4 (raw) | 85.6 | +0.5 [−0.7, 1.5] | 52 | 88.0 | 2,017 | 6.0 |
| h4 "clean" (r4's stored verdict where h4 answered from r4's own prompt) | 86.1 | +1.03 [−0.1, 2.1] (h-clean.js bootstrap) | 53 | 88.5 | | |
| r4 | 85.5 | +0.5 [0.2, 0.9] | 38 | 89.0 | 1,246 | 1.0 |

h4 steps (`h-pair.js` vs r4): src YES 228 (175 hits), no YES 40, replaced 31 (27 misses, 4 hits), re-abstain 1.
- **Replaced: misses +16 / −1, hits 0 / −1** (lokey-t: src = gold at pos 2 got a false NO; the one YES email had lower CE than src, ceGap −1.05). Escalation alone ≈ +15 miss pts × 0.068 − 0.5 hit pts × 0.932 ≈ **+0.55 weighted** over r4.
- **Hit prompts changed: 4/200** (the replaced ones; 0 net gains, 1 loss). All other prompts are r4's, byte for byte (contexts checked 269/269).
- **Engine nondeterminism**: although the 269 unreplaced prompts are identical to r4's, 82 answer texts differ (first ~24 questions identical, then ~30% differ, independent of what the previous call was; no model reloads). Other multi-call runs (a5, s3, n-cr1) stayed byte-identical, so something in this run's interleaving (YES/NO probes with 3 output tokens?) perturbs e2b's greedy decoding. Verdict flips there: hit +1/−2, miss 0/−1, i.e. the raw −0.5 vs clean is noise from this, not from the method. A deterministic deployment (or the lead's re-run) should see ≈ the clean number.
- Possible guard (in-sample, 1 example, not run): skip replacement when ceGap < −1 (would remove the only hit loss and one 0/0 miss).

h6 (YES ≤4 filled to 5 from r4's final context minus src), S300-2: 85.0, Δ vs gates −0.0 [−1.5, 1.2], miss 51, hit 87.5, 1,991 ms; replaced misses +15/−1, **hits 0/−2**; clean 85.55 (+0.5). Filling the context with the old context hurts hits; dropped.

### Second set S300-1 (gates 83.9 = miss 34 / hit 87.5; r4 85.6)

| id | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| h4 (raw) | 85.4 | +1.6 [−1.1, 4.4] | 57 | 87.5 | 1,952 | 5.9 |
| h4 clean | 85.8 | +1.96 [0.2, 3.5] | 56 | 88.0 | | |
| r4 | 85.6 | +1.7 [0.7, 3.1] | 46 | 88.5 | 1,232 | 1.0 |

h4 vs r4: replaced misses 24 (+12/−2), replaced hits 2 (0/−1); unreplaced (identical prompts) hits +3/−4, misses +1/−0 (the same engine nondeterminism: only 186/274 unreplaced texts identical to r4).
The ceGap < −1 guard does not replicate (the S300-1 hit loss has ceGap −0.79, and 4 miss wins have ceGap < −0.5): dropped.

### Detector fire rates (both sets, 600 q)

| | S300-2 | S300-1 |
|---|---|---|
| src probe NO → 16 probes (cost step), hits | 25/200 (12.5%) | 30/200 (15%) |
| … misses | 47/100 | 41/100 |
| replacement, hits (hit prompt changed) | 4/200 (2.0%), net 0/−1 | 2/200 (1.0%), net 0/−1 |
| replacement, misses | 27/100, net +15 | 24/100, net +10 |

Wall: questions whose src got YES ≈ 1.53 s (r4 + one probe), probed ones ≈ 3.4 s; mean 1.95–2.0 s (under shared-CPU load), 5.9–6.0 calls.

## 4. Conclusions

- Best: **h4** = r4 + probe escalation. Escalation increment over r4 (replaced questions only, both sets): misses +28/−3 of 200 (+12.5 pts), hits 0/−2 of 400 (−0.5 pt) → ≈ **+0.4 weighted** (S300-2 +0.55, S300-1 +0.2). Same size as a5, with 6 hit prompts changed in 400 (net −2) vs a5's 0.
- vs gates: raw +0.5 (S300-2) / +1.6 (S300-1); "clean" (r4's own verdicts where the prompt was r4's) +1.0 / +2.0. Not a clean promotion: the gain over r4 is miss-side and modest.
- The e2b probe on the answer's own source email is a better failure detector than any lexical/CE feature (src NO on 64% of wrong misses vs 11% of correct hits; with "some unseen email YES" 39% vs 2.2%), but its false NOs on gold (≈10% of hits) are what costs the hit losses when a YES distractor exists.
- Engine nondeterminism: in h-runs, identical prompts gave different texts on ~30% of questions (other workers' multi-call runs did not). Worth checking before trusting small Δs from variants that interleave very short (3-token) calls.
- Not done: stacking with a5 (both target non-switched misses, expected overlap); re-answer context with src appended (h2-style "YES + best") — h6's result suggests old-context emails hurt.

---

# Round 4 (Tue 6 Oct, 16:40–19:15 ET): hit-side reading on x1's unsure-commit (handover) path

Code: `explore2/variants/h-spec.js` (h7, h8; ids h1–h6 are round 2's). Offline tools: `tools/h-handover.js` (handover anatomy, joins x1 / j1 / j2 answers with m-diag's five W0 probes), `h-agree.js` (A~S agreement policy, vague detector on handover answers), `h-vague.js` (vague detector over every stored graded answer), `h-stub.js` (stub routing check, no GPU), `h-flips.js` (flips vs x1 / j2, re-ask cases; JUDGE=1 grades never-graded old answers without storing), `h-extract.js` (m-diag extract read as a third reading, J1-graded into scratch).
Notation on the handover path: A = gates' unsure answer over W0, S = single read of the first YES email (j1's logged read), B = g5's answer, j2 = S if S is confident (mean lp ≥ −0.1) else B.

## R4.1 Offline: where the handover path fails after j2

Handover questions (x1 step `commit-g5`), from `h-handover.js`:

| | S300-2 hits | S300-2 misses | S300-1 hits | S300-1 misses |
|---|---|---|---|---|
| n | 72 | 32 | 67 | 32 |
| x1 right / j2 right | 63 / 65 | 13 / 11 | 59 / 59 | 14 / 12 |
| first YES email is AB | 69 | 11 | 63 | 8 |
| W0 YES count (m-diag) = 1 / 2 / ≥3 | 52 / 12 / 8 | 13 / 11 / 8 | 50 / 7 / 9 (+1 none) | 11 / 12 / 8 (+1 none) |
| ≥2 YES and the YES set holds AB | 20 | 5 | 16 | 9 |
| ≥2 YES, first YES not AB, a later YES AB | 2 | 1 | 2 | 4 |
| j2 right where ≥2 YES | 18/20 | 3/19 | 13/16 | 9/20 |

(m-diag's first YES = x1's first YES on 201/203 handovers; the probes are reproducible.)

**Hypothesis (a), YES-filtered context, is mostly j2 already.** On 73% of handover hits exactly one W0 email probes YES, so "answer over the YES emails" is the single read j1/j2 already made. It can only change the ~36 hits / 39 misses per two sets with ≥2 YES emails, where j2 is already 31/36 right on hits; the room is ≤ 5 hits and ≤ 5 misses (first YES not AB, a later one AB) over both sets. Cheap to test as an add-on (h8), not expected to move much.

**Selection between existing readings is capped (z's finding replicated with S).** Among j2's g5-fallback questions, A and S agree (novel-word Jaccard ≥ 0.5) on 47 hits: S right 40, A 37, g5 44. Every "A ~ S agree → take S/A instead of g5" rule (thr 0.3–0.6) is −2 to +1 hits vs j2 on S300-2 (`h-agree.js`). Dropped.

**Vague answers are the one reliably wrong shape on this path.** Detector = `VAGUE` ("something", "someone", "the website", "a report/document/project/position…" not followed by a name, "does not specify/mention", "unspecified") ∪ n's `HEDGE` ∪ a leaked corpus path ("hyvl-d/all_documents/1102."):
- over all stored graded answers (S300-2, S300-1, FULL-0; 36,049 hit answers) vague-not-hedge hit answers are 67.8% right vs 86.5% overall; hedges 8.9% (`h-vague.js`);
- on the handover path (both sets) the detector fires on j2's final answer for 10 hits (5 right) and 6 misses (2 right); on A for 9 hits (3 right); on S for 9 hits (3 right). On sure commits it fires on 4 hits, all right → **trigger on the handover path only**.
- The 15 wrong handover hits left after j2: PART/vague 6 (seven-mile project → light rail; Sheetal → Midmarket; Kim Decell's attachment name; Ben Brasseaux's sick-time question; Pipeline Notes → AOPL's website; Chris Germany → Deal Volume Tracking report), WF 2 (hurricane 5 AM vs 11 AM, memorial vs scholarship), WE 2 (Tradespark via g5; Ed McMichael, YES email not AB), AMB 2, GRAN 1 (x3-9890), OVER 1, 1 judge call on a right-looking answer. In 5 of the 6 PART cases the YES (gold) email states the specific thing verbatim ("expansion to Metro's light rail system", "Midmarket will grant…", "Association of Oil Pipe Lines", "you ran the Deal Volume Tracking report", the forwarded sick-time text).

## R4.2 Candidates (queued 16:45 ET: S300-2 then S300-1)

- **h7** = j2 + specificity re-ask. Only on the handover path (j2's `commit-single` / `commit-g5`), when the final answer is vague / hedged / leaks a path: one more call over the YES email with an exact-detail prompt (own instruction first, no shared prefix with the sandwich prompt; "copy the exact name, title, file name, number, date, website, organisation or role; no general description; resolve 'our website' / 'the attached file' / 'your question' with the email's own words"). The new answer replaces the old only if it is usable (not abstained / hedged / vague) and adds a specific token (capitalised word, number, URL, quoted span) absent from the old answer and the question. Expected fire rate ≈ 16 / 600 questions; ceiling ≈ +5 hits pooled, risk ≈ 5 right vague hits.
- **h8** = h7 + YES-filtered context (hypothesis a): on unsure commits the rest of W0 is probed (x1's probe); with ≥ 2 YES emails the question is first answered over the YES emails only (rank order, sandwich prompt), kept if confident (≥ −0.1, no hedge/abstention); else j2's cascade. The re-ask reads the YES emails. h8 − h7 isolates (a).
- Every non-handover path is x1's call sequence (j2's wrapper); stub check (`h-stub.js`): routing, re-ask prompt holds exactly the YES email(s) 6/6 in each configuration.
- Not built: (c) "A ~ S agreement" (offline nil, above); header-contradiction filtering of W0 (the WE cases on this path come from g5's own reads and one false YES, not from W0 distractors the probe accepted).

## R4.3 h7 on S300-2 (J1)

h7 is **byte-identical to stored j2 on 297/300 questions** (every path, including the 66 g5 fallbacks and 35 single reads), so its Δ vs j2 is exactly the re-ask's effect. The re-ask fired on 9 questions (6 hits) and was accepted on 3 hits: all 3 changed verdicts or stayed wrong — Sheetal: wrong → wrong (quotes "who do I need to speak to…"), Ben Brasseaux: wrong → wrong (quotes "Carmen, please assist me with this"), **Livia: right → wrong** (re-read finds "gained weight", j1's known misread). Rejected re-asks: Pipeline Notes (re-ask answers "We will have this correspondence up on our website soon" — e2b does not resolve "our" to the newsletter's association), Kim Decell (copies the description as the title), the path leak (re-ask leaks the same path), Barry Tycholiz (right, kept).
Result: hits +0/−1 vs j2 (+2/−1 vs x1), misses identical to j2. **The specificity re-ask does not work with e2b**: the vague answers are a reading limit (e2b quotes the referring phrase instead of resolving it), not a prompt problem; the "novel quoted span" acceptance test lets quoted non-answers through.

## R4.4 A third reading from stored data: m-diag's extract read (offline, `tools/h-extract.js`)

m-diag logged an email-first one-sentence extract read (own prompt, logprobs) of every YES email. Graded with J1 for the first YES email of all 203 handovers (≈ $0.01, verdicts kept in scratch, not in verdicts.jsonl). As a fallback when j2's single read is unsure (instead of g5): hits S300-2 64/72 (j2 65), S300-1 60/67 (j2 59) at τ −0.1 (E's own mean lp); "E agrees with S" 64 / 57; "final vague → E" 66 / 59. On j2's g5-fallback hits E is right where g5 is wrong 6 times and wrong where g5 is right 13 times. Another reading of the same email does not beat g5, and e2b's confidence does not pick the right one (z's cap again). No GPU run.

## R4.5 S300-2 results (J1; paired stratified bootstrap from `t-ladder.js`)

| id | weighted | Δ vs x1 [CI] | Δ vs j2 [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| h7 | 86.5 | +0.3 [−1.1, 2.1] | −0.5 [−1.4, 0.0] | 45.0 | 89.5 | 1,792 | 5.53 |
| h8 | 86.6 | +0.5 [−1.2, 2.3] | −0.3 [−1.3, 0.3] | 47.0 | 89.5 | 1,971 | 6.86 |
| j2 | 86.9 | +0.8 [−0.2, 2.3] | – | 45.0 | 90.0 | 1,778 | 5.50 |
| x1 | 86.1 | – | −0.8 | 47.0 | 89.0 | 1,820 | 5.59 |

- h7 = j2 + 3 accepted re-asks (R4.3): the only verdict change is Livia (hit, right → wrong).
- h8: the extra W0 probes (382, ≈ 3.7 per handover) found ≥ 2 YES emails on 41/104 handovers; the YES-context answer was confident and kept on 11 (misses **+2/0** vs j2: Chris Germany's local-production email, the California-update legislators; hits 0/0). Re-asks accepted 2 (wrong → wrong). The one lost hit (CPUC meeting date) is not the YES-context step (its YES-context read was unsure, −0.18): after the extra probes the single read of the same email came out different and confident ("October 24", j1's known misread) where j2's run had sent it to g5. The extra probes perturb the later calls through Ollama's cache, as x.md/j.md warned: g5 texts identical to j2's on 54/61, single reads 24/25.

## R4.6 S300-1 results and pooled (J1; `t-ladder.js`, paired stratified bootstrap)

| id | set | weighted | Δ vs x1 [CI] | Δ vs j2 [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|---|
| h7 | S300-1 | 88.0 | +0.3 [−0.2, 1.3] | +0.0 [0.0, 0.0] | 47.0 | 91.0 | 1,687 | 5.25 |
| h8 | S300-1 | 88.0 | +0.3 [−0.8, 1.4] | +0.0 [−0.9, 0.9] | 47.0 | 91.0 | 1,887 | 6.51 |
| j2 | S300-1 | 88.0 | +0.3 [−0.2, 1.3] | – | 47.0 | 91.0 | 1,703 | 5.22 |
| **h7** | **pooled 600** | 87.2 | **+0.3 [−0.7, 0.9]** | **−0.2 [−0.7, 0.0]** | 46.0 | 90.3 | 1,739 | 5.39 |
| **h8** | **pooled 600** | 87.3 | **+0.4 [−0.8, 1.4]** | **−0.2 [−1.1, 0.8]** | 47.0 | 90.3 | 1,929 | 6.68 |
| j2 | pooled 600 | 87.5 | +0.6 [−0.2, 1.1] | – | 46.0 | 90.5 | 1,741 | 5.36 |
| x1 | pooled 600 | 86.9 | – | −0.6 | 48.0 | 89.8 | 1,910 | 5.50 |

(Pooled vs gates: h7 +2.8 [0.7, 4.5], h8 +2.9 [1.0, 4.6], j2 +3.0, x1 +2.5.)

S300-1 details: h7 is again text-identical to j2 on 297/300 and verdict-identical on 300/300. Its re-ask fired 7 (4 hits), accepted 3 (all misses, verdicts unchanged: e2b answers by quoting the email's sentence — "He was checking out our german workers, to see if they were 'illegals'", "Become a Gold member today and send a Hi note…"). h8: YES context (≥ 2 YES on 35/99 handovers) kept on 6: hits 0/−1 (home-business email: the YES-context answer drops "lucrative tax benefits" that g5 had), misses 0/0; one hit +1 from a g5 re-run that came out differently (Gas Fundies; noise).

Flips on the unsure (handover) path, both sets:

| | vs x1 hits | vs x1 misses | vs j2 hits | vs j2 misses |
|---|---|---|---|---|
| h7 | +2/−1 | 0/−4 | 0/−1 (re-ask: Livia) | 0/0 |
| h8 | +3/−2 | +1/−3 | +1/−2 (YES ctx −1, cache noise −1/+1) | +2/0 (YES ctx) |

Mechanism totals: re-ask fired 16 (10 hits), accepted 6, changed 1 verdict (right → wrong). YES-filtered context kept 17 times: misses +2/0, hits 0/−1.

## R4.7 Conclusions (round 4)

- **No promotion.** h7 pooled Δ vs x1 +0.3 [−0.7, 0.9], h8 +0.4 [−0.8, 1.4]; both are −0.2 vs j2. Neither stacks on j2: h7 *is* j2 except on 6 re-asked answers; h8 adds ≈ 0 (misses +2, hits −1, plus cache noise on later calls).
- **(b) Specificity re-ask: refuted for e2b.** The vague answers on the handover path are the model's reading limit, not a missing instruction: told to give "the exact name / website / report", e2b quotes the sentence that refers to it ("We will have this correspondence up on our website soon", "Carmen, please assist me with this") instead of resolving the reference; on one confusing email it re-reads a different fact (Livia, j1's known misread). The detector is good (vague handover hits are ~1/3 right), the fix is not available to e2b in one call.
- **(a) YES-filtered context: ≈ j2.** 73% of handover hits have one YES email in W0, where (a) is j2's single read. With ≥ 2 YES emails the YES-only context is kept on 17/76 questions: misses +2/0, hits 0/−1. Probing the rest of W0 also perturbs the later calls (g5 texts identical to j2's on 101/115; one single read flipped to a confident misread).
- **(c) Third reading / selection: capped.** "A ~ S agree" rules and m-diag's extract read (email-first prompt) as a fallback are within ±1 hit of j2 per set offline (`h-agree.js`, `h-extract.js`); g5 beats the extract read 13 to 6 where they disagree. Header-contradiction filtering of W0 was not built: the remaining WE errors on this path come from g5's own reads (1) and a false YES (1), not from W0 distractors.
- What is left on the path after j2 (15 wrong hits over both sets): 6 vague/incomplete (e2b cannot resolve the reference), 2 wrong fact, 2 other email, 2 ambiguous question, 1 granularity (x3-9890), 1 over-answer, 1 judge call. None has a pipeline lever that e2b can use; j2 remains the best handover rule.
- Cost: h7 ≈ j2 (+0.03 calls); h8 +0.19 s and +1.3 calls (YES/NO probes on the rest of W0 for unsure commits). GPU: 2 runs (S300-2, S300-1 × h7, h8); two queued replay runs (h9/h10, re-ask on stored j2/x1) were cancelled before starting as redundant once h7 proved byte-identical to j2. J1 spend ≈ $0.0005 via `cli2 grade` + ≈ $0.01 direct J1 calls for the extract study (scratch only).
