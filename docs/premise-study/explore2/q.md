# Worker q (round 5): stack the small verified gains on x1, measured behind det()

Prefix `q`. Code: `explore2/variants/q-stack.js` (q1, q2 and their det forms). Offline tools: `explore2/tools/q-check.js` (stub call-sequence check), `q-peek.js`, `q-overlap.js` (design checks from stored answers), `q-table.js` (results, flips by path). Started Wed 7 Oct 07:11 ET.

Task: q1 = x1 + d8 + m2's recovery (miss and handover side; answer prompts unchanged); q2 = q1 + thread labels on the answer prompts. Measure both behind `det()` (i.md §6) against a det-wrapped x1, so the paired Δ holds only the mechanisms.

## 1. Design

### Components (all imported, none copied)

| component | source | acts on | what it does |
|---|---|---|---|
| d6 explore list (part of d8) | `d-agent.js` `lexicalPoolCtx` | x1's explore path (no YES in W0) | 15-line pick list = CE over own-mailbox W1 ∪ BM25 30 ∪ owner-stripped BM25 20 ∪ subject-weighted BM25 20 |
| d8 seeding | re-implemented hook (15 lines, same condition and list as d8's `withSeededG5`) | unsure commit → g5 handover | g5's first own mailbox search returns [first-YES email, ...BM25(query) top 20], then g5's header rerank |
| m2 recovery | `m-agent.js` `x1Contexts`, `recoveryLists`, `lpProbe` | commits whose first YES has token lp < −0.1 | YES/NO probes down snip50m top 6 (after gates' answer A); the first YES with lp ≥ yes1's (E) is answered first: [E, W0 top 4], sandwich, abstain retry over W1 |
| thread labels (q2 only) | `c-agent.js` `renderingCtx(ctx, { render: "thread1" })` | every sandwich answer prompt | chain emails get per-message labels; probes, picks, plans and g5 tool turns untouched |
| det | `i-det.js` `det(run, { mode: "all" })` | every model call | fixed 25-token reset call before each call (as `i-det-x1` v2) |

### How they compose (decision tree on a commit; yes1 = first W0 YES; A = gates' answer over W0, computed by x1 itself)

| yes1 token lp | A | m2 recovery | q1 does | equals |
|---|---|---|---|---|
| ≥ −0.1 | sure | – | A | x1 = d8 = m2 |
| ≥ −0.1 | unsure | – | g5, first search seeded with yes1 | d8 |
| < −0.1 | sure | no E | A (after the 6 probes) | m2 (= x1's answer) |
| < −0.1 | sure or unsure | E | answer over [E, W0 top 4] | m2 |
| < −0.1 | unsure | no E | m2's probes, then g5 seeded with yes1 | m2's calls + d8's g5 |
| no YES in W0 | – | – | explore with d6's list | d8 (= d6) |

- **d6's explore list and m2's recovery never act on the same question**: the explore path is "no YES in W0", m2 needs a YES. Nothing to arbitrate there.
- **The one shared point is a doubted, unsure commit** (yes1 lp < −0.1 and A unsure), where both m2 (recovery) and d8 (seeded g5) want to act. Rule: **m2 goes first**. If it accepts E, E's answer replaces the handover (no g5 call, so no seed). If it finds no E, g5 runs seeded with yes1, exactly as d8 would. Evidence, dev sets only:
  - keep the seed on a doubted yes1: d8r's seeded handovers with yes1 lp < −0.1 were hits +6/−1, misses +3/−1 vs x1 (S300-1/2/3, FULL-1; `q-peek.js`), as good as or better than on sure YESes (hits +2/−3, misses +3/−0);
  - m2's E before the seeded g5: on m2's recover-unsure misses (S300-1/2) m2 was right 8 times, d8r (seeded g5) 6, x1 6; recover-sure misses m2 4, d8r 2, x1 2 (`q-overlap.js`).
- The seed is the first YES in x1's own log. d8 found it by matching the probe prompt; the two agree on 696/696 stored d8/d8r handovers (`q-peek.js`), so q1's seeded g5 is d8's.
- No j2 (null on confirmation), no m3 extra explore probes.
- **q2** wraps the same stack in `renderingCtx` (outermost after det), so A, m2's answer over [E, W0 top 4], g5's final answer and the explore final answer all carry thread labels. Because A changes, A's confidence changes, so q2 moves questions between sure commit and handover (c.md: 56 hits per 600). q2 therefore re-rolls most hit answers and is the noisy option.

### Implementation

x1 (`x-agent.js`) runs unchanged on a ctx that carries d6's list (`lexicalPoolCtx`); its g5 handover is deferred for the length of the call (stub, no model call; the `y-stack.js` / `j-reread.js` trick). After x1 returns, the wrapper runs m2's recovery on the plain ctx (not the d6 ctx: there the recovery's CE load would trigger d6's widening) and calls the real g5 on the d6 ctx with the seeding hook armed, only when the rule says so. Call order on every path equals the parent's: probes → A → (m2 probes) → (E answer | g5). The det forms are `det(q1)` and `det(q2)` in mode "all", the same mode and reset prompt as `i-det-x1` v2, so `i-det-x1` v2 is the baseline as is (its S300-1 answers are reused).

Variant ids: `q1`, `q2` (plain), **`q-det-q1`**, **`q-det-q2`** (det forms, the ones run), baseline **`i-det-x1`** (v2).

### Stub check (`tools/q-check.js`, no GPU)

A fake ctx scripts the model (W0 probe YES/NO and token lp, A's mean lp, recovery probes, picks, the plan, and g5's two tool turns: `search_mailbox("quarterly budget meeting schedule")`, then `answer`), runs the real code (BM25, CE, g5's agent loop), and records every call with a hash of its exact prompt. 8 scenarios × 3 S300-2 questions:

| scenario | q1 vs parents (exact prompts) |
|---|---|
| S1 sure commit | IDENTICAL to x1, d8, m2 |
| S2 unsure commit, yes1 sure | IDENTICAL to d8; vs x1 / m2: same calls up to g5's tool result, which differs (the seed) |
| S3 doubted, A sure, no E | IDENTICAL to m2; minus its recovery probes IDENTICAL to d8 |
| S4 doubted, A sure, E | IDENTICAL to m2 (`recover-sure`, [E, W0 top 4]) |
| S5 doubted, A unsure, E | IDENTICAL to m2 (`recover-unsure`, no g5) |
| S6 doubted, A unsure, no E | = m2's calls, then d8's seeded g5 (minus the recovery probes IDENTICAL to d8) |
| S7 recovery YES below yes1 (not accepted), A unsure | as S6 |
| S8 explore | IDENTICAL to d8 (d6's list) |

- q2 vs q1: the same calls in every scenario; every non-answer prompt is byte-identical; every answer prompt was rebuilt with labels.
- det forms: the same real calls as the plain forms, each preceded by exactly one reset.
- **0 failures** (`.data/premise2/explore/q-check.log`).

## 2. GPU plan (queued 07:21 ET behind worker l's four runs)

1. `run S300-1 q-det-q1,q-det-q2` (development; vs `i-det-x1` v2's stored S300-1 answers).
2. `run S300-4 i-det-x1,q-det-q1`, `run S300-5 i-det-x1,q-det-q1` (screening; the det baseline runs in the same command as q1, so walls share a window).
3. `run S300-4 q-det-q2`, `run S300-5 q-det-q2` (my second screening variant; cancelled before it starts if the S300-1 run shows a problem).

Expectation before the GPU: d8 +0.5 to +0.6 (its screening and dev replays), m2 ≈ +0.2 (+16 net misses over 1,700 questions), additive, so q1 ≈ +0.7 to +0.8 vs x1; q2 adds labels' +0.5 ± 1.

## 3. Development: S300-1 (q-det-q1 ran 07:56–08:07 ET; baseline = `i-det-x1` v2's stored S300-1 run, Wed 00:17 ET)

`tools/q-table.js S300-1 q-det-q1` (J1; CI = explore/analyze.js mailbox-cluster paired bootstrap, as `cli2.js report`):

| | n | weighted | miss | hit | Δ vs i-det-x1 [95% CI] | Δ vs stored x1 | Δ vs gates | wall ms | calls (real) |
|---|---|---|---|---|---|---|---|---|---|
| q-det-q1 | 300 | 87.7 | 56.0 | 90.0 | **+0.41 [0.0, 0.8]** | +0.0 [−1.8, 1.5] | +3.8 [1.1, 6.8] | 2,440 | 13.4 (6.7) |
| i-det-x1 | 300 | 87.3 | 50.0 | 90.0 | – | −0.4 | +3.4 | 1,947 (another window) | 10.8 (5.4) |

**Untouched paths are byte-identical to det x1, across a PC restart and 8 hours** (`same text` = n on every row where no component acts):

| stratum | det x1 path → q1 route | n | + / − | same text |
|---|---|---|---|---|
| hit | sure commit | 79 | 0/0 | 79 |
| hit | sure commit, m2 probed, no E | 31 | 0/0 | 31 |
| hit | explore, list same | 13 | 0/0 | 13 |
| hit | handover, seed did not change g5's results (incl. 12 after m2 probes) | 55 | 0/0 | 55 |
| hit | explore, list changed | 10 | 0/0 | 7 |
| hit | handover, seed changed g5's results (incl. 5 after m2 probes) | 10 | 0/0 | 2 |
| hit | m2 recovery (sure / unsure) | 1 / 1 | 0/0 | 0 |
| miss | sure commit | 15 | 0/0 | 15 |
| miss | sure commit, m2 probed, no E | 8 | 0/0 | 8 |
| miss | explore, list same | 14 | 0/0 | 14 |
| miss | handover, seed did not change g5's results | 16 | 0/0 | 16 |
| miss | explore, list changed | 22 | **+2/0** | 16 |
| miss | handover, seed changed g5's results (incl. 4 after m2 probes) | 8 | 0/−1 | 1 |
| miss | m2 recovery, A sure | 7 | **+2/0** | 1 |
| miss | m2 recovery, A unsure (replaces the handover) | 10 | **+3/0** | 0 |

- Every flip sits on a mechanism path: misses +7/−1 (m2 +5/0, d6 list +2/0, seeding 0/−1), hits 0/0. Δ = +0.41, CI [0.0, 0.8]: on S300-1 the stack's effect is all misses.
- S300-1 is the set m2's rule was chosen on (m.md), so its m2 part is in-sample here.
- det diagnostics (`i-detstats.js`): 92% of real calls resumed at 0, 8% at ≥ 100 (g5's own conversation), none at 1–99; every reset resumed at 26 (its own state). q1's added calls (6 recovery probes, the E answer) keep det's guarantee.
- Cost: +1.33 real calls per question (m2's probes on ~28% of questions, the E answer); wall +493 ms vs i-det-x1's night run (different window; the screening runs pair them in one command).

### q-det-q2 on S300-1 (08:07–08:19 ET)

| | weighted | miss | hit | Δ vs i-det-x1 [95% CI] | Δ vs q-det-q1 | wall ms | calls (real) |
|---|---|---|---|---|---|---|---|
| q-det-q2 | 87.8 | 58.0 | 90.0 | +0.54 [−1.3, 2.3] | +0.14 [−1.8, 2.0] | 2,398 | 13.3 (6.65) |

- As expected, the labels re-roll the answer prompts everywhere: hit texts identical to det x1 only on 51/70 sure commits, 13/29 unchanged handovers, 4/13 unchanged explores; 27 hits move between sure commit and handover (A's confidence changes with the labels).
- Flips vs det x1: hits +2/−2 (all on re-rolled paths), misses +10/−2 (m2 recovery +8/−1, d6 list +1/0, seeded g5 +1/−1). The miss mechanisms carry over; the labels add nothing measurable here, and the CI widens from [0.0, 0.8] to [−1.3, 2.3] because of the re-rolls.
- Decision: keep the queued q2 screening runs (my second decision-set variant, as the task asks), but q1 is the stack whose gain can be read cleanly.

## 4. Screening: S300-4 (`run S300-4 i-det-x1,q-det-q1`, 08:19–08:41 ET; one command, same window)

| | n | weighted | miss | hit | Δ vs i-det-x1 [95% CI] | Δ vs stored x1 | Δ vs gates | wall ms (p95) | calls (real) |
|---|---|---|---|---|---|---|---|---|---|
| i-det-x1 | 300 | 86.9 | 52.0 | 89.5 | – | +0.1 [−1.7, 1.9] | −1.0 [−2.6, 1.5] | 1,997 (3,711) | 11.4 (5.69) |
| **q-det-q1** | 300 | 89.4 | 60.0 | 91.5 | **+2.41 [0.4, 4.5]** | +2.5 [0.5, 4.6] | +1.4 [−1.0, 4.8] | 2,444 (4,507) | 13.2 (6.61) |

Flips vs det x1 by path (all untouched paths byte-identical: sure commits 79 + 10, m2-probed sure commits 19 + 6, explores with the same list 17 + 13, handovers where the seed did not change g5's results 58 + 9):

| stratum | det x1 path → q1 route | n | + / − |
|---|---|---|---|
| hit | m2 recovery, A sure | 5 | +1/0 |
| hit | m2 recovery, A unsure (replaces the handover) | 5 | +2/0 |
| hit | handover, seed changed g5's results (incl. 1 after m2 probes) | 7 | +2/0 |
| hit | explore, list changed | 10 | 0/−1 |
| miss | m2 recovery, A sure | 5 | +2/−1 |
| miss | m2 recovery, A unsure | 17 | +5/0 |
| miss | explore, list changed | 31 | +2/0 |
| miss | handover, seed changed g5's results | 9 | 0/0 |

Hits +5/−1, misses +9/−1. Wall +447 ms over det x1 in the same window (sure commits +457 ms from m2's probes and CE list on the doubted ones; m2 recovery with A sure +2.2 s; explore +106–152 ms). det: no real call resumed at 1–99.

## 5. Screening: S300-5 (`run S300-5 i-det-x1,q-det-q1`, 08:42–09:04 ET) and pooled

| set | id | weighted | miss | hit | Δ vs i-det-x1 [95% CI] | Δ vs stored x1 | Δ vs gates | wall ms (det x1) | calls, real (det x1) |
|---|---|---|---|---|---|---|---|---|---|
| S300-5 | i-det-x1 | 82.2 | 30.0 | 86.0 | – | −0.6 [−3.1, 1.4] | −1.0 [−3.9, 0.9] | 2,053 | 5.95 |
| S300-5 | q-det-q1 | 82.2 | 30.0 | 86.0 | **+0.00 [−1.8, 1.9]** | −0.6 [−3.3, 1.7] | −1.0 [−4.2, 1.2] | 2,545 (2,053) | 7.11 (5.95) |
| S300-4 | q-det-q1 | 89.4 | 60.0 | 91.5 | **+2.41 [0.4, 4.5]** | +2.5 [0.5, 4.6] | +1.4 [−1.0, 4.8] | 2,444 (1,997) | 6.61 (5.69) |
| **S300-4 + S300-5** | q-det-q1 | 85.8 | 45.0 | 88.8 | **+1.20 [−0.1, 3.0]** | +0.9 [−0.8, 3.3] | +0.2 [−1.9, 3.7] | 2,494 (2,025) | 6.86 (5.82) |
| S300-1 + S300-4 + S300-5 (900 det-paired) | q-det-q1 | 86.4 | 48.7 | 89.2 | **+0.94 [−0.0, 2.0]** | +0.6 [−0.6, 2.1] | +1.4 [−0.6, 3.7] | 2,476 (1,999) | 6.81 (5.67) |

(i-det-x1 on S300-4 = 86.9, the same as the lead's unwrapped x1; on S300-5 82.2 vs 82.8: a re-roll, as i.md predicts.)

Uncertainty of the det-paired Δ (`tools/q-stats.js`; behind det every concordant pair is byte-identical, so all the information is in the discordant pairs):

| sets | discordant misses | discordant hits | Δ | mailbox-cluster bootstrap | stratified question bootstrap | sign-flip randomisation p (two-sided) |
|---|---|---|---|---|---|---|
| S300-4 | +9/−1 | +5/−1 | +2.41 | [0.42, 4.50] | [0.28, 4.74] | 0.032 |
| S300-5 | +4/−4 | +2/−2 | +0.00 | [−1.81, 1.94] | [−1.93, 1.86] | 1.0 |
| **S300-4 + S300-5** | **+13/−5** | **+7/−3** | **+1.20** | **[−0.07, 2.96]** | **[−0.23, 2.70]** | **0.11** |
| S300-1 (dev) | +7/−1 | 0/0 | +0.41 | [0.00, 0.82] | [0.07, 0.82] | 0.071 |
| all three (900) | +20/−6 | +7/−3 | +0.94 | [−0.02, 1.99] | [−0.02, 1.96] | 0.060 |

Flips vs det x1 by path, S300-4 + S300-5 (every untouched path byte-identical: sure commits 158 + 20, m2-probed sure commits 47 + 9, explores with the same list 28 + 25, handovers where the seed did not change g5's results 110 + 14):

| mechanism | hits | misses |
|---|---|---|
| m2 recovery, A sure (replaces A) | 5: +1/0 | 13: +3/−1 |
| m2 recovery, A unsure (replaces the g5 handover) | 7: +3/0 | 29: +7/−2 |
| d8 seed changed g5's results (incl. after m2 probes) | 21: +3/−2 | 20: 0/−2 |
| d6 explore list changed | 24: 0/−1 | 70: +3/0 |
| **total** | **+7/−3** | **+13/−5** |

What moved (`tools/q-recov.js`, all three det-paired sets, 900 questions; "AB" = gold, twin or EvidenceCache answer-bearing):

| stratum, mechanism | n (answer changed) | + / − | yes1 AB | E AB | AB in final context, q1 / det x1 |
|---|---|---|---|---|---|
| miss, m2 recovery (A sure) | 20 | +5/−1 | 3 | 9 | 12 / 5 |
| miss, m2 recovery (A unsure) | 39 | +10/−2 | 1 | 21 | 22 / 9 |
| miss, d6 list (text changed) | 24 | +5/0 | – | – | 16 / 10 |
| miss, seed changed g5's results | 28 | 0/−3 | 9 | – | 11 / 11 |
| hit, m2 recovery (A sure / unsure) | 6 / 8 | +1/0, +3/0 | 8 | 4 | 14 / 14 |
| hit, seed changed g5's results | 31 | +3/−2 | 27 | – | 28 / 25 |
| hit, d6 list (text changed) | 9 | 0/−1 | – | – | 9 / 9 |

- **m2 on misses is a retrieval mechanism:** E is answer-bearing on 30 of 59 recovery misses and an AB email reaches the final context on 34 vs det x1's 14. Typical wins: the "Re: can you send info" phone number, Swerzbin's delivery point, Howard Creek Ranch's amenities, where x1 had committed to a false-YES email. m2's +15/−3 on misses is the stack's most robust part (S300-1 +5/0, S300-4 +7/−1, S300-5 +3/−2).
- **m2 on hits is a re-read, not retrieval:** on all 14 recovery hits an AB email was already in det x1's context. [E, W0 top 4] puts another email first and, on unsure commits, replaces the g5 handover with a plain 5-email read. +4/0, all on the decision sets; S300-1 had 0/0.
- **d8's seed on hits:** yes1 is answer-bearing in 27/31 seed-changed hits, and g5 then has an AB email in its final context more often (28 vs 25): +3/−2. On misses the seed is a false YES more often (9/28 AB) and goes 0/−3.

### Side finding: the LCG in several bootstrap tools has a period of about 10,000

`y-lib.js`, `t-ladder.js`, `c-pooled.js`, `l-lib.js` and `l-stub.js` draw bootstrap indices from `seed = (seed * 1103515245 + 12345) & 0x7fffffff` in double arithmetic. The product exceeds 2^53, so the low bits are lost: from seed 12345 the state repeats after 10,466 steps, and 400 equal buckets get 574–1,862 hits instead of ~1,000. The `% 2147483648` variants (`e-lib.js`, `p-logit.js`, `x-tau.js`, `h-clean.js`) have the same period; `>>> 0` (`c-gold-eval.js`) has 6,063. A bootstrap of 4,000 draws × 600 questions consumes 2.4 M numbers, i.e. it cycles ~230 times. With `Math.imul` (or `analyze.js`'s splitmix32) the problem disappears.
Effect on the intervals (`q-stats.js` uses mulberry32):
- q1 vs det x1 on S300-4 + S300-5: the y-lib bootstrap gave [0.47, 2.83] (it would have "excluded 0"); a correct RNG gives [−0.23, 2.70].
- y1 vs x1 on S300-2 + S300-1 (y.md: +1.07 [−0.3, 2.4]): correct [−0.36, 2.56].
- y1 vs x1 on S300-3 + FULL-1 (journal: −0.5 [−1.6, 1.6]): correct −0.47 [−1.91, 0.93].
Point estimates are unaffected; only the intervals from those tools. The `cli2.js report` / `analyze.js` mailbox-cluster bootstrap (splitmix32) is fine, and every CI in this file is from it or from `q-stats.js`.

## 6. Screening: q-det-q2 (`run S300-4 q-det-q2` 09:05–09:17, `run S300-5 q-det-q2` 09:17–09:29 ET)

| set | weighted | miss | hit | Δ vs i-det-x1 [95% CI] | Δ vs q-det-q1 | Δ vs stored x1 | Δ vs gates | wall ms (det x1) | calls, real (det x1) |
|---|---|---|---|---|---|---|---|---|---|
| S300-4 | 88.9 | 60.0 | 91.0 | +1.94 [−0.6, 4.2] | −0.47 [−2.6, 1.5] | +2.0 [0.0, 3.9] | +1.0 [−1.1, 3.6] | 2,436 (1,997) | 6.60 (5.69) |
| S300-5 | 85.3 | 34.0 | 89.0 | +3.07 [0.7, 6.5] | +3.07 [0.7, 6.3] | +2.5 [0.6, 4.6] | +2.1 [−0.9, 4.7] | 2,524 (2,053) | 7.07 (5.95) |
| **S300-4 + S300-5** | 87.1 | 47.0 | 90.0 | **+2.51 [0.2, 4.6]** | +1.30 [−1.1, 3.4] | +2.2 [0.8, 3.6] | +1.5 [−0.2, 4.2] | 2,480 (2,025) | 6.83 (5.82) |
| S300-1 + 4 + 5 (900) | 87.3 | 50.7 | 90.0 | **+1.85 [0.4, 3.3]** | +0.91 [−0.6, 2.3] | +1.5 [0.5, 2.5] | +2.3 [0.7, 4.0] | 2,453 (1,999) | 6.77 (5.67) |

`q-stats.js`: q2 vs det x1 on the decision sets: discordant misses +20/−8, hits +16/−7; stratified bootstrap [0.28, 4.77]; sign-flip p = 0.026. Over 900: misses +30/−10, hits +18/−9, p = 0.022. The labels part alone (q2 vs q1): decision sets misses +8/−4, hits +12/−7, p = 0.21; 900: +0.91, p = 0.23.

- **The labels re-roll every answer prompt**, so q2 vs det x1 is no longer "only mechanism paths differ": on the decision sets, 345 hits whose logic equals x1's go +8/−4, and the mechanism paths go hits +8/−3, misses +17/−4.
- **The labels' share is set-dependent, exactly as in c.md:** q2 − q1 is −0.47 on S300-4, +3.07 on S300-5, +0.14 on S300-1. c's unwrapped x1 + labels on the same decision sets was −0.1 and +1.7; over c's 1,800 dev and screening questions labels were +0.47 [−0.9, 1.6], and FULL-1 was −0.7. So S300-5's +3.1 is mostly a property of those 300 questions, not fresh evidence, and the decision sets had already been used once to evaluate labels (c-fin3).
- det still holds with labels: 92% of real calls resumed at 0, none at 1–99.

## 7. Conclusions

- **q1 (x1 + d8 + m2) works as designed and its gain is mechanism-only.** Behind det, every question where no component acts is byte-identical to det x1 (411 such questions on the decision sets, 411/411 same text). The flips are all on mechanism paths and one-sided: misses +13/−5 and hits +7/−3 on S300-4 + S300-5; misses +20/−6 and hits +7/−3 over 900 det-paired questions.
- **Is q1's gain real?** Δ vs det x1 = **+1.20 [−0.1, 3.0]** on S300-4 + S300-5 (S300-4 +2.41 [0.4, 4.5], S300-5 +0.00), and **+0.94 [−0.0, 2.0], p = 0.06** over all 900 det-paired questions. The CI touches 0 by a hair, so **not established at 95%**. The miss side is established: m2's recovery gives +15/−3 misses over 900 questions, the most consistent piece. Expected true gain ≈ +0.9 to +1.0 weighted, inside the +0.7 to +1.0 forecast; below the +1.5 bar in expectation, though it cleared +1.5 on S300-4 alone.
- **q2 (q1 + thread labels) passes the screening bar:** **+2.51 [0.2, 4.6] vs det x1** on S300-4 + S300-5 (sign-flip p = 0.026), and +1.85 [0.4, 3.3] over 900. That clears +1.5 with a CI excluding 0. But about half of it (+1.30 [−1.1, 3.4]) is the labels, whose effect elsewhere is +0.5 ± 1 and negative on FULL-1. The rest (+1.2) is q1's mechanism. Expected on fresh questions ≈ q1 + 0.5 ≈ +1.4, with the labels adding variance.
- **Cost:** q1 2,494 ms and 6.86 real calls/question (det x1 2,025 ms, 5.82 calls, same windows); q2 2,480 ms, 6.83 calls. det itself adds ~210 ms/question (≈ 6.9 resets), so unwrapped q1/q2 would run ≈ 2,300 ms. Both well inside the 3,243 ms cap. p95 ≈ 4.5–4.6 s.
- **For FULL-2:** run `i-det-x1`, `q-det-q1` and `q-det-q2` together if time allows. Behind det, q1 − det x1 isolates the retrieval mechanisms and q2 − q1 isolates the labels, with no history noise. If only one stack: q-det-q2 is the screening winner (passes +1.5), q-det-q1 the lower-variance one.
- **Side finding:** the LCG bootstrap in y-lib.js / t-ladder.js and five other tools has a period of ~10,000; their CIs are unreliable (§5, side finding). Use analyze.js's bootstrap or q-stats.js.

## Files

- `benchmarks/premise2/explore2/variants/q-stack.js`: `stackQ`; variants `q1`, `q2` (plain), `q-det-q1`, `q-det-q2` (det, mode all). Imports x-agent (x1), g-agent (g5), d-agent (`lexicalPoolCtx`), m-agent (`x1Contexts`, `recoveryLists`, `lpProbe`), c-agent (`renderingCtx`), i-det (`det`).
- `benchmarks/premise2/explore2/tools/q-check.js`: stub call-sequence check vs x1 / d8 / m2, q2 vs q1, det forms vs plain (log: `.data/premise2/explore/q-check.log`).
- `benchmarks/premise2/explore2/tools/q-peek.js`: d8's seed vs x1's first YES; d8r seeding flips by yes1 doubt (dev).
- `benchmarks/premise2/explore2/tools/q-overlap.js`: m2 vs d8r on m2's recovery questions (dev).
- `benchmarks/premise2/explore2/tools/q-table.js`: per-set and pooled tables vs a reference, flips by path, same-text identity, wall and calls with/without resets.
- `benchmarks/premise2/explore2/tools/q-stats.js`: discordant counts, cluster and stratified bootstrap (32-bit RNG), sign-flip randomisation test.
- `benchmarks/premise2/explore2/tools/q-recov.js`: per-mechanism answer-bearing analysis of changed answers.
- Run logs: `.data/premise2/explore/q-run-*.log`. J1 spend ≈ $0.006.
