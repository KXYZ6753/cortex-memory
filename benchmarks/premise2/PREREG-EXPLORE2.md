# premise2 pre-registration addendum 4: three exploration-phase-2 arms on TEST (q1 confirmatory; lite and x1 secondary)

**Status: binding.** Committed on Wed 7 Oct 2026 (about 16:50 ET), before any TEST episode of the three arms below. Kerem approved running the best exploration systems on TEST as study data (Wed ~16:10 ET). Worker p3 wrote the text from p2's `PREREG-Q1-DRAFT.md`, and the lead reviewed it. `gates` (addendum 3, `benchmarks/premise2/PREREG-EXPLORE.md`) stays the registered primary of addendum 3. Its TEST confirmation ran first (Wed 16:13–16:24 ET; 355 more questions 16:27–16:32 ET) and is reported under addendum 3 whatever happens here.

This text becomes binding only after these steps, all before any TEST episode of any arm below:
1. The lead moves this file to `benchmarks/premise2/PREREG-EXPLORE2.md`.
2. The code under `benchmarks/premise2/explore2/` (the arms, the runner `confirm2.js`, the grading `tier-a.js`, the analysis `confirm2-analyze.js` and `confirm2-energy.js`, the comparator grading `confirm-comp.js`) is committed, and the `Code hash:` line below is filled with the output of `node benchmarks/premise2/explore2/confirm2.js hash` at that commit.
3. This file is committed.
4. `node benchmarks/premise2/explore2/confirm2.js check q-det-q1` (and the same for `lite-det-ub` and `i-det-x1`) reports `"ok": true`.

The runner refuses to generate until all of this holds (§8, last item). Earlier pre-registrations are unchanged.

Sources. Every exploration number carries its source in brackets: **journal** = `docs/premise-study/explore-journal.md` with the entry's time; worker notes are `explore2/<x>.md`; **p2** = computed by worker p2 for `PREREG-Q1-DRAFT.md` from exploration `answers.jsonl` only. All exploration numbers are J1 (gpt-oss-20b), design-weighted (0.068 × miss + 0.932 × hit), det vs det, on the 30 tuning mailboxes; none is from TEST.

The lines below are read by `confirm2.js` (`parsePrereg`) and must stay in exactly this form. The first arm listed is the confirmatory one, and the arms run on TEST in the listed order.

Arms: q-det-q1, lite-det-ub, i-det-x1

Verdict key prefix (q-det-q1): `X-explore2-q1|small|<questionKey>`

Verdict key prefix (lite-det-ub): `X-explore2-lite|small|<questionKey>`

Verdict key prefix (i-det-x1): `X-explore2-x1|small|<questionKey>`

Code hash: `afbc5e254fdcded37f25dfc4de157faa3c195ff5c55ce9188f965053e24c0941`

## 1. The frozen arms

All three arms run behind det (`explore2/variants/i-det.js` v2, mode "all"): before every model call (`generate` and `chatRaw`) a fixed reset call is issued (prompt `§ 0 1 2 3 4 5 6 7 8 9 §`, num_predict 1). Every real call that does not continue its own agent conversation is then computed from prompt-cache position 0, so each answer depends only on its own question. The reset is counted in `calls` and its time in `wallMs`.

**Model and settings (all arms):**
- `gemma4:e2b-it-qat` with the digest in `run-state.json`, Ollama 0.34.2.
- The generation options recorded in `run-state.json`'s provenance: temperature 0, top_p 1, seed 42, num_ctx 16384, num_batch 512, **num_predict 160**, repeat/presence/frequency penalties 1/0/0. These are the options every arm was explored with (`generationOptions({ num_predict: NUM_PREDICT })`, NUM_PREDICT = 160) and the options of the comparator answers and of addendum 3's gates TEST run (addendum 3, deviation log item 1). `confirm2.js` refuses to run if they differ. Calls that set their own cap keep it: YES/NO probes 3 tokens, the det reset 1 token.
- The per-question ctx is `explore2/run2.js`'s (same `search`, `resource`, `chatRaw`, `generate` defaults), mirrored in `confirm2.js`. The MiniLM cross-encoder runs on the CPU.

### 1.1 `q-det-q1` (confirmatory): q1 = x1 + d8 + m2, behind det

`explore2/variants/q-stack.js`, variant `q-det-q1` version 1 = `det(q1, { mode: "all" })`. One question (W0 = first context, yes1 = the first W0 email that gets a YES, A = the gates-prompt answer over W0):
1. **Contexts as in gates** (`x1Contexts`): global = BM25 top 5 over all mailboxes; mailbox = the header-match rerank of the asker's-mailbox BM25 top 20, top 5. If the global top 1 is from another mailbox, W0 = mailbox and W1 = global; otherwise the reverse. The mailbox BM25 top 30 is kept for step 5.
2. **Commit check:** for each W0 email in rank order, a YES/NO prompt (email clipped to 3,000 characters; 3 output tokens, top-5 logprobs) asks whether it contains the information needed; stop at the first YES; record yes1's YES-token logprob.
3. **Committed: A** with gates' exact prompt over W0 (T2 sandwich). A is *sure* if not an abstention, no hedge phrase, not a technical failure, and mean token logprob ≥ −0.1; otherwise *unsure*.
4. **m2 recovery** (only when yes1's YES logprob < −0.1): the asker's-mailbox BM25 top 50 minus W0, ordered by the MiniLM cross-encoder (max of the rerank-text and question-focused-snippet scores); YES/NO probes down the first 6; the first YES with logprob ≥ yes1's is accepted as E → answer over [E, W0 top 4] (on an exact `NOT IN EMAILS`, once more over W1); final (routes recover-sure / recover-unsure). If no E: A stands if sure; if unsure, step 6.
5. **No YES in W0 (explore)** with d6's lexical list: a 15-line pick list ordered by the cross-encoder from own-mailbox W1, the mailbox BM25 top 30, the owner-name-stripped mailbox BM25 top 20 and the subject×3/sender×2-weighted mailbox BM25 top 20 (W0 excluded, other-mailbox emails masked); the model picks a line, the pick is YES/NO-checked; after the first pick one FROM/TO/ABOUT search plan runs as a fielded FTS5 query in the asker's mailbox; at most 3 opens; final context = a YES email + W0 top 4, else W0 top 4 + the first pick, else W0; sandwich answer, once more on W1 after an exact `NOT IN EMAILS`.
6. **g5 handover with d8 seeding** (A unsure, no E): g5 is a native tool-calling loop (`search_mailbox` BM25 in the asker's mailbox, top 3 in full plus 7 previews after g5's header rerank; `read`; `answer`); its first own-mailbox search returns [yes1, …BM25 top 20] cut to 20; the final answer uses the sandwich prompt over what g5 read.

Stub check: q1 issues exactly x1's, d8's or m2's calls wherever only one of them acts (8 scenarios × 3 questions, 0 failures) [q.md §1].

### 1.2 `lite-det-ub` (secondary): t-lk + d6 + m2, g5 only when the recovery fails, behind det

`explore2/variants/lite-stack.js`, variant `lite-det-ub` version 1 = `det(run(UB), { mode: "all" })` [journal Wed 13:45, 14:45; lite.md].
- t-lk (the minimal agent: the commit check plus one list pick [journal, Phase 2 summary]) with d6's explore list;
- m2's recovery (q1's helpers and arguments) only on doubted, unsure commits;
- a d8-seeded g5 handover only when that recovery finds no email (11% of questions on the dev sets [journal Wed 14:45]).
- It skips x1's g5 handover on unsure commits that have a confident first YES. Where it makes q1's calls its answers are byte-identical to q1's (529 of 529 dev questions) [journal Wed 14:45].

### 1.3 `i-det-x1` (secondary): x1 behind det

`explore2/variants/i-det.js`, variant `i-det-x1` version 2 = `det(x1, { mode: "all" })`. x1 (`variants/x-agent.js`) is the round-2 hybrid agent: the YES/NO commit check over gates' first context; an unsure answer goes to the g5 tool agent; with no YES, a cross-encoder-ordered list pick plus a model-written fielded search [journal, Phase 2 summary]. Its earlier draft `PREREG-X1-DRAFT.md` is superseded by this text.

### 1.4 Code identity

- **Code hash** (line above): sha256 over every file under `benchmarks/premise2/explore2/`, recursive, sorted by relative path, line endings normalised (`confirm2.js codeHash2()`, the construction of `explore/confirm.js codeHash()`).
- The runner also refuses unless every file of the arms' import closure (`explore2/`, `explore/`, the frozen premise2 modules and `src/bm25.js`) is tracked and clean, and `explore/` still has addendum 3's code hash `9801148b…`.

### 1.5 Determinism and resumability

- Behind det, real calls start at prompt-cache position 0, except g5's own continuing turns (≥ 100); no call resumed at 1–99 [q.md §3; i.md §7]. Behind det, x1 and t-lk give byte-identical answers wherever they issue the same prompts (commit 141/141, nofound 38/38) [i.md §7].
- Through `confirm2.js` itself, 12 S300-1 questions gave byte-identical answers to the stored q-det-q1 run, 12/12, including steps, context and read paths, call counts and resume points [p2.md].
- So an interrupted run continues with no effect on the answers, given the same Ollama build, digest and options (checked by the runner).

## 2. Selection record and exploration evidence

**How the arms were chosen.** Phase 1 ran 35 e2b configurations [addendum 3 §2]. Phase 2 rounds 1–4 ran about 75 configurations across one-shot, hybrid and agent families [journal, Phase 2 summary]; x1 was round 2's best agent. Round 5 (Tue 6 Oct ~21:00 ET to Wed 7 Oct 18:00 ET) had 10 workers (b, c, d, u, i, l, q, r, s, lite) and four fresh sets, email-disjoint from all earlier sets: S300-4 and S300-5 (decision sets), FULL-2 (clean confirmation, lead only) and FULL-3 (drawn Wed 11:35 ET) [journal, Round 5 summary]. Round 5 added 65 new variant ids to the exploration answer store, including diagnostics [p2].
1. Decision sets: q1 +1.20 [−0.1, 3.0] vs det x1, below the +1.5 promotion bar; q2 (q1 + thread labels) +2.51 [0.2, 4.6] above it [journal Wed 09:32].
2. FULL-2 (primary q2 − det x1, rule fixed Wed 09:45 ET): q2 +0.9 [−1.5, 3.1], consistent, not confirmed; q1 (secondary) +1.4 [0.6, 2.2]; q2 − q1 −0.5 [journal Wed 10:55]. q1 was then preferred as the TEST candidate.
3. FULL-3 (primary q1 − det x1, rule fixed Wed 11:35 ET): +0.06 [−0.49, 0.27], sign-flip p = 0.91, essentially null [journal Wed 12:25].
4. lite-det-ub was designed on Wed 7 Oct by worker lite on S300-1/2/3 [lite.md; journal Wed 14:45] and run the same day on FULL-2/FULL-3 (rule fixed Wed 13:45 ET) and on S300-4/S300-5 (Wed 14:50 ET), on which it had never been selected [journal Wed 14:35, 15:05].
5. det gates on S300-4/S300-5 completed the det-vs-det table against gates over all four fresh sets [journal Wed 15:10, 15:15].
6. The memo `TEST-ARM-OPTIONS.md` recommended q1 (option C) for the superiority test over gates; Kerem approved running q1, lite-det-ub and x1 on TEST as study data.

**Evidence over the four fresh sets (1,800 questions; S300-4 + S300-5 + FULL-2 + FULL-3; `tools/q-stats.js`).**

| system − det gates | weighted Δ | mailbox-cluster CI | stratified question CI | sign-flip p | discordant misses | discordant hits | source |
|---|---|---|---|---|---|---|---|
| q1 | **+1.64** | [0.79, 3.78] | [0.48, 2.81] | 0.006 | +121/−11 | +34/−32 | journal Wed 15:15 |
| lite-det-ub | +0.80 | [0.35, 2.64] | [−0.08, 1.67] | 0.08 | +101/−11 | +15/−21 | journal Wed 15:15 |
| det x1 | +0.77 | [0.04, 2.36] | [−0.29, 1.84] | 0.16 | +92/−9 | +25/−30 | journal Wed 15:15 |

| contrast, 1,800 fresh questions | Δ [mailbox-cluster CI] | p | discordant misses / hits | source |
|---|---|---|---|---|
| q1 − det x1 | +0.87 [0.28, 1.88] (stratified [0.24, 1.52]) | 0.007 | +42/−15 / +13/−6 | journal Wed 12:25 |
| lite − det x1 | +0.02 [−0.75, 0.99] | 0.97 | +34/−27 / +15/−16 | journal Wed 15:05 |
| lite − q1 | −0.83 [−1.66, −0.08] | 0.04 | +3/−22 / +11/−19 | journal Wed 15:05 |

Per set, against det gates: q1 +2.5 (FULL-2) / +2.0 (FULL-3); det x1 +1.1 / +2.0; lite +1.1 / +1.4, pooled over FULL-2 + FULL-3 +1.25 [0.78, 2.11] [journal Round 5 summary; Wed 14:35]. q1 − det x1 per set: S300-1 (development) +0.41, S300-4 +2.41, S300-5 +0.00, FULL-2 +1.4, FULL-3 +0.06 [journal Wed 10:55, 12:25]. lite − det x1 per set: S300-4 +0.67, S300-5 +0.86, FULL-2 +0.02, FULL-3 −0.62 [journal Wed 15:05].

The hybrid systems' gain over the one-shot pipeline is almost entirely on misses; on hits gates reads as well as each of them (net discordant hits q1 +2, lite −6, x1 −5) [journal Wed 15:15]. Misses carry 6.8% of the exploration design weight; TEST is unweighted (§4).

**Cost and energy (exploration).** The cost cap is 3,243 ms mean per question (5 × e2b P-B's 649 ms) [addendum 3 §1].

| system | wall ms FULL-2 / FULL-3 | real calls / question FULL-2 (incl. resets) | GPU J per correct FULL-2 / FULL-3 | total J per correct, FULL-3 (GPU gross + attributed CPU) | CPU share FULL-3 | source |
|---|---|---|---|---|---|---|
| det gates | 807 / 794 | 1.0 (2.0) | 96 / 99 | 106 | 7% | journal Wed 10:55, 12:25; Round 5 summary; e2 entry |
| lite-det-ub | 1,684 / 1,826 | – | 154 / 175 | 205 | 15% | journal Wed 14:35; e2 entry |
| det x1 | 1,944 / 2,016 | 5.5 (11.0) | 197 / 205 | 227 | 10% | journal Wed 10:55, 12:25; e2 entry |
| q1 | 2,363 / 2,508 | 6.5 (13.0) | 218 / 237 | 283 | 16% | journal Wed 10:55, 12:25; e2 entry |

An m2 firing costs about 9 CPU-seconds (about 75 J), because the cross-encoder keeps about 7 cores busy for 1.1–1.4 s [journal, e2 entry]. Wall time includes the CPU cross-encoder and is inflated while other CPU jobs run.

## 3. Population

The same 600 TEST questions as addendum 3: P-B items 0..599 of `benchmarks/premise2/agent-items.json`, in that order (`explore/confirm.js confirmRecords`). The remaining 355 TEST questions are not run for these arms unless time allows (then secondary only, §4).

## 4. Hypotheses

**Confirmatory: `q-det-q1`, Holm (α = .05) over the three tests.**
- **Z1** e2b(q1) − e2b(P-B): superiority.
- **Z2-NI** e2b(q1) − 31b(P-B): non-inferiority at a 5-point margin.
- **Z3** e2b(q1) − e2b(gates): superiority. gates = addendum 3's TEST answers and their tier-A verdicts (`.data/premise2/explore/confirm/`). That run is plain gates, not behind det; on S300-1, det gates was byte-identical to plain gates on 300/300 questions, because one-shot sandwich prompts already compute from position 0 [i.md §7].

**Estimator:** exactly addendum 3 §4 / `explore/confirm.js analyzeConfirm`: per-question paired differences over the 600 questions where both arms have a final tier-A score, unweighted; mailbox-cluster bootstrap with B = 10,000 and seed 20260922 (`stats.js` `clusterBootstrap`, `bootstrapP`, `classify`); Holm-adjusted p-values across Z1, Z2-NI and Z3. Scores from `explore/confirm.js scoreWith`.

**Secondary (estimates, 95% CIs and unadjusted p-values only; labelled secondary; no confirmatory claim):**
- the same three contrasts for `lite-det-ub` and for `i-det-x1` (each against e2b P-B, 31b P-B at the 5-point margin, and gates);
- each of lite and x1 minus q1; lite minus x1;
- e2b(q1) − 31b(P-B) superiority;
- J1-only versions of the contrasts (comparable with exploration);
- every arm's own overflow / technical failures excluded instead of INCORRECT (§6);
- any arm run on more than the 600: Z1 over every TEST question run.

**Power (honest).** Exploration expects q1 − gates of about +1.6 (1,800 fresh questions; +2.5 and +2.0 on FULL-2 and FULL-3) against a TEST half-width of about ±2.5 points at n = 600 [TEST-ARM-OPTIONS.md]. A normal approximation (SE ≈ 1.28) gives about 25% power at a true +1.6, 35% at +2.0 and 50% at +2.5 at two-sided α = .05, less if Z3 is tested at α/2 or α/3 under Holm [p2]. Shrinkage from exploration to fresh data has been the rule (§8), the gain is on misses (so the TEST effect scales with TEST's miss share, which nobody has read), and exploration is J1-only. **A null Z3 is the likely outcome; it is reported with its CI either way.** q1 − x1 (+0.87 expected) and lite − x1 cannot be resolved at n = 600 and are not hypotheses.

## 5. Grading

As addendum 3 §5, per arm with its verdict key prefix (`X-explore2-q1|small|<questionKey>`, `X-explore2-lite|small|<questionKey>`, `X-explore2-x1|small|<questionKey>`):
- Tier A on every answer: J1 `openai/gpt-oss-20b` and J2 `nvidia/nemotron-3-nano-30b-a3b`; blind adjudication by `deepseek/deepseek-v4.1-flash` (all via OpenRouter) when J1 and J2 disagree, when both say INCORRECT, and for a seeded 10% of consensus-CORRECT (`inCorrectAudit` on the arm's prefix).
- The adjudicator sees the emails the final answer call saw: the answer's `readPaths` (every arm sets it: the final context, plus W1 when the abstention retry ran; g5's final read set on a handover), else `contextPaths`, as `explore/confirm.js confirmUnits`. Quotes must verify against the gold, its twins or answer-bearing emails among those.
- Exact abstentions and technical failures are INCORRECT without a judge call.
- Verdict keys are the main study's (`unitVerdictKey`), so an answer identical to one already judged (main study, addendum 3's `confirm/verdicts.jsonl`, or another arm of this addendum) reuses that verdict.
- Implementation: `confirm2.js grade <arm>` → `explore2/tier-a.js`, a parameterised copy of `explore/confirm.js gradeConfirm` (same judge-model check, spend-cap check, passes, adjudication rule and evidence, verdict record shape); verdicts to `.data/premise2/explore/confirm2/<arm>/verdicts.jsonl`; spend in `spend.jsonl` (phase `confirm2`).
- **Comparators:** as addendum 3 §5 and its deviation log item 2: the unchanged e2b and 31b P-B answers on the 600, graded by the same tier-A procedure (`explore2/confirm-comp.js grade`, phase `confirm-comp`), verdicts in addendum 3's `confirm/verdicts.jsonl` under the main study's keys.

## 6. Missing data and failures

As addendum 3 §6:
- An arm's answer that overflows the context window, or fails technically after 3 attempts, counts INCORRECT: its prompts are built at run time, so the failure is part of the pipeline (`scoreWith` with `overflowIsWrong`). This applies to gates in Z3 as well. Sensitivity: the same tests with those questions excluded (context overflows, and statuses outside `explore/run.js` FINAL_STATUSES after 3 attempts; an `empty` model output stays INCORRECT). Addendum 3's `analyzeConfirm` excludes only overflows in its sensitivity; gates had neither on TEST (600/600 status ok [journal, TEST runs]).
- A tier-A answer left without a final verdict (J1 and J2 disagree and no adjudication) is excluded pairwise; the count is reported.
- Exploration rate of final technical statuses: q1 FULL-2 5 context overflows and 1 output limit of 600, FULL-3 2 overflows of 600 [p2]; lite FULL-2 7 of 600 (overflow 4, output limit 2, http_error 1) [journal Wed 14:35].

## 7. Descriptives and energy (secondary)

Per arm, and for gates from addendum 3's run: tier-A accuracy on the 600; wall time per question (mean, p50, p95); calls per question (real, and including det resets); the path mix (commit / commit → g5 / m2 / m2 → g5 / explore); det's resume points (any call at 1–99 is reported).

**Energy.** The energy logger (`energy-logger.js`: nvidia-smi plus LibreHardwareMonitor on port 8085) **and** the CPU sampler (`explore2/tools/i-cpusampler.js`) are mandatory for every arm. `confirm2.js` starts both itself under the explore2 GPU lock, verifies GPU samples, LHM package samples and its own pid in the sampler's process list before the model is loaded, refuses otherwise, and writes the runner, logger and sampler pids to the arm's `manifest.jsonl`. Each arm run: fresh model load, two warm-up calls, a 30 s idle baseline with the model resident, blocks of 50. Two bases are reported, per answer and per correct answer (tier A):
1. **Addendum 3's basis:** block integration of CPU package plus GPU, gross and marginal; a lower bound, comparable with gates' TEST figure and the main study's.
2. **e2.md's attribution:** GPU per question window [at − wallMs, at], gross and marginal (the run's idle GPU W subtracted); CPU = (runner pid + every llama-server + ollama) CPU-seconds inside the windows × J per CPU-second from the run's own fit of package W on busy % over 10 s blocks (method A); the direct share (method B) as a check. The runner pid is taken from the manifest. For gates (addendum 3's run, no manifest; the sampler ran alongside it, addendum 3 deviation item 3) the runner pid is detected as in e2.md: the node process alive over the whole run with the most CPU inside the run's windows, the logger excluded, reported with the runner-up and the correlation with non-generation time.

Comparators' energy: the main study's published e2b and 31b P-B figures.

## 8. Disclosures

- **Number of configurations tried and selection.** Phase 1: 35 e2b configurations [addendum 3 §2]. Phase 2 rounds 1–4: about 75 [journal, Phase 2 summary]. Round 5: 10 workers, 65 new variant ids including diagnostics [journal, Round 5 summary; p2]. The three arms are selected from all of these; their exploration estimates carry selection optimism, and this TEST run is the guard against it.
- **Shrinkage.** Screening gains have shrunk on fresh data every time: x1 +2.5 → +1.7, n-g5 +1.5 → −0.3, j2 +0.55 → 0, y1 +1.07 → −0.5 [journal, Phase 2 summary]; q2 +2.51 → +0.9 [journal Wed 10:55]; q1 +1.20 on the decision sets → +1.4 and +0.06 on FULL-2 and FULL-3 [journal Round 5 summary, item 4]; in phase 1, E* went from +1.5 on DEV to −1.1 on TEST [addendum 3 §4]. A placebo moved the pooled decision sets by +0.7 [journal Round 5 summary, item 4].
- **Exploration is J1-only**, which runs about 4 points below adjudicated scores [addendum 3 §8]; exploration and TEST numbers are not on the same basis.
- **Bootstrap erratum.** 15 analysis tools under `explore2/tools/` drew bootstrap indices from an LCG computed in doubles (period 10,466, non-uniform); they were fixed (`tools/rng.js`, mulberry32) and about 190 intervals recomputed; no promotion, null or confirmation decision changed [journal Wed 10:05; `ci-erratum.md`]. Every interval in this text is from `cli2 report` / `analyze.js` or `tools/q-stats.js`, which were never affected.
- **q1 was chosen over q2 after FULL-2.** q2 was FULL-2's pre-registered primary; preferring q1 is a post-hoc choice on FULL-2 [journal Wed 10:55]. FULL-3 was then drawn with q1 as primary and gave +0.06. q1 was finally preferred over x1 and lite on the same 1,800 fresh questions that give its estimate against gates (+1.64).
- **lite-det-ub was designed and confirmed on the same day** (Wed 7 Oct): developed on S300-1/2/3 by worker lite, then run on FULL-2/FULL-3 and S300-4/S300-5 within hours [journal Wed 13:45, 14:35, 14:45, 15:05].
- **Components were not fresh on every set.** m2's rule was chosen on S300-1 [q.md §3; m.md]; d6 and d8 were developed on development sets, and worker d had already run d8 on S300-4 + S300-5 (+0.5 [−0.7, 1.6] vs x1) [journal Wed 04:10].
- **Energy for FULL-2.** The CPU sampler was not running for FULL-2's gates, x1, q1 and q2 arms; their CPU figures are imputed from FULL-3's rates [e2.md §4].
- **Addendum 3's deviations carry over** [`PREREG-EXPLORE.md`, deviation log, Wed 16:40 ET]: (1) num_predict is 160, the main run's recorded value (addendum 3's text said 320 in error); this addendum registers 160 for every arm; (2) the comparators' tier-A verdicts are not on this machine, so the unchanged e2b and 31b P-B answers are graded here by the same tier-A procedure (`explore2/confirm-comp.js`), and those verdicts serve addendum 3 and this addendum alike; (3) the CPU sampler ran alongside gates' TEST run.
- **gates' TEST answers and tier-A verdicts existed before this addendum was committed** (run Wed 16:13–16:24 ET, graded right after [journal, TEST runs]). This text was written while gates' TEST analysis was still waiting for the comparator grading [journal, TEST runs]; nothing in it depends on gates' TEST result, and the commit times of this file and of gates' analysis are on record in git.
- **The TEST runner.** `explore2/confirm2.js` (p2, extended by p3) reuses `explore/confirm.js` (item list, explore/ code hash, scoreWith) and `explore/run.js` (preflight, store) by import and mirrors `run2.js`'s ctx. On `run <arm>` it refuses, before reading any TEST data, unless this file is committed and unmodified, lists the arm with its verdict key prefix, and has a code hash equal to the current one; every file of the import closure and everything under `explore2/` is tracked and clean; and `explore/` still has addendum 3's hash. After reading the TEST item list it refuses unless every arm listed before the requested one has all 600 questions done. After the freeze nothing may be added under `benchmarks/premise2/explore2/` until the runs, grading and analysis are complete; a re-freeze needs an entry in the deviation log.

## 9. Order

1. Addendum 3's gates confirmation (done) and the comparators' tier-A grading (`node benchmarks/premise2/explore2/confirm-comp.js grade`).
2. Freeze and register: commit `explore2/`, fill `Code hash:` with `confirm2.js hash`, move this file to `benchmarks/premise2/PREREG-EXPLORE2.md`, commit it; `confirm2.js check <arm>` must print `"ok": true` for each arm.
3. Runs, in this order, each with no other GPU or CPU job on the machine (LibreHardwareMonitor running as admin on port 8085):
   1. `node benchmarks/premise2/explore2/confirm2.js run q-det-q1 600`
   2. `node benchmarks/premise2/explore2/confirm2.js run lite-det-ub 600`
   3. `node benchmarks/premise2/explore2/confirm2.js run i-det-x1 600`
4. Grade: `confirm2.js grade q-det-q1`, then `grade lite-det-ub`, then `grade i-det-x1` (tier A, §5).
5. Analyze: `confirm2.js analyze` → `benchmarks/results/premise2/explore2/confirm2.{json,md}`.
6. Report whatever it shows.

## Deviation log
