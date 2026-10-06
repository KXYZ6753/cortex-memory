# Worker y: stacking j2 and m2 on x1 and t-lx (round 4)

Prefix `y`. Code: `benchmarks/premise2/explore2/variants/y-stack.js`. Offline tools: `explore2/tools/y-check.js` (stub call-sequence check, no GPU), `y-sim.js` (simulation from the stored parents), `y-peek.js` (parents' flips with the first YES's logprob), `y-table.js` (results, pooled bootstrap, flips by route, reproduction), `y-lib.js` (helpers).

Mission: stack the two round-3 add-ons that act on different paths of x1 and see whether they add up.
- **m2** (+0.1 vs x1 pooled): on a doubted first YES (token logprob < −0.1), YES/NO-probe down snip50m top 6 and answer an accepted email E first, [E, W0 top 4].
- **j2** (+0.55): at x1's handover point (committed answer unsure), re-read the YES email alone and keep that answer only if it is itself confident, else g5.

Variants: **y1** = x1 + m2 + j2; **y2** = the same two add-ons on t-lx (x1 with lean explore).

## 1. Design

### Where the two add-ons meet

On a commit, x1 has a first YES email yes1 (token logprob yesLp1) and gates' answer A over W0 with its mean token logprob. m2 fires on yesLp1 < −0.1; j2 fires when A is unsure. The two triggers overlap: pooled over S300-2 + S300-1, m2's trigger fires on 161 commits and x1 hands over 203, and 86 questions meet both triggers. On 22 of those, m2 accepts an email E; on 64, it accepts none.

Decision tree (y1; y2 is identical on commits):

| first YES | A (gates' answer over W0) | m2 recovery | y1 does | equals |
|---|---|---|---|---|
| yesLp1 ≥ −0.1 | sure | – | A | x1 |
| yesLp1 ≥ −0.1 | unsure | – | single read of yes1; keep if confident, else g5 | j2 |
| yesLp1 < −0.1 | sure | no E | A (after the recovery probes) | m2 = x1 |
| yesLp1 < −0.1 | sure | E | answer over [E, W0 top 4] | m2 |
| yesLp1 < −0.1 | unsure | no E | single read of yes1 after the probes; keep if confident, else g5 | new: j2 after m2's probes |
| yesLp1 < −0.1 | unsure | E | m2's answer R over [E, W0 top 4], then a single read of **E**; keep that read if confident, else R | new |
| no YES | – | – | explore (x1's in y1; t-lx's lean explore in y2) | x1 / t-lx |

### Which email j2 re-reads when m2 accepted E: E

Three reasons:
1. **E is the better-supported YES.** m2 accepts E only if its YES token logprob is ≥ yes1's, and yes1 is by construction a doubted YES (< −0.1). m.md's probe statistics show that a high-logprob recovery YES is the answer-bearing one (median −0.05 on AB vs −0.22 on non-AB), and x.md shows that a low-logprob first YES flags the false-YES stops (AUC 0.73).
2. **m2 placed E first,** so E is the email y1's context already treats as the answer source.
3. **j2's mechanism is "read the email the agent itself judged answer-bearing, alone".** On this path that is E. Re-reading yes1 would undo m2's decision and spend j2's single read on the email that is most likely a false YES. That is exactly j2's failure mode: its pooled misses were 0/−4, all of them confidently wrong reads of a false-YES email.

**Fallback when the single read of E is not confident: m2's answer R, not g5.**
- On these questions m2 replaced x1's g5 handover, and the replacement won. m1's unsure branch on S300-1 went +4/−0 on misses, and m2's recover-unsure went +3/−1 on misses pooled (`y-table.js` on m2).
- g5 starts from scratch and never sees E.

**Order: R first, then the single read.**
- This keeps m2's call sequence intact on that path, so R reproduces m2's stored answer.
- The single read of E then shares its prompt prefix with R (sandwich header, question, E). That mirrors j2, whose single read shares the prefix with A when yes1 is W0's first email.
- The cost is one extra call on about 2% of questions.

**What "unsure" means on the recovery path.** It is x1's own flag on A (the handover decision). R comes from `ctx.generate`, exactly as in m2, so R has no logprobs. A sure A with an accepted E stays pure m2.

### Implementation (no copy of x1, t-lx or m2)

`y-stack.js` `stack(base)` calls the base variant unchanged (`X.x1` or `T["t-lx"]`). During that call the g5 handover is intercepted: it is stubbed and returns a marker without making a model call. This is the trick from `j-reread.js`.

After the base call returns, the wrapper:
- recomputes W0 and W1 with m-agent's exported `x1Contexts` (deterministic BM25, no model call);
- runs m2's recovery with m-agent's exported `recoveryLists` and `lpProbe`, using the same arguments as m2: mailbox-only, rrf off, top 6, accept on YES with lp ≥ yesLp1, missing lp → −9;
- runs j2's single read and keeps it if confident, using the same rule as j-reread (`lpCall` sandwich, ok, no abstention or hedge, mean ≥ −0.1);
- calls the real g5 only when the rule sends the question there.

The m2 recovery happens after A in both m2 and y1, because x1 computes A before returning. So the m2 path issues the same calls in the same order as m2. j2's re-ask of truncated single-context answers (num_predict 400) is kept, and also applies to the recovery steps.

No new decision prompt is introduced. The only decision prompts are x1's own YES/NO probes (relevancePrompt), whose prefix differs from the answer prompt's.

Cost estimate: x1 1,910 ms pooled; m2 +330 ms; j2 −170 ms. So y1 ≈ 2,100 ms and y2 ≈ 1,850 ms, both within the 3,243 ms cap.

### Stub check before the GPU (`tools/y-check.js`, 2 questions × 10 scripted scenarios × y1/y2)

A fake ctx scripts the probe YES/NO and logprobs, plus the mean logprobs of A and of the single read, and records the call sequence. The y sequence is then compared with its parents' sequences on the same script. All ten scenarios behave as designed on both questions:
- **Neither add-on fires** (S1 sure commit; S10 no YES → explore): y1 is IDENTICAL to x1, j2 and m2. y2 is IDENTICAL to t-lx; its explore is `P×5 gen P G5` vs x1's `P×5 gen P gen gen P gen P G5`.
- **j2 only** (yesLp1 ≥ −0.1, A unsure; S2, S3): IDENTICAL to j2 (`P A5 S1:yes1 [g5]`).
- **m2 only** (A sure; S4 no E, S5 E, S9 a recovery YES below yesLp1 is not accepted): IDENTICAL to m2 (`P A5 R1…R6`, or `P A5 R1 R2:yes G5[E, W0 top 4]`).
- **Both fire:**
  - S6/S7 (E accepted): m2's sequence followed by `S1:E`. S6 keeps the single read (step `recover-single`); S7 keeps m2's answer (`recover-unsure`).
  - S8 (no E): m2's probes, then `S1:yes1`.

## 2. Offline simulation from the stored parents (`tools/y-sim.js`)

The simulation routes each question to a stored parent answer:
- if m2 recovered → m2's verdict (recover-unsure: m2's verdict; the re-read of E is not observable);
- else if j2 handled the handover → j2's verdict;
- else → x1's verdict;
- y2 additionally takes t-lx's verdict on explore questions.

It overstates the gain. In particular, the 64 "both fire, no E" questions in y1 do their single read after m2's probes, not right after A. They re-roll, and j2's two S300-2 hit wins sit exactly there (yesLp1 −0.20 and −0.32; `y-peek.js`).

| | S300-2 | S300-1 | pooled Δ vs x1 [95% CI] |
|---|---|---|---|
| m2 (stored) | −0.07 | +0.34 | +0.14 [0.0, 0.3] |
| j2 (stored) | +0.80 | +0.33 | +0.56 [−0.2, 1.1] |
| t-lx (stored) | −0.07 | −0.14 | −0.10 [−0.2, 0.0] |
| **y1 (sim)** | +0.80 (hits +2/−0, misses 0/−2) | +0.20 (misses +5/−2) | **+0.50 [−0.0, 1.0]** |
| **y2 (sim)** | +0.73 | +0.07 | **+0.40 [−0.1, 0.9]** |

Why it is less than m2 + j2 (+0.70):
- On S300-1 the only j2 "gain" vs x1 was a sure-commit hit flip that came from cross-run noise. The simulation takes x1's verdict there.
- j2's two S300-1 miss losses (yesLp1 −0.03 and −0.07, so not doubted) stay.

Expected before the GPU: y1 ≈ +0.3 to +0.5 vs x1 pooled, below the +1.0 bar. y2 ≈ y1 − 0.1.

Overlap counts (pooled):
- m2 recovers on 36 questions (22 of them with A unsure);
- j2 handles 181 handovers (65 single reads kept);
- 64 handovers go through j2 after m2's probes without an E.

A post-hoc "skip j2 when yes1 is doubted" rule would remove j2's 2 S300-2 hit wins together with its 2 S300-2 miss losses. That is a wash, so it was not run.

## 3. GPU runs

Queued 16:46 ET behind the lead's FULL-1 t-lk run and worker h's runs: smoke `run S100-3 y1,y2 20`, then `run S300-2 y1,y2` (ran 17:36–17:58), then `run S300-1 y1,y2` (17:58–18:21). Replicate `run S100-4 x1,y1` and `run S100-5 x1,y1` were queued at 18:31. J1 grading cost about $0.004 in total.

### Smoke (S100-3, 20 questions, 16:55 ET; `tools/y-steps.js`)

The runs completed without errors.

| | wall ms | calls | commit | commit-single | commit-g5 | recover-sure | found / nofound | m2 probed | E accepted | j2 fired |
|---|---|---|---|---|---|---|---|---|---|---|
| y1 | 2,305 | 7.95 | 8 | 2 | 1 | 1 | 3 / 5 | 5 | 1 | 3 |
| y2 | 2,076 | 6.70 | 8 | 2 | 1 | 1 | 3 / 5 | 5 | 1 | 3 |

- The 12 commit-path answers are byte-identical between y1 and y2, as expected: the commit calls are the same.
- This sample is explore-heavy (8/20 questions, vs about 21% on the S300 sets), so its wall time overstates the S300 cost.

### Reproduction: the call sequence matched, but the cache state drifted after question 13 (`tools/y-repro.js`)

Within each question, y1 issues exactly its parent's calls (the stub check above). Even so, y1's S300-2 run reproduced x1 call for call only on the first 13 questions:
- On those 13, the probe logprobs are identical to x1's to three decimals, and every non-firing answer is byte-identical. So the PC restart did not change the numerics.
- From question 14 on, **every** question's W0 probe logprobs differ slightly from x1's, including questions where neither add-on fires (for example a first-probe YES at −0.104 vs −0.091, or −2.649 vs −2.918).
- The calls inside each question are the same, so this is Ollama's cross-question cache state. The prompt-prefix reuse depends on the history of earlier prompts, not only on the previous call. y1's different calls on question 13 put the cache on another trajectory, and it never re-converged.

j2 and m2 alone did not trigger this on S300-2: each was byte-identical to x1 outside its own path. The stack did trigger it.

Consequence: on S300-2, y1's non-firing paths are **re-rolls** of x1, not copies.

| route | same text as x1 |
|---|---|
| sure commit (no add-on) | 78/94 |
| explore | 33/66 |
| unsure → g5 (j2 only) | 21/32 |

Some routes also changed: 3 explore questions took a different step, and some first-YES logprobs crossed −0.1, which moves those questions between the m2 and j2 routes. So the Δ vs x1 below contains re-roll noise on every path. The by-route flips separate the two parts:
- **Logic changed:** re-read and recovery routes.
- **Logic identical to x1 or j2, but re-rolled:** sure commit, explore, unsure → g5.

### S300-2 (J1; `cli2.js report S300-2 x1 x1`; Δ vs gates and p95 from `tools/y-table.js`)

| id | weighted | Δ vs x1 [95% CI] | Δ vs gates [CI] | miss | hit | wall ms | p95 wall | calls | p95 calls |
|---|---|---|---|---|---|---|---|---|---|
| **y1** | 87.5 | +1.4 [−1.6, 5.1] | +2.5 [−0.4, 5.2] | 47.0 | 90.5 | 2,308 | 4,642 | 6.83 | 13 |
| **y2** | 87.5 | +1.3 [−1.7, 5.1] | +2.4 [−0.5, 5.0] | 46.0 | 90.5 | 2,172 | 4,507 | 6.06 | 13 |
| j2 | 86.9 | +0.8 [−0.2, 2.4] | +1.9 | 45.0 | 90.0 | 1,778 | 3,418 | 5.50 | 13 |
| m2 | 86.1 | −0.1 [−0.4, 0.0] | +1.0 | 46.0 | 89.0 | 2,237 | 4,274 | 6.91 | 13 |
| t-lx | 86.1 | −0.1 [−0.2, 0.0] | +1.0 | 46.0 | 89.0 | 1,681 | 2,986 | 4.84 | 8 |
| x1 | 86.1 | – | +1.1 | 47.0 | 89.0 | 1,820 | 3,356 | 5.59 | 13 |

y1's verdict flips vs x1 by route:

| y1 route | n | y1 right | x1 right | hits +/− | misses +/− | same text as x1 / j2 / m2 |
|---|---|---|---|---|---|---|
| sure commit | 94 | 87 | 86 | 0/0 | +1/0 | 78 / 77 / 78 |
| sure commit, m2 probed, no E | 28 | 25 | 25 | 0/0 | 0/0 | 19 / 20 / 19 |
| unsure → re-read (j2 only) | 27 | 23 | 21 | +1/0 | +1/0 | 3 / 17 / 3 |
| unsure → re-read after m2 probes | 11 | 7 | 5 | +3/−1 | +1/−1 | 0 / 5 / 0 |
| unsure → g5 (j2 only) | 32 | 28 | 29 | 0/−1 | 0/0 | 21 / 21 / 21 |
| unsure → g5 after m2 probes | 26 | 16 | 17 | 0/−1 | 0/0 | 15 / 12 / 15 |
| recovery, A sure (m2) | 4 | 2 | 2 | 0/0 | 0/0 | 1 / 1 / 4 |
| recovery, A unsure, m2's answer kept | 8 | 2 | 3 | 0/0 | 0/−1 | 0 / 0 / 2 |
| recovery, A unsure, single read of E kept | 4 | 2 | 2 | 0/0 | 0/0 | 0 / 0 / 0 |
| explore | 66 | 36 | 35 | +2/0 | 0/−1 | 33 / 33 / 33 |
| **total** | 300 | | | **+6/−3** | **+3/−3** | |

Reading:
- **Re-read routes (logic changed: j2's mechanism):** hits +4/−1, misses +2/−1. That is about +1.4 weighted, j2's S300-2 effect again (j2 alone: hits +2/0, misses 0/−2).
- **m2 recovery routes (16 questions):** hits 0/0, misses 0/−1. m2 found nothing on S300-2 again, which m.md predicted: the golds of S300-2's false stops sit deep.
- **Re-rolled paths with x1's or j2's logic** (sure commit, unsure → g5, explore): hits +2/−2, misses +1/−1. Net 0, which is the noise floor of the drift described above.
- **y2 = y1 on the commit paths:** 233/234 texts identical, so y2 followed the same cache trajectory. The lean explore differs on 4/66 explore texts, and on misses it is 0/−2 vs x1 (y1: 0/−1).

### S300-1 (J1; `cli2.js report S300-1 x1 x1`; Δ vs gates and p95 from `tools/y-table.js`)

| id | weighted | Δ vs x1 [95% CI] | Δ vs gates [CI] | miss | hit | wall ms | p95 wall | calls | p95 calls |
|---|---|---|---|---|---|---|---|---|---|
| **y1** | 88.4 | +0.7 [−0.1, 1.9] | +4.6 [0.6, 7.5] | 53.0 | 91.0 | 2,252 | 4,264 | 6.58 | 13 |
| **y2** | 88.3 | +0.6 [−0.2, 1.8] | +4.4 [0.4, 7.3] | 51.0 | 91.0 | 2,133 | 4,276 | 5.87 | 13 |
| m2 | 88.0 | +0.3 [0.1, 0.7] | +4.2 | 54.0 | 90.5 | 2,194 | 4,081 | 6.70 | 13 |
| j2 | 88.0 | +0.3 [−0.3, 1.4] | +4.2 | 47.0 | 91.0 | 1,703 | 3,333 | 5.22 | 13 |
| t-lx | 87.5 | −0.1 [−0.3, 0.0] | +3.7 | 47.0 | 90.5 | 1,643 | 2,882 | 4.69 | 8 |
| x1 | 87.7 | – | +3.8 | 49.0 | 90.5 | 1,999 | 3,919 | 5.41 | 13 |

**On S300-1 the stack reproduced its parents almost exactly** (`y-repro.js`); there was no cache drift here:

| route | same text as parent |
|---|---|
| explore | 60/60 (x1) |
| j2-only handover paths | 59/59 (j2) |
| sure commits with m2 probes | 34/34 (m2) |
| m2 recover-sure | 9/9 |
| m2 recover-unsure | 8/8 |
| sure commits with no add-on | 97/99 (x1) |

y1's verdict flips vs x1 by route:

| y1 route | n | y1 right | x1 right | hits +/− | misses +/− |
|---|---|---|---|---|---|
| sure commit (incl. 34 with m2 probes, no E) | 133 | 119 | 118 | +1/0 | 0/0 |
| unsure → re-read (j2 only / after m2 probes) | 28 / 7 | 23 / 6 | 25 / 6 | 0/0 | 0/−2 |
| unsure → g5 (j2 only / after m2 probes) | 31 / 20 | 26 / 11 | 26 / 11 | 0/0 | 0/0 |
| recovery, A sure (m2) | 9 | 4 | 2 | 0/0 | +2/0 |
| recovery, A unsure, m2's answer kept | 8 | 4 | 3 | 0/0 | +1/0 |
| recovery, A unsure, **single read of E kept** | 4 | 4 | 1 | 0/0 | **+3/0** |
| explore | 60 | 38 | 38 | 0/0 | 0/0 |
| **total** | 300 | | | **+1/0** | **+6/−2** |

Reading:
- **m2's recovery is the S300-1 mechanism:** misses +6/0. m2 alone got +5/0 on the same questions.
- **The re-read of E is the one genuinely new piece.** It kept 4 single reads (E answer-bearing in 4/4), and all 4 were right; m2's own answer on those 4 had 3 right, x1's 1. So it adds +1 miss over m2. On the 8 questions where the read of E was not confident, it fell back to m2's answer, which is identical to m2's text 8/8. Pooled over both sets (`y-recsingle.js`), the confident re-reads of E are right 6/8 and +1/0 vs m2; the 2 wrong ones are non-AB E on S300-2, where m2 was also wrong.
- **j2's two known S300-1 miss losses reproduce exactly** (confident single reads of a non-doubted false YES).
- The +1 sure-commit hit is the same cross-run flip that j2 had on S300-1. It is not a mechanism.
- **y2** is the same except the lean explore loses 2 misses (t-lx's open-2/3 finds).

## 4. Pooled S300-2 + S300-1 (600 questions; `tools/y-table.js`, paired stratified bootstrap as t-ladder.js)

| id | weighted | miss | hit | **Δ vs x1 [95% CI]** | Δ vs gates [CI] | wall ms | p95 wall | calls | p95 calls |
|---|---|---|---|---|---|---|---|---|---|
| **y1** | 88.0 | 50.0 | 90.8 | **+1.07 [−0.3, 2.4]** | +3.5 [1.7, 5.4] | 2,280 | 4,451 | 6.71 | 13 |
| **y2** | 87.9 | 48.5 | 90.8 | **+0.97 [−0.4, 2.3]** | +3.4 [1.7, 5.4] | 2,152 | 4,427 | 5.96 | 13 |
| j2 | 87.5 | 46.0 | 90.5 | +0.56 [−0.2, 1.1] | +3.0 [1.0, 4.9] | 1,741 | 3,401 | 5.36 | 13 |
| m2 | 87.0 | 50.0 | 89.8 | +0.14 [0.0, 0.3] | +2.6 [0.6, 4.7] | 2,216 | 4,185 | 6.80 | 13 |
| t-lx | 86.8 | 46.5 | 89.8 | −0.10 [−0.2, 0.0] | +2.35 [0.4, 4.5] | 1,662 | 2,895 | 4.76 | 8 |
| x1 | 86.9 | 48.0 | 89.8 | – | +2.45 [0.4, 4.5] | 1,910 | 3,634 | 5.50 | 13 |

Both stay well inside the 3,243 ms cap: y1 is +370 ms and +1.2 calls over x1; y2 is +240 ms and +0.5 calls.

**Flips vs x1 by x1's own path → y1's route** (pooled; hits +/−, misses +/−):

| x1 path | → y1 route | n | hits | misses |
|---|---|---|---|---|
| sure commit | sure commit | 246 | +1/0 | +1/0 |
| sure commit | recovery (m2) | 13 | 0/0 | +2/0 |
| sure commit | unsure → re-read / g5 (logprob drift, S300-2) | 8 / 4 | +1/0, 0/0 | 0/0 |
| unsure → g5 | unsure → re-read (j2) | 65 | +3/−1 | +2/−3 |
| unsure → g5 | unsure → g5 | 105 | 0/−2 | 0/0 |
| unsure → g5 | recovery (m2, incl. single read of E) | 24 | 0/0 | +4/−1 |
| unsure → g5 | sure commit (drift) | 9 | 0/0 | 0/0 |
| explore | explore | 126 | +2/0 | 0/−1 |
| **all** | | 600 | **+7/−3** | **+9/−5** |

y2: the same, except explore misses go 0/−4.

**Decomposition of y1's +1.07:**
- **Routes whose logic changed:**
  - re-read (j2): hits +4/−1, misses +2/−3;
  - recovery (m2 + re-read of E): misses +6/−1.
  - Net hits +3 and misses +4, worth **≈ +0.84**.
- **Routes whose logic equals x1's or j2's but were re-rolled** (the S300-2 cache drift and one cross-run flip on S300-1): hits +3/−2, misses +1/−1, worth **≈ +0.23 of luck**.
- **Each add-on worked on one set only:**
  - j2's hit gains are all on S300-2 (S300-1: 0/0 on hits, 0/−2 on misses).
  - m2's miss gains are all on S300-1 (S300-2: 0/−1). The S300-1 rule was selected on S300-1 (m.md).
  - So the stack is additive. The parents' sum is +0.70, and the stack's mechanism part (+0.84) adds about one extra miss from the re-read of E to that sum. There is no synergy beyond that, and no interference.

## 5. Out-of-sample replicate (S100-4, S100-5: x1 and y1 side by side, queued 18:31 ET; `tools/y-s100.js`)

The GPU freed up at 18:31, so I spent the last two allowed runs on 200 fresh questions. No x1 answers existed on these sets, and nothing was selected on them, so x1 and y1 ran in the same command. Each S100 set has 50 misses and 50 hits, so here one hit flip ≈ 0.93 weighted points per 100 questions.

| set | y1 W | x1 W | Δ vs x1 [CI] | y1 miss / hit | x1 miss / hit | y1 wall / calls | x1 wall |
|---|---|---|---|---|---|---|---|
| S100-4 | 84.4 | 84.0 | +0.41 [0.0, 1.0] | 62 / 86 | 56 / 86 | 2,432 / 7.75 | 1,977 |
| S100-5 | 85.1 | 86.9 | −1.73 [−5.6, 0.5] | 46 / 88 | 44 / 90 | 2,239 / 6.69 | 1,898 |
| both (200) | 84.8 | 85.4 | **−0.66 [−2.5, 0.5]** | 54 / 87 | 50 / 88 | 2,336 / 7.22 | 1,938 |

Flips on the replicate:
- **Recovery (m2 + re-read of E):** misses +3/0. The confident re-reads of E were +1/0.
- **Re-read (j2):** hits 0/0, misses +2/−1.
- **Unchanged-logic paths:** the only hit flip is −1 on an unsure → g5 re-roll (S100-5). There was no cache drift: explore 49/49 and sure commits 62/62 identical to x1.

So on fresh questions the miss-side mechanism held (+5/−1), j2's hit mechanism did nothing, and one g5 re-roll decided the sign.

**All 800 paired questions (S300-2, S300-1, S100-4, S100-5): y1 vs x1 = +0.74 [−0.1, 1.8]**, at 2,294 vs 1,917 ms.

| y1 route | n | hits +/− | misses +/− | verdict |
|---|---|---|---|---|
| recovery (m2, re-read of E) | 48 | 0/0 | +9/−1 | mechanism |
| unsure → re-read (j2) | 101 | +4/−1 | +4/−4 | mechanism |
| sure commit, unsure → g5, explore | 651 | +3/−3 | +1/−1 | re-roll noise, net 0 |

## 6. Conclusions

- **y1 (x1 + m2 + j2): pooled Δ vs x1 = +1.07 [−0.3, 2.4]** (S300-2 +1.4 [−1.6, 5.1], S300-1 +0.7 [−0.1, 1.9]). Δ vs gates is +3.5 [1.7, 5.4]. It costs 2,280 ms (p95 4.45 s) and 6.7 calls, within the cap. **The point estimate formally meets the promotion bar (≥ +1.0 within the cost cap); the CI does not exclude 0.**
- **y2 (the same on t-lx): pooled +0.97 [−0.4, 2.3],** just below the bar. It costs 2,152 ms and 5.96 calls. As expected, y2 ≈ y1 minus the open-2/3 finds of the full explore (explore misses 0/−4 vs x1).
- **Out-of-sample (S100-4/5, 200 questions): y1 −0.66 [−2.5, 0.5].** The miss mechanism held (+5/−1) and the hit mechanism was null; one g5 re-roll hit set the sign. **Over all 800 paired questions: +0.74 [−0.1, 1.8].**
- **Honest read of the expected gain: about +0.5 vs x1 (range 0 to +1) on fresh questions.**
  - Mechanism, in-sample: about +0.84. That is j2's re-read of an unsure commit's YES email (+3 hits net, all on S300-2) plus m2's recovery (+5 misses net, all on S300-1), plus +1 miss from re-reading the accepted email E.
  - Luck: about +0.23 from unchanged paths. The S300-2 cache drift netted 0 (hits +2/−2, misses +1/−1). The rest is one cross-run sure-commit hit flip on S300-1, the same flip j2 had.
  - Each add-on is null on the set where it was not the one that showed the effect. m2's rule was chosen on S300-1 and is null on S300-2; j2's re-read is 0/−2 on S300-1. So some of the +0.84 is set-specific.
  - The stack itself works as designed: the add-ons are additive, with no interference.
- **Design choice confirmed:** when m2 accepts E on an unsure commit, re-read E, with m2's answer as the fallback. The confident re-reads of E were right 6/8 and +1/0 vs m2; the fallback reproduced m2's answer 8/8 (S300-1).
- **Engineering lesson: stacking can move Ollama's cache onto a new trajectory.** Each parent alone reproduced x1 byte-for-byte outside its own path. The stack did on S300-1, but on S300-2 it drifted after question 13: probe logprobs changed on every later question and 17–50% of unchanged-path texts were re-rolled (sure commits 16/94, explore 33/66). The calls inside each question were identical, so this is cross-question cache history. Offline simulations from stored parents cannot see it. Here it was neutral: on S300-2's unchanged paths, hits +2/−2 and misses +1/−1.

**Recommendation to the lead:**
- y1's pooled point estimate on the screening sets reaches +1.0. The 800-question estimate (+0.74) and the fresh-question replicate (−0.66) say the true gain is smaller. If confirmation time allows, run y1 on S300-3 / FULL-1, but expect about +0.5 vs x1, not +1, and treat a miss-side gain of about +2–4 miss points as the robust part.
- If a simpler champion is preferred, x1 + j2 alone (j2) carries most of the hit-side mechanism, at lower cost (1,741 ms vs 2,280 ms).

## New files

- `benchmarks/premise2/explore2/variants/y-stack.js`: variants y1 and y2 (wrapper; imports x1, t-lx, m-agent helpers, n-conf, g-agent; no copied code).
- `benchmarks/premise2/explore2/tools/y-check.js`: stub call-sequence check vs parents (no GPU).
- `benchmarks/premise2/explore2/tools/y-sim.js`: offline simulation from the stored parents.
- `benchmarks/premise2/explore2/tools/y-peek.js`: the parents' flips with the first-YES logprob.
- `benchmarks/premise2/explore2/tools/y-table.js`: tables per set and pooled (bootstrap), flips by route and by x1 path, same-text rates.
- `benchmarks/premise2/explore2/tools/y-repro.js`: reproduction vs the parent of each route (no verdicts).
- `benchmarks/premise2/explore2/tools/y-steps.js`: route and cost summary of stored y answers.
- `benchmarks/premise2/explore2/tools/y-recsingle.js`: recovery questions, y vs m2 vs x1.
- `benchmarks/premise2/explore2/tools/y-s100.js`: replicate table (x1 vs y1 on S100 sets, pooled with S300).
- `benchmarks/premise2/explore2/tools/y-lib.js`: helpers (bootstrap as t-ladder.js).
- Logs: `.data/premise2/explore/y-*.log`, `y-report-s300-{1,2}.txt`, `y-table.txt`, `y-s100.txt`.
