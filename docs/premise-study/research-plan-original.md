> The original research plan, written 1 September 2026, kept verbatim for the record. Parts are superseded (see project-history.md): generation, grading, energy and the harness were built as `benchmarks/premise2/` rather than the paths named here, the question counts and margins changed (±5 non-inferiority, no human audit), and the schedule slipped to a V1 pilot on 19–20 September and the V2 run on 22–23 September.

# Research Plan — "Does Retrieval Engineering Offset Model Scale?"

Work-list to take the current `cortex-memory` codebase to everything the abstract promises.

**Claim we must be able to defend:** on EnronQA, a *small* generator with better email representation + better retrieval matches a *large* generator baseline on answer correctness, at lower energy and comparable latency — and we can say exactly where that crossover point is.

**The experiment grid (the whole paper in one line):**

`2 representations × 3 retrieval methods × 2 generator sizes = 12 cells`, plus 2 control cells (no-retrieval floor, oracle-retrieval ceiling) = **14 runs**, each reporting 4 outcomes: retrieval recall, answer correctness, energy, end-to-end time.

**Deadline: Monday 5 October 2026.** 35 calendar days from 1 September. Everything below is dated to fit.

---

## Schedule at a glance

| Week | Dates | Focus | Ends with |
|---|---|---|---|
| 1 | Tue 1 – Mon 7 Sep | Spec freeze, data rebuild, representations | Eval set frozen, both indexes built |
| 2 | Tue 8 – Mon 14 Sep | Retrieval parity + generation stage | Pipeline code freeze (Sat 12 Sep) |
| 3 | Tue 15 – Mon 21 Sep | Instrumentation, pilot, judge validation | Pilot green, judge κ reported |
| 4 | Tue 22 – Mon 28 Sep | Full grid run + analysis | Data freeze (Fri 25 Sep), crossover answered |
| 5 | Tue 29 Sep – Mon 5 Oct | Figures, paper, packaging | **Submitted Mon 5 Oct** |

### Hard gates — miss one, cut scope the same day

| Date | Gate | If missed |
|---|---|---|
| Wed 2 Sep | Spec frozen, 5 open decisions answered | Nothing else starts — resolve first |
| Tue 8 Sep | 31b generator confirmed running on the real hardware | Swap the "large" model today, state it in the paper |
| Sat 12 Sep | Pipeline code freeze — no new features after this | Ship what runs, park the rest as future work |
| Fri 18 Sep | Pilot N=50 passes all 14 cells end to end | Cut N to 300, drop error taxonomy |
| Fri 25 Sep 18:00 | **Data freeze** — no runs after this point | Whatever exists is the paper |
| Thu 1 Oct | Figures + tables final | Write around the figures you have |

### Pre-decided scope cuts (apply in this order, no debate mid-run)

1. N per cell: 500 → 300 → 200.
2. Energy repeats: 3 → 2, and only on a 100-question subset (see Stage 6).
3. Error taxonomy: 100 failures → 50.
4. Extra model families: already future work — never add them.
5. Reranker appendix: drop entirely.

**Never cut:** the two control cells, the paired eval set, judge validation, confidence intervals. Those are what make the claim defensible.

---

## Where the project stands today

| Piece | Status |
|---|---|
| EnronQA ingest (`benchmarks/imports/importEnronQA.js`) | Partial — test split, **first question per email only**, 49,983 cases |
| BM25 lexical retrieval (`src/bm25.js`) | Working |
| Dense retrieval (nomic-embed-text, pgvector) | Working |
| Hybrid fusion (`fuseResults`) | Working, tuning + method not yet documented |
| Retrieval recall harness (`benchmarks/retrievalBenchmark.js`) | Working — recall@k, MRR, latency percentiles |
| Reranker experiments | Exists, **not part of the abstract** — park it |
| Representation ablation (original vs preprocessed) | Fields exist (`content`, `processingContent`, two embedding columns) — **not run as a controlled factor** |
| Generation stage (answer the question) | **Missing entirely** |
| Answer-correctness grading | **Missing** |
| Energy measurement | **Missing** |
| End-to-end timing | **Missing** (only retrieval latency exists) |
| Reproducible one-command harness | **Missing** |
| Paper artifacts (tables, figures, text) | **Missing** |

Bottom line: retrieval half is roughly done, generation + measurement + analysis half is not started.

---

## Stage 0 — Lock the experiment spec — **Tue 1 – Wed 2 Sep**

Goal: freeze the design so results can't drift mid-study. Two days, no code.

- Tue 1: answer the 5 open decisions at the bottom of this file; draft the spec.
- Wed 2: spec frozen and committed. **Gate.**

- [ ] Write `docs/EXPERIMENT_SPEC.md` — the frozen definition of all 14 cells.
- [ ] Define **representation A = original**: raw email text exactly as EnronQA ships it.
- [ ] Define **representation B = preprocessed**: pin the exact transform (header stripping, quoted-reply removal, signature/disclaimer removal, whitespace normalisation, thread dedup). One function, one version number.
- [ ] Define retrieval configs: BM25 (k1, b values), dense (model + top-k), hybrid (fusion method + weights — write down whether it's RRF or score normalisation, and how weights were chosen).
- [ ] Fix generator settings: temperature 0, max tokens, identical prompt template for both model sizes, identical context budget (top-k documents, truncation rule).
- [ ] Fix the evaluation question set: how many questions per cell (recommend 1,000), which split, which seed. **Same questions in every cell** — paired comparison, no re-sampling.
- [ ] Decide primary outcome and equivalence margin, e.g. "small+hybrid is *equivalent* to large baseline if correctness is within ±2 points". Without this, "closes the gap" isn't testable.
- [ ] Record hardware + software: machine, GPU/CPU, RAM, OS, Ollama version, model digests, Postgres/pgvector version.

**Done when:** someone else could rebuild the whole table from this spec without asking a question.

---

## Stage 1 — Data: make the corpus match the abstract — **Wed 2 – Mon 7 Sep**

The abstract says 103,638 emails / 528,304 QA pairs. The repo currently has a subset with one question per email.

- Wed 2 – Thu 3: rewrite the importer (all QA pairs, gold answers stored).
- Thu 3 – Sat 5: full ingest running in the background (start it early, it is hours of embedding — disable LLM processing during ingest).
- Sun 6 – Mon 7: eval set frozen, leakage checks, corpus statistics.

- [ ] Ingest the **full** EnronQA corpus (all splits used for retrieval targets) — or, if you deliberately sample, change the abstract to state the sample size and how it was drawn.
- [ ] Import **all** QA pairs per email, not just `questions[0]`.
- [ ] Store **gold answers** alongside questions — currently only `relevantIds` are kept, so correctness cannot be graded yet. This is a blocking gap.
- [ ] Build the evaluation set: a fixed, seeded sample of N questions held constant across all cells; store as `benchmarks/evalSet.json` with the dataset revision hash.
- [ ] Sanity-check for leakage/duplicates (near-identical emails, questions answerable from the question text alone).
- [ ] Record corpus statistics for the paper: email count, QA count, token-length distribution, thread depth.

**Done when:** `evalSet.json` exists, has gold answers, and is version-pinned to a dataset revision.

---

## Stage 2 — Representation as a real experimental factor — **Fri 4 – Mon 7 Sep** (overlaps Stage 1)

Write the module while the ingest runs; build both indexes as soon as the corpus lands.

- [ ] Extract the preprocessing into one versioned module (`src/process/represent.js`) with `representOriginal()` and `representPreprocessed()`.
- [ ] Build **both** BM25 indexes (original / preprocessed) — currently one index.
- [ ] Build **both** dense embedding sets. `contentEmbedding` and `summaryEmbedding` are close but not the same thing as the two representations — decide and make it explicit.
- [ ] Log per-representation cost: preprocessing time, token reduction %, index size. (These belong in the paper — preprocessing is not free.)
- [ ] Regression check: preprocessing must not delete answer-bearing text. Spot-check 100 emails.

**Done when:** any of the 3 retrieval methods can be run against either representation with a single flag.

---

## Stage 3 — Retrieval parity pass — **Tue 8 – Thu 10 Sep**

Cheap and fast — no generation involved. Run it while Stage 4 is being built.

Existing results are not comparable — 10,000 queries for dense, 100 for BM25 and hybrid.

- [ ] Re-run all retrieval methods on the **same** eval set, same seed, same top-k.
- [ ] Document the hybrid fusion method and how its weights were selected (tune on a dev split, never on the eval set).
- [ ] Report recall@{1,5,10,20} + MRR per cell with 95% bootstrap confidence intervals.
- [ ] Keep the reranker work out of the main table — mention as future work or a clearly-labelled appendix.

**Done when:** one table with 6 retrieval rows (2 representations × 3 methods) on identical queries.

---

## Stage 4 — Generation stage (the biggest missing piece) — **Tue 8 – Sat 12 Sep**

Longest build on the critical path. First task on Tue 8 is the hardware check below — it is a gate.

- Tue 8: confirm the 31b model loads and answers on the real machine. **Gate — decide the fallback today if it does not.**
- Wed 9 – Thu 10: adapter interface, prompt template, context assembly.
- Fri 11: control cells (no-retrieval, oracle).
- Sat 12: **pipeline code freeze.** No new features after today.

- [ ] Add `src/generate/answer.js`: takes question + retrieved documents → answer string.
- [ ] Model-agnostic adapter interface so other families can be added later (the abstract promises this).
- [ ] Wire both generator sizes (Gemma 4 e2b, Gemma 4 31b) behind config, temperature 0, fixed seed where supported.
- [ ] One prompt template, identical for both sizes. Any prompt tuning happens on a dev split only.
- [ ] Context assembly rule: top-k docs, fixed token budget, deterministic ordering, documented truncation.
- [ ] Control cells: **no-retrieval** (question only → floor) and **oracle retrieval** (gold email injected → ceiling). These two are what let you say "this was a retrieval failure, not a reasoning failure".
- [ ] Confirm the 31b model actually runs on the available hardware; if not, decide now (smaller "large" model, or cloud, and state it).

**Done when:** `answer(question, config)` returns an answer for every cell, deterministically.

---

## Stage 5 — Answer correctness grading — **Sun 13 – Mon 14 Sep** (harness), **Sat 19 – Mon 21 Sep** (validation)

Build the grader before the pilot; validate the judge against human labels while the pipeline settles.

- Sun 13 – Mon 14: judge model, rubric, blind shuffled grading, per-question verdict storage.
- Sat 19 – Mon 21: 150 human-labelled answers, report Cohen's κ. Budget ~3 hours of your own labelling.

- [ ] Pick the grader: LLM-judge (fixed judge model, temperature 0, fixed rubric) is the practical choice for free-form answers; token-F1/EM as a cheap secondary metric.
- [ ] Judge must never be one of the models under test, and must not see which config produced the answer (blind, shuffled).
- [ ] **Validate the judge**: 200 human-labelled answers, report agreement (Cohen's κ). Without this the correctness numbers are unsupported.
- [ ] Store per-question verdicts, not just aggregates — needed for the paired statistics in Stage 8.

**Done when:** correctness is reproducible from stored answers with one command, and judge agreement is reported.

---

## Stage 6 — Energy + end-to-end time instrumentation — **Tue 15 – Wed 16 Sep**

Two days. Pick the meter on day one, validate against idle draw on day two — do not discover a broken meter during the grid run.

- [ ] Pick the measurement method for the hardware: `powermetrics` (macOS), RAPL/`powercap` (Intel Linux), `nvidia-smi --query-gpu=power.draw` (NVIDIA), or an external wall meter (most defensible).
- [ ] Measure **joules per answered question**, sampled across the whole request window (retrieval + generation), with **idle baseline subtracted**.
- [ ] Split energy by phase: embedding/indexing (amortised), retrieval, generation. Preprocessing and indexing are one-off costs — report them separately, don't hide them.
- [ ] End-to-end wall time per question: p50 / p95, cold vs warm, model already loaded vs not (state which is reported).
- [ ] Control confounds: fixed thermal conditions, randomised or interleaved cell order, discard first warm-up run, no other load on the machine.
- [ ] **Repeat only what needs repeating:** correctness runs once at full N; energy and latency run 3× on a fixed 100-question subset per cell. Repeating all 14 cells at full N three times does not fit before 5 October.
- [ ] Sanity-check energy numbers against a known reference (e.g. idle draw vs. spec).

**Done when:** every run emits `{recall, correctness, joules, latency}` with variance across repeats.

---

## Stage 7 — Run the grid — **Thu 17 Sep (harness) → Fri 18 Sep (pilot) → Tue 22 – Fri 25 Sep (full run)**

- Thu 17: single entry point, manifests, resumability.
- Fri 18: pilot at N=50 across all 14 cells. **Gate — pipeline must survive end to end.**
- Sat 19 – Mon 21: fix whatever the pilot broke (this buffer exists because pilots always break something); judge validation runs in parallel.
- Tue 22 – Fri 25: full grid, machine running continuously. **Data freeze Fri 25 at 18:00.**

Compute budget to check on Thu 17, before committing: 14 cells × N answers, plus the energy subsets, plus judging. The 31b cells dominate — if the estimate exceeds ~3.5 days of wall clock, cut N *now*, not on Wednesday.

- [ ] Single entry point: `npm run experiment -- --config configs/cell-XX.json`.
- [ ] Every run writes a manifest: config, seeds, model digests, dataset hash, hardware, git commit, timestamps.
- [ ] Estimate the compute budget before launching (14 cells × N questions × generation time) and confirm it fits the calendar.
- [ ] Pilot at N=50 first, verify the whole pipeline end to end, then run full N.
- [ ] Runs must be resumable and idempotent — a crash at question 900 shouldn't cost the run.

**Done when:** `benchmarks/results/` holds 14 complete, manifest-tagged result files.

---

## Stage 8 — Analysis: answer the actual question — **Sat 26 – Mon 28 Sep**

- Sat 26: CIs, McNemar, TOST, crossover.
- Sun 27: cost per *correct* answer, decomposition against the control cells.
- Mon 28: error taxonomy (100 failures, or 50 if behind).

- [ ] Paired analysis across cells (same questions everywhere): McNemar / paired bootstrap on correctness.
- [ ] 95% bootstrap CIs on every headline number. No bare point estimates in the paper.
- [ ] **Equivalence test (TOST)** against the pre-registered margin from Stage 0 — this is what turns "closes the gap" into a defensible claim.
- [ ] Crossover analysis: at what retrieval quality does small-model correctness meet the large-model baseline?
- [ ] Decomposition: retrieval recall vs correctness, using the oracle and no-retrieval controls, to separate evidence-selection failures from reasoning failures.
- [ ] Cost analysis: joules and seconds per correct answer (not per query) — the more honest denominator.
- [ ] Error taxonomy: hand-code ~100 failures into categories (not retrieved / retrieved but ignored / misread / gold answer wrong).

**Done when:** you can state the crossover point in one sentence with a confidence interval attached.

---

## Stage 9 — Reproducibility packaging — **Thu 1 – Sat 3 Oct** (runs alongside the writing)

Pinning and the clean-machine test are mechanical work — do them in the gaps between writing sessions, not instead of them.

- [ ] Pin everything: model digests, Ollama version, dataset revision, npm lockfile, Postgres image tag.
- [ ] Ship index/DB build scripts (or a snapshot) so results can be rebuilt from scratch.
- [ ] `docs/REPRODUCE.md`: clone → up → ingest → index → run → table, verified on a clean machine.
- [ ] Publish the results JSONs and the analysis notebook/scripts that generate every figure from them.
- [ ] Licence + citation file; artifact release tagged to the paper version.

**Done when:** a stranger reproduces the headline table on their own hardware.

---

## Stage 10 — Paper — **Tue 29 Sep – Mon 5 Oct**

- Tue 29 – Wed 30: all figures and tables generated from the results files.
- Thu 1: figures frozen. **Gate.**
- Thu 1 – Sat 3: full draft — method and results first, intro and related work last.
- Sun 4: internal review pass, abstract aligned to what was actually run.
- Mon 5: format, final read, **submit.**

- [ ] Figures: (1) recall by representation × method; (2) correctness by generator size × config; (3) **Pareto: correctness vs joules per correct answer**, marker size = latency — this is the money figure; (4) crossover plot.
- [ ] Tables: main 14-cell results; corpus statistics; hardware; preprocessing/indexing one-off costs.
- [ ] Sections: intro, related work (RAG vs scale, energy-aware NLP, enterprise-email QA), method, results, analysis, limitations, conclusion.
- [ ] Limitations to state honestly: single dataset, single embedding model, English-only, judge-based grading, hardware-specific energy, Enron corpus age and its skew.
- [ ] Ethics/privacy note — the Enron corpus is real people's mail; the on-device privacy motivation deserves a paragraph.
- [ ] Align the abstract with what was actually run (corpus size, model families, "plans to extend").
- [ ] Internal review pass, then venue formatting and submission.

**Done when:** submitted.

---

## Decisions needed from you — **answer by Wed 2 Sep, they block everything**

1. **Corpus scope** — ingest the full 103,638 emails / 528,304 QA pairs, or run on a documented sample and amend the abstract?
2. **Hardware** — what machine runs the 31b generator, and what energy measurement is available on it (RAPL / nvidia-smi / powermetrics / wall meter)?
3. **Equivalence margin** — how many points of correctness counts as "matching" the large baseline?
4. **Grading** — LLM-judge (needs a judge model + human validation set) or stricter string-based metrics?
5. **Venue** — submission target for 5 October; sets page limit and formatting, which affects how much fits in Stage 10.

Recommended defaults if you don't want to decide: N=500 questions per cell, LLM-judge with 150 human-validated labels, ±2 point equivalence margin, full corpus ingest. These fit the calendar below.

## Biggest risks

- **No gold answers stored today** — Stage 1 blocks Stages 5, 7, 8. Fix first.
- **Energy measurement is the least standard part** — pick the method early and validate it, or the headline claim is soft.
- **Unmatched query counts** in existing results — do not reuse those numbers in the paper.
- **31b on "everyday devices"** — the abstract's on-device framing is about the *small* configuration; make sure the text doesn't imply the 31b baseline is the deployable one.

## Day-by-day calendar

| Date | Day | Work |
|---|---|---|
| 1 Sep | Tue | Answer the 5 decisions; draft spec |
| 2 Sep | Wed | **Spec frozen (gate)**; start importer rewrite |
| 3 Sep | Thu | Importer done (gold answers + all QA pairs); launch full ingest |
| 4 Sep | Fri | Ingest running; write representation module |
| 5 Sep | Sat | Ingest finishes; build both BM25 indexes |
| 6 Sep | Sun | Build both embedding sets; preprocessing spot-check |
| 7 Sep | Mon | Freeze eval set; corpus statistics; leakage check |
| 8 Sep | Tue | **31b hardware check (gate)**; start retrieval parity runs |
| 9 Sep | Wed | Retrieval runs; generation adapter + prompt template |
| 10 Sep | Thu | Retrieval table done; context assembly |
| 11 Sep | Fri | Control cells (no-retrieval, oracle) |
| 12 Sep | Sat | **Pipeline code freeze (gate)** |
| 13 Sep | Sun | Grading harness, judge rubric |
| 14 Sep | Mon | Blind grading, per-question verdict storage |
| 15 Sep | Tue | Energy meter chosen and wired |
| 16 Sep | Wed | Meter validated against idle baseline; e2e timing |
| 17 Sep | Thu | Run harness, manifests, resumability; **compute-budget check** |
| 18 Sep | Fri | **Pilot N=50, all 14 cells (gate)** |
| 19–20 Sep | Sat–Sun | Fix pilot fallout; human-label 150 answers |
| 21 Sep | Mon | Judge κ reported; final dry run |
| 22–25 Sep | Tue–Fri | **Full grid run**, machine continuous; **data freeze Fri 18:00** |
| 26 Sep | Sat | CIs, McNemar, TOST, crossover |
| 27 Sep | Sun | Cost per correct answer; control-cell decomposition |
| 28 Sep | Mon | Error taxonomy |
| 29–30 Sep | Tue–Wed | Figures and tables |
| 1 Oct | Thu | **Figures frozen (gate)**; start draft; begin pinning |
| 2 Oct | Fri | Draft: method + results |
| 3 Oct | Sat | Draft complete; clean-machine reproduction test |
| 4 Oct | Sun | Internal review; align abstract to what ran |
| 5 Oct | Mon | Format, final read, **submit** |

Slack in this plan: roughly 3 days, all of it sitting on 19–21 September. Spend it on pilot fallout, nothing else.
