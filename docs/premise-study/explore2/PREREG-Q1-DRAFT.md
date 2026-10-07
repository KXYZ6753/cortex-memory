# DRAFT: premise2 pre-registration addendum 4, the round-5 stack `q1` behind det on TEST (option C)

**Status: draft for Kerem's decision, not binding.** Written by worker p2 on Wed 7 Oct 2026 from `PREREG-X1-DRAFT.md`, for option C of `TEST-ARM-OPTIONS.md`. `gates` (addendum 3, `benchmarks/premise2/PREREG-EXPLORE.md`) stays the registered primary.

This draft becomes binding only after five steps:
1. Kerem decides that a second TEST arm runs, and that it is option C (q1 behind det).
2. The file is moved to `benchmarks/premise2/PREREG-EXPLORE2.md`.
3. The code hash below is filled in: the output of `node benchmarks/premise2/explore2/confirm2.js hash`, computed at the commit that freezes `benchmarks/premise2/explore2/`, including `confirm2.js` itself.
4. It is committed before any TEST episode of the arm.
5. `node benchmarks/premise2/explore2/confirm2.js check q-det-q1` reports `"ok": true`.

The TEST runner `confirm2.js` refuses to generate until all of this holds (§6, last item). Addendum 3 is unchanged. Its `gates` confirmation runs first and is reported regardless of this arm.

Every number below carries its source in brackets:
- **journal** = `docs/premise-study/explore-journal.md`, with the entry's time;
- worker notes are `explore2/<x>.md`;
- **p2** = computed for this draft from `.data/premise2/explore/answers.jsonl` (exploration answers only).

The three lines below are read by `confirm2.js` and must stay in this exact form:

Arm: `q-det-q1`

Verdict key prefix: `X-explore2-q1|small|<questionKey>`

Code hash: `<fill at freeze>`

## 1. The frozen arm: `q-det-q1` (q1 behind det, mode "all", reset prompt v2)

**Code:**
- **The arm:** `benchmarks/premise2/explore2/variants/q-stack.js`, variant `q-det-q1` (version 1). It is `det(q1, { mode: "all" })` with `q1 = stackQ(ctx, record)`.
- **Its imports in `explore2/variants/`:**
  - x-agent.js (x1);
  - g-agent.js (g5);
  - d-agent.js (`lexicalPoolCtx`);
  - m-agent.js (`x1Contexts`, `recoveryLists`, `lpProbe`);
  - c-agent.js (imported, but used by q2 only);
  - i-det.js (`det`);
  - their own imports: k-agent, a-agent, w-map, n-conf, p-perfect, m-common, a-common, o-reading, c-render, t-ladder, and `explore2/tools/p-common.js`.
- **The frozen modules they import:** `explore/variants.js`, `explore/run.js`, `prompts.js`, `ollama.js`, `bm25.js`, `rerank.js`, `dense.js`, `text.js`, and `src/bm25.js` (`toBm25Query`).
- **The code hash** covers every file under `benchmarks/premise2/explore2/`. It is computed by `confirm2.js codeHash2()`, recursively, sorted by relative path, with line endings normalised. Value: see "Code hash" above.
- **The runner also checks two things before any TEST episode** (§6):
  - the whole import closure (84 files [p2: `confirm2.js check`]) is tracked and clean;
  - `explore/` still has addendum 3's hash `9801148b…`.

**Model and settings:**
- `gemma4:e2b-it-qat` with the digest in `run-state.json`, Ollama 0.34.2.
- The generation options recorded in `run-state.json`'s provenance: temperature 0, top_p 1, seed 42, num_ctx 16384, num_batch 512, **num_predict 160**, repeat/presence/frequency penalties 1/0/0. These are the options q1 was explored with: `generationOptions({ num_predict: NUM_PREDICT })`, where `NUM_PREDICT` is 160. `confirm2.js` refuses to run if the two differ.
- Calls that set their own cap keep it: YES/NO probes 3 tokens, the det reset 1 token.
- **Note on addendum 3.** Its §1 text names num_predict 320. But its runner (`explore/confirm.js`) passes `run-state.json`'s options, which record num_predict 160: the probe under `PREREG.md` set 160 for all models (`run-state.json` `probe.numPredict` = 160). This draft follows the recorded options. The discrepancy is flagged for Kerem and not changed here.
- The ctx is that of `explore2/run2.js`: the same `search`, `resource`, `chatRaw` and `generate` defaults, mirrored line for line in `confirm2.js`.
  - All model calls go through the det wrapper.
  - The MiniLM cross-encoder runs on the CPU.

One question goes through the following steps. W0 is the first context, yes1 the first W0 email that gets a YES, and A the `gates`-prompt answer over W0.

0. **det (every step).**
   - Before every model call (`generate` and `chatRaw`), a fixed reset call is issued: prompt `§ 0 1 2 3 4 5 6 7 8 9 §`, num_predict 1 (`i-det.js` v2).
   - Its effect: every real call that does not continue its own agent conversation is computed from prompt-cache position 0, so each answer depends only on its own question (§1, Determinism).
   - The reset call is counted in `calls` and its time in `wallMs`.
1. **Contexts, as in `gates`** (`x1Contexts`):
   - global = BM25 top 5 over all mailboxes;
   - mailbox = the header-match rerank of the asker's-mailbox BM25 top 20, top 5;
   - if the global top 1 is from another mailbox, W0 = mailbox and W1 = global; otherwise the reverse;
   - the mailbox BM25 top 30 is kept for step 5.
2. **Commit check.**
   - For each W0 email in rank order, a YES/NO prompt asks whether the email contains the information needed to answer the question. The email is clipped to 3,000 characters; output is 3 tokens with top-5 logprobs.
   - The check stops at the first YES (yes1). The prompt never shares the answer prompt's prefix.
   - yes1's YES-token logprob is recorded.
3. **Committed (a YES was found): A.**
   - Answer with `gates`' exact prompt over W0 (T2 sandwich).
   - A is *sure* when all of these hold: it is not an abstention, it has no hedge phrase, it is not a technical failure, and its mean token logprob is ≥ −0.1. Otherwise A is *unsure*.
4. **m2 recovery (doubted commit).** It runs only when yes1's YES-token logprob is < −0.1.
   - **The list:** the asker's-mailbox BM25 top 50 minus W0, ordered by the MiniLM cross-encoder score. For each email the score is the larger of two scores: one on its rerank text, one on a question-focused snippet.
   - **The probes:** YES/NO probes, as in step 2, go down the first 6 of the list.
   - **Acceptance:** the first YES whose YES-token logprob is ≥ yes1's is accepted as E.
   - **If E is accepted:**
     - answer with the sandwich prompt over [E, W0 top 4];
     - on an exact `NOT IN EMAILS`, ask once more over W1;
     - this answer is final, and it replaces both A and any g5 handover (route `recover-sure` or `recover-unsure`).
   - **If no E is found:** A stands if it is sure; if it is unsure, the question goes to step 6.
5. **No YES in W0 (explore)**, with d6's lexical list (`lexicalPoolCtx`).
   - **The pick list:** the cross-encoder orders a candidate pool into a list of 15 lines (sender, subject, snippet). The pool is:
     - own-mailbox W1;
     - the mailbox BM25 top 30;
     - the owner-name-stripped mailbox BM25 top 20;
     - the subject×3/sender×2-weighted mailbox BM25 top 20.
     - W0 is excluded, and other-mailbox global emails are masked.
   - **Picks and search:**
     - The model picks one line by number, and the picked email is YES/NO-checked.
     - After the first pick, the model writes one FROM/TO/ABOUT search plan. It runs as a fielded FTS5 query in the asker's mailbox, and its results go to the top of the list.
     - At most 3 opens; the agent stops at the first YES.
   - **The final context:**
     - a YES email found: that email plus the W0 top 4;
     - otherwise, if something was picked: the W0 top 4 plus the first pick;
     - otherwise: W0.
   - Answer with the sandwich prompt; on an exact `NOT IN EMAILS`, ask once more on W1.
6. **g5 handover with d8 seeding** (A unsure, and no E from step 4).
   - **g5** is a native tool-calling loop over three tools:
     - `search_mailbox`: BM25 within the asker's mailbox, top 3 in full plus 7 previews, after g5's header rerank;
     - `read`;
     - `answer`.
     An empty turn is re-asked once. The final answer uses the sandwich prompt over the emails g5 read.
   - **d8 seeding:** g5's first own-mailbox search (k 20, the asker's mailbox, a query other than the question) returns [yes1, …BM25(query) top 20], cut to 20, before g5's header rerank.
   - g5's answer is final.

Composition (q.md §1, decision tree):
- d6's list acts only on step 5, and m2 only on steps 3–4. So they never act on the same question.
- The one shared point is a doubted, unsure commit, and there m2 goes first.
- **Stub check:** q1 issues exactly the calls of x1, d8 or m2 wherever only one of them acts. 8 scenarios × 3 questions, 0 failures [q.md §1, `tools/q-check.js`].
- **Behind det,** every question on which no component acts gives an answer byte-identical to det x1: 411/411 on S300-4 + S300-5 [q.md §7].

### Exploration evidence (J1, design-weighted 0.068 × miss + 0.932 × hit; every contrast det vs det)

Per-set intervals are mailbox-cluster paired bootstraps from `cli2 report` / `analyze.js`. Pooled intervals and p-values are from `tools/q-stats.js`: the mailbox-cluster bootstrap, the stratified question bootstrap and the two-sided sign-flip randomisation test. Neither tool was affected by the bootstrap erratum (§6).

| set | role for q1 | n | q1 weighted (miss / hit) | det x1 | q1 − det x1 [95% CI] | q1 − det gates [95% CI] | source |
|---|---|---|---|---|---|---|---|
| S300-1 | development (m2's rule was chosen on it) | 300 | 87.7 (56.0 / 90.0) | 87.3 | +0.41 [0.0, 0.8] | – | q.md §3 |
| S300-4 | decision set (fresh) | 300 | 89.4 (60.0 / 91.5) | 86.9 | +2.41 [0.4, 4.5] | not reported per set | q.md §4; journal Wed 09:32 |
| S300-5 | decision set (fresh) | 300 | 82.2 (30.0 / 86.0) | 82.2 | +0.00 [−1.8, 1.9] | not reported per set | q.md §5 |
| FULL-2 | clean confirmation; **pre-registered primary was q2, not q1** | 600 | 86.8 (49.3 / 89.6) | 85.4 (40.7 / 88.7) | **+1.4 [0.6, 2.2]** | +2.5 [0.4, 5.1] | journal Wed 10:55 |
| FULL-3 | clean confirmation; q1 primary | 600 | 84.1 (42.7 / 87.1) | 84.0 (38.7 / 87.3) | **+0.06 [−0.49, 0.27]** (stratified [−0.76, 0.85]) | +2.0 [0.9, 3.7] | journal Wed 12:25 |
| S300-4 + S300-5 + FULL-2 | pooled, 1,200 | | | | +1.29 [0.49, 2.47], p = 0.004 | – | journal Wed 10:55 |
| FULL-2 + FULL-3 | pooled, 1,200 | | | | +0.74 [0.23, 1.17], p = 0.03 | – | journal Wed 12:25 |
| **all four fresh sets** | pooled, 1,800 | | | | **+0.87 [0.28, 1.88]** (stratified [0.24, 1.52]), p = 0.007 | **+1.64 [0.79, 3.78]** (stratified [0.48, 2.81]), p = 0.006 | journal Wed 12:25; Wed 15:15 |

**Discordant pairs over the 1,800 fresh questions:**
- vs det x1: misses +42/−15, hits +13/−6 [journal Wed 12:25];
- vs det gates: misses +121/−11, hits +34/−32 [journal Wed 15:15].

**The gain is on misses.**
- Against det gates, net discordant hits are +2 for q1, against −5 for x1 and −6 for lite-det-ub [journal Wed 15:15]: on hits, gates reads as well as every hybrid arm.
- On FULL-2, q1's miss accuracy is 40.7 → 49.3 against det x1, and +22.0 on misses / +1.1 on hits against det gates [journal Wed 10:55].
- Because misses carry 6.8% of the design weight, +100 net miss flips over 500 misses is only about +1.4 weighted [journal Wed 15:15].

**FULL-2 and FULL-3 (honest reading).**
- **FULL-2's pre-registered primary contrast was q2** (q1 + thread labels): +0.9 [−1.5, 3.1], "consistent, not confirmed"; q1 was the named secondary arm [journal Wed 09:45, 10:55].
- **On FULL-3, q1 was the primary.** Its +0.06 is "consistent" by the letter of the rule and null in practice: sign-flip p = 0.91 [journal Wed 12:25].
- q1's gain over x1 was never negative on a fresh set (S300-4 +2.41, S300-5 0.00, FULL-2 +1.4, FULL-3 +0.06), but it is set-dependent [journal Wed 12:25].

**Comparators against det gates over the same 1,800 questions:**
- det x1: +0.77 [0.04, 2.36], p = 0.16;
- lite-det-ub: +0.80 [0.35, 2.64], p = 0.08 [journal Wed 15:15].

### Cost

The cap is 3,243 ms mean per question (5 × e2b P-B's 649 ms) [addendum 3 §1; TEST-ARM-OPTIONS.md].

| set | wall ms mean | p95 | max | real model calls / question (incl. det resets) | max real calls | source |
|---|---|---|---|---|---|---|
| S300-4 | 2,444 | 4,507 | 5,939 | 6.61 (13.2) | 16 | q.md §4; max: p2 |
| S300-5 | 2,545 | 4,581 | 5,847 | 7.11 (14.2) | 15 | q.md §5; p95, max, calls incl. resets: p2 |
| FULL-2 | 2,363 | 4,453 | 7,349 | 6.5 (13.0) | 15 | journal Wed 10:55; TEST-ARM-OPTIONS.md; max: p2 |
| FULL-3 | 2,508 | 4,601 | 7,051 | 6.80 (13.60) | 15 | journal Wed 12:25 (mean); rest p2 |

- **det's share of the wall time:** about +150 to +210 ms per question [TEST-ARM-OPTIONS.md; i.md §7: det x1 − x1 = +151 ms ±52].
- **q1 without det on S300-1:** 2,261 ms mean, p95 4,212 [journal Wed 11:10].
- **Wall time includes the CPU cross-encoder.** It is inflated while other CPU jobs run [journal Round 5, x1/gates entry: gates 967 ms on S300-5 during worker CPU jobs].
- **Path mix on FULL-3** (unweighted, n = 600) [e2.md §7]:
  - commit 204;
  - commit → g5 106;
  - m2 recovery without g5 105;
  - m2 then g5 72;
  - explore 113.

**Energy** (design-weighted; GPU = RTX 5060 Ti board power; CPU = runner + llama-server + ollama CPU-seconds × 8.37 J per CPU-second, from the 10 s-block fit [e2.md §1]):

| set | GPU J/q gross | CPU J/q attributed | total J/q (GPU gross + CPU) | GPU J per correct | **total J per correct** (gross / marginal) | CPU share | × det gates (total) | source |
|---|---|---|---|---|---|---|---|---|
| FULL-3 (all arms measured) | 199 | 39 | 238 | 237 | **283** / 265 | 16% | 2.67× | e2.md §3 |
| FULL-2 (CPU imputed from FULL-3 rates) | 189 | 37 (imputed) | – | 218 | 260 (imputed) / 244 | 16% (imputed) | 2.51× (imputed) | journal Wed 10:55; e2.md §4 |
| FULL-2 + FULL-3 pooled | – | – | – | 227 | **272** / 254 | – | 2.59× | e2.md §8 |

- **An m2 firing costs about 9 CPU-seconds** (about 75 J), because the cross-encoder keeps about 7 cores busy for 1.1–1.4 s [e2.md headline 3; journal Wed 15:10].
- **Det gates on FULL-3:** 106 J per correct answer in total [e2.md §3].

### Determinism and resumability

- **Behind det, an answer depends only on its own question.**
  - Real calls start at prompt-cache position 0. The exceptions are g5's own continuing turns, which resume at ≥ 100. No call resumed at 1–99.
  - For q1 on S300-1: 92% of real calls at 0, 8% at ≥ 100 [q.md §3].
  - For det x1: 89% at 0 and 11% at ≥ 100 [i.md §7].
- **History independence is shown by a natural experiment** [i.md §7; journal Round 5, i entry]. Behind det, x1 and t-lk give byte-identical answers on every path where they issue the same prompts: commit 141/141, nofound 38/38. Unwrapped, history alone flipped 5 verdicts on those paths. A deliberate-perturbation test was also 150/150 identical behind det, but its unwrapped control was 150/150 too, so it proves nothing by itself [i.md §7].
- **q1's untouched paths were byte-identical to det x1** across a PC restart and 8 hours [q.md §3].
- **Through `confirm2.js` itself** (the TEST runner's ctx), the first 12 S300-1 questions gave byte-identical answers to the stored q-det-q1 run of Wed 07:56–08:07 ET, 12/12 [p2.md].
  - Also identical: steps, context and read paths, call counts and per-call resume points.
  - Paths covered: commit, found, nofound, recover-unsure, and three d8-seeded g5 handovers.
- **So the TEST run is resumable.** An interrupted run continues with no effect on the answers, and any subset can be re-run to reproduce them exactly, given the same Ollama build, digest and options (checked by the runner).

## 2. Round-5 record: how q1 became the arm

**Round 5** ran Tue 6 Oct ~21:00 ET to Wed 7 Oct 18:00 ET [journal Round 5].
- **New sets.** Fresh sets were drawn, email-disjoint from all earlier sets:
  - S300-4 and S300-5: decision sets, at most 2 variants per worker;
  - FULL-2: clean confirmation, lead only;
  - FULL-3: drawn Wed 11:35 ET for a second replication.
- **The promotion bar** was raised to +1.5 vs x1, pooled over S300-4 + S300-5 [journal Round 5].
- **Worker q built two stacks:**
  - q1 = x1 + d8 + m2;
  - q2 = q1 + thread labels.
  - Both run behind det, against `i-det-x1` v2 [q.md].

What happened, in order:

1. **Decision sets** (S300-4 + S300-5) [journal Wed 09:32; q.md §5–6]:
   - q1 +1.20 [−0.1, 3.0] vs det x1, below the bar;
   - q2 +2.51 [0.2, 4.6], p = 0.026, above the bar.
2. **FULL-2** (rule fixed Wed 09:45 ET; primary q2 − det x1) [journal Wed 10:55]:
   - q2 +0.9 [−1.5, 3.1]: consistent, not confirmed;
   - q1 (secondary) +1.4 [0.6, 2.2];
   - the labels did not replicate: q2 − q1 −0.5.
   - The memo then recommended q1 as the TEST arm.
3. **FULL-3** (rule fixed Wed 11:35 ET; primary q1 − det x1) [journal Wed 12:25]:
   - q1 +0.06, essentially null;
   - pooled over four fresh sets: +0.87 [0.28, 1.88].
4. **lite-det-ub** (a cheaper stack) on the same four fresh sets [journal Wed 14:35, 15:05]:
   - x1-level: +0.02 [−0.75, 0.99];
   - below q1: −0.83 [−1.66, −0.08].
5. **Det gates on S300-4 + S300-5** completed the det-vs-det table against the registered primary [journal Wed 15:10, 15:15]:
   - q1 +1.64 [0.79, 3.78], p = 0.006;
   - x1 +0.77, p = 0.16;
   - lite +0.80, p = 0.08.
   - q1 is the only arm whose fresh-set gain over gates is clearly above zero.
6. **Memo** `TEST-ARM-OPTIONS.md` recommends **C** (q1 behind det) for Y3 [memo, addendum Wed 15:15 ET]. Its alternatives:
   - A: gates only;
   - B: x1, now dominated by lite;
   - D: lite-det-ub, the best accuracy per joule.

## 3. Population

The same 600 TEST questions as addendum 3: P-B items 0..599 of `benchmarks/premise2/agent-items.json`, in that order (`explore/confirm.js confirmRecords`). The remaining 355 TEST questions are not run for this arm.

## 4. Hypotheses (Holm, α = .05, over the three tests)

- **Y1** e2b(q1) − e2b(P-B): superiority.
- **Y2-NI** e2b(q1) − 31b(P-B): non-inferiority at a 5-point margin.
- **Y3** e2b(q1) − e2b(gates): superiority. This tests whether an e2b agent with engineered retrieval beats the best one-shot pipeline.

**Estimator and adjustment:** as in addendum 3 §4.
- Per-question paired differences over the 600 questions where both arms have a final tier-A score, unweighted.
- Mailbox-cluster bootstrap with B = 10,000 and seed 20260922 (`stats.js` `clusterBootstrap`, `bootstrapP` (two-sided), `classify`).
- Holm-adjusted p-values across Y1, Y2-NI and Y3.

**gates' TEST answers** come from addendum 3's confirmation run, as the third arm. That run is plain `gates`, not behind det. On S300-1, det gates was byte-identical to plain gates on 300/300 questions, because one-shot sandwich prompts already compute from position 0 [i.md §7]. The det-vs-det exploration contrast therefore carries over to this comparison.

**q1 − x1 is not a hypothesis.** The expected +0.87 cannot be resolved at n = 600 [TEST-ARM-OPTIONS.md].

**Power note for Y3 (honest).**
- **Exploration expectation:** +1.64 [0.79, 3.78] over 1,800 fresh questions, design-weighted J1, det vs det [journal Wed 15:15]. The per-set FULL values were +2.5 and +2.0 [journal Wed 10:55, 12:25].
- **Uncertainty on TEST:** the CI half-width is about ±2.5 points at n = 600 [TEST-ARM-OPTIONS.md].
- **Approximate power** [p2's calculation: normal approximation, SE ≈ 2.5 / 1.96 ≈ 1.28, two-sided α = .05, the level Y3 gets only if it is last in Holm's order]:

  | true effect | power |
  |---|---|
  | +1.6 | about 25% |
  | +2.0 | about 35% |
  | +2.5 | about 50% |

  Power is lower if Y3 has to be tested at α/2 or α/3.
- **Expected shrinkage.** Shrinkage from exploration to fresh data has been the rule (§6), so the true TEST effect is more likely below +1.6 than above it.
- **Two further caveats:**
  - Exploration is design-weighted to the pool's 6.8% miss share, while the TEST estimator is unweighted. Since the gain is on misses, the TEST effect scales with TEST's miss share.
  - Exploration grading is J1-only.
- **Reporting.** A null Y3 is the likely outcome. Report it with its CI either way.

## 5. Grading, missing data, energy

**Grading:** as in addendum 3 §5–§7, with the verdict key prefix `X-explore2-q1|small|<questionKey>`.
- Tier A on every answer: J1 `openai/gpt-oss-20b` and J2 `nvidia/nemotron-3-nano-30b-a3b`.
- Blind adjudication by `deepseek/deepseek-v4.1-flash` in three cases:
  - when J1 and J2 disagree;
  - when both say INCORRECT;
  - for a seeded 10% of consensus-CORRECT answers (`inCorrectAudit` on that prefix).
- The adjudicator sees the emails the final answer call saw: `readPaths` if present, else `contextPaths`, as in `confirm.js confirmUnits`.
- Exact abstentions and technical failures are INCORRECT without a judge call.
- Comparators are as in addendum 3 §5.

**Missing data:** as in addendum 3 §6.
- A context overflow, or a technical failure after 3 attempts, counts INCORRECT.
- Sensitivity analysis: the same tests with those questions excluded.
- An answer left without a final verdict is excluded pairwise and counted.
- Exploration rate of final technical statuses for q1 [p2]:
  - FULL-2: 5 context overflows and 1 output limit of 600;
  - FULL-3: 2 context overflows of 600.

**Energy:** the energy logger **and** the CPU sampler are mandatory for this arm.
- **What `confirm2.js` does:**
  - starts both itself: `energy-logger.js` (nvidia-smi plus LibreHardwareMonitor on port 8085) and `tools/i-cpusampler.js`;
  - verifies GPU samples, LHM package samples, and its own pid in the sampler's process list before the model is loaded;
  - refuses to run otherwise;
  - writes the runner pid, logger pid and sampler pid to `manifest.jsonl`.
- **The idle baseline** is 30 s with the model resident; blocks are 50 questions, as in addendum 3.
- **Report two bases:**
  1. Addendum 3's basis: block integration of CPU package plus GPU, a lower bound, comparable with gates' TEST figure.
  2. e2.md's attribution:
     - GPU per question window [at − wallMs, at], gross and marginal (idle subtracted);
     - CPU = (runner pid + llama-server + ollama) CPU-seconds inside the windows, times J per CPU-second from this run's own fit of package W on busy % over 10 s blocks (method A);
     - the direct share (method B) as a check.
  - The runner pid is taken from the manifest, not detected.
- **Report also:**
  - J per answer and per correct answer, against `gates`, e2b P-B and 31b P-B (main-study figures);
  - the path mix: commit / commit → g5 / m2 recovery / m2 → g5 / explore;
  - calls per question, real and including resets;
  - det's resume points (`det.cached`). Expected: real calls at 0 or at their own conversation's ≥ 100. Any call at 1–99 is reported.

## 6. Disclosures

- **Number of configurations tried.**
  - Phase 1 ran 35 e2b configurations [addendum 3 §2].
  - Phase 2 rounds 1–4 ran about 75 configurations across one-shot, hybrid and agent families [journal, Phase 2 summary].
  - Round 5 had 10 workers [journal, Round 5 summary] and added 65 new variant ids to the exploration answer store [p2, from `answers.jsonl`]. That count includes diagnostics: gold-only oracles, det wrappers, energy re-runs and perturbation controls.
  - q1 is one of two stacks (with q2) that worker q ran on the decision sets.
- **Shrinkage pattern.** Screening gains have shrunk on fresh data every time:
  - x1 +2.5 → +1.7; n-g5 +1.5 → −0.3; j2 +0.55 → 0; y1 +1.07 → −0.5 [journal, Phase 2 summary];
  - q2 +2.51 → +0.9 [journal Wed 10:55];
  - q1 +1.20 on the decision sets → +1.4 and +0.06 on the two confirmation sets [journal Round 5 summary, item 4];
  - in phase 1, E* went from +1.5 on DEV to −1.1 on TEST [addendum 3 §4].
- **Exploration is J1-only**, which runs about 4 points below adjudicated scores [addendum 3 §8].
- **Bootstrap erratum.**
  - 15 analysis tools under `explore2/tools/` drew bootstrap indices from an LCG computed in doubles: period 10,466, non-uniform [journal Wed 10:05; `explore2/ci-erratum.md`]. The tools were fixed (`tools/rng.js`, mulberry32) and about 190 intervals recomputed. No promotion, null or confirmation decision changed.
  - Every interval in this draft is from `cli2 report` / `analyze.js` (splitmix32) or `tools/q-stats.js` (mulberry32), which were never affected [journal Wed 10:05; q.md §5].
- **Circularity of the choice.**
  - q2 was FULL-2's pre-registered primary. Preferring q1 after FULL-2 is a post-hoc choice on FULL-2 [journal Wed 10:55; TEST-ARM-OPTIONS.md].
  - FULL-3 was then drawn and run with q1 as primary, and it gave +0.06.
  - Option C was finally chosen over x1 and lite-det-ub on the same 1,800 fresh questions that give q1's estimate against gates (+1.64).
  - The arm's exploration estimate therefore carries selection optimism, and this TEST run is the guard against it.
- **The components were not fresh on every set.**
  - m2's rule was chosen on S300-1, so its part of the S300-1 result is in-sample [q.md §3; m.md].
  - d6 and d8 were developed on development sets: d8's x1 replay was +0.6 [0.0, 1.2] over 1,500 dev questions [journal Wed 04:10; d.md].
  - Worker d had already run d8 on the decision sets S300-4 + S300-5 (+0.5 [−0.7, 1.6] vs x1), so those two sets were not entirely fresh for q1's d8 part [journal Wed 04:10].
- **Energy for FULL-2.** The CPU sampler was not running for FULL-2's gates, x1 and q1 arms, so their CPU figures are imputed from FULL-3's rates [e2.md §4]. Only FULL-3's are fully measured.
- **The TEST runner.** `explore2/confirm2.js` (written Wed 7 Oct by p2; `docs/premise-study/explore2/p2.md`) reuses `explore/confirm.js` (item list, explore/ code hash) and `explore/run.js` (preflight, store) by import, and mirrors `run2.js`'s ctx. On `run` it refuses, before reading any TEST data, unless all of these hold:
  - this file is committed, unmodified, names `Arm: q-det-q1`, has the verdict key prefix line, and has a code hash equal to the current one;
  - every file of the arm's import closure, and everything under `explore2/`, is tracked and clean;
  - `explore/` still has addendum 3's hash.

  It records in `manifest.jsonl`: git HEAD, this file's commit and sha256, the code and closure hashes, the runner / logger / sampler pids, and Ollama's build, digest and options. After the freeze, nothing may be added under `benchmarks/premise2/explore2/` until the run is complete: any change alters the code hash and stops the runner. A re-freeze would need an entry in the deviation log.

## 7. Order

1. **Run addendum 3's `gates` confirmation.** It needs LibreHardwareMonitor running as admin on port 8085, and the Mac's tier-A verdict files or the registered fallback.
2. **Freeze and register:**
   - Kerem chooses C.
   - Any remaining code is committed under `benchmarks/premise2/explore2/` (including `confirm2.js`'s grading and analysis, p2.md item 1).
   - Fill "Code hash" with `confirm2.js hash`, move this file to `benchmarks/premise2/PREREG-EXPLORE2.md`, and commit it.
   - `confirm2.js check q-det-q1` must print `"ok": true`.
3. **Run the arm:** `node benchmarks/premise2/explore2/confirm2.js run q-det-q1 600`.
   - No other GPU or CPU jobs run during it.
   - The runner takes the GPU lock and starts the energy logger and CPU sampler itself.
4. **Grade** (tier A, §5), **analyze** (§4–§5), and **report** whatever it shows.

## Deviation log
