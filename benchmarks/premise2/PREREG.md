# premise2 pre-registration

Study: *Does Retrieval Engineering Offset Model Scale? A Controlled Study on Email Question Answering.*
V2 of the premise benchmark (V1 = `benchmarks/premiseBenchmark.js`, reported as the pilot).

This file is committed before the Windows generation run starts. Its sha256 is part of the run fingerprint (`run-state.json`), so the run refuses to resume if this file changes. Any change after the run starts is a **deviation**: it goes in the deviation log at the end of this file, with a date and a reason, and the report prints the log.

## 1. Data

- EnronQA questions: `MichaelR207/enron_qa_0922`, revision `c0b3a91`, `test` and `dev` parquet splits. Corpus: `MichaelR207/enron_corpus_0922`, revision `4f07113` (103,638 emails). The file sha256 values are pinned in `dataset.js` (`HF_FILES`) and checked by `npm run premise2 -- verify-data`.
- The dev and test splits share all 73,772 emails (only the questions differ), so tuning and evaluation are separated **by mailbox**: 30 tuning mailboxes (6 per inbox-size quintile, seed 20260922) and 120 evaluation mailboxes.
- Retrieval index: every corpus email except 270 over 40,000 characters (disclosed). Index text is always the original email (R0), so the representation factor isolates *reading*.
- **DEV**: 400 dev-split questions from tuning mailboxes, one per email.
- **TEST**: test-split questions from evaluation mailboxes, one per email, at most 8 per mailbox, ordered round-robin by mailbox within inbox-size strata, so every prefix is balanced. Up to 960 questions. Every contrast uses its common paired prefix.
- **Retrieval-only**: 2,000 test-split questions from evaluation mailboxes, disjoint from TEST emails and their twins (no per-mailbox cap). Cross-encoder reranking is computed for DEV, TEST and the first 500 of these.
- **Exclusions**, identical for every model and counted per rule in `manifest-prepare.json`:
  - unanswerable gold (regex `UNANSWERABLE_GOLD`)
  - gold email missing from the corpus index
  - V1's 100 pilot emails, and their twins or near-duplicates
  - TEST questions whose gold has a twin or near-duplicate in a tuning mailbox
  - more than one question per twin group
  - questions whose P-B context or any E*-candidate context exceeds the **15,500-token cap** (conservative bound: chars/2.2 + 64)
- **Twins**: a candidate email is a twin of the gold when it contains at least 80% of the gold's word 8-grams, or its normalised body is identical. A near-duplicate has at least 50% containment in either direction.
- **Pre-registered strata**:
  - threaded vs single-message file
  - answer in an embedded vs the top message (`answerLocation`)
  - question type (who / when / url-contact / number / other)

## 2. Factors

- **Representation** (reader text; the retention audit shows 0 losses for R0/R1/R2 over all 89,316 questions):
  - R0: the original email.
  - R1: safe-clean (quoted-printable decoded, whitespace collapsed, `>` stripped, `File:` line dropped; URLs, `Sent:`, `Cc:` and recipients are kept).
  - R2: message-segmented with attribution lines, e.g. `[Message 2 of 3 | From: … | Sent: … (ISO date) | To: … | Subject: …]`, with additive readable names and ISO dates; body lines are untouched.
  - Controls: RL (newest message only, lossy) and RV1 (V1 preprocessing, lossy).
- **Retrieval**:
  - BM25 (SQLite FTS5, `bm25(0,0,1,1,1,1)`).
  - Dense: `nomic-embed-text`, 2048-token truncation, `search_document:` / `search_query:` prefixes, exact cosine.
  - RRF-60 over the BM25 and dense top-100.
  - The MiniLM cross-encoder rerank (`Xenova/ms-marco-MiniLM-L-6-v2`) of the union of the BM25, dense and RRF top-20.
  - The adaptive gate (cut at the largest score gap within the reranked top 5).
  - V1's tuned hybrid weights are exploratory only.
- **Generator size** (Gemma QAT ladder, `num_ctx` 16384 for all):

| alias | tag | non-embedding params | role |
|---|---|---|---|
| tiny | `gemma3:1b-it-qat` | 0.70B | distraction amplifier; excluded from the scale-curve fit (Gemma 3) |
| small | `gemma4:e2b-it-qat` | 1.87B | primary small |
| mid | `gemma4:e4b-it-qat` | 3.94B | scale midpoint |
| large | `gemma4:31b-it-qat` | 29.29B | large baseline |
| bridge | `gemma4:e2b` (Q4_K_M) | 1.87B | V1 replay only |

- **Runtime** (every call):
  - temperature 0, top_p 1, seed 42, neutral penalties, `think:false`, `truncate:false`, `num_ctx` 16384, `num_batch` 512.
  - `num_predict` 320, unless the probe (below) sets 160 for all models.
  - Server: `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`.

## 3. Contexts and prompts

All contexts and prompts are built once, on the Mac, before any generation. Prompts are content-addressed (`prompts.jsonl`) and shared byte-for-byte by every model.

- **Contexts**:
  - oracle: [gold].
  - floor: no emails (n = 100; a memorisation check).
  - dist4/dist9 hard ("answer-free lexical distractors"): BM25 global top-100, excluding the gold, twins, near-duplicates, answer-bearing emails and the same normalised thread subject. dist4 is a subset of dist9.
  - dist4 random: seeded random corpus emails, with the same exclusions.
  - Gold position is balanced first/middle/last by (pool index + density offset) mod 3.
- **Retrieval contexts**: the top-k of a stored list; k ∈ {1, 3, 5, 10, gate}; order is rank, or best-last (the list reversed, so the top hit sits next to the question).
- **Templates**:
  - T2, primary for every cell: "Answer every part of the question in one or two sentences…", with exact abstention text `NOT IN EMAILS`.
  - T1: V1's template verbatim (format cell and bridge).
  - The null variant: T2 with an answer-neutral change to the delimiter and labels; it gives the flip noise floor.
- **Gold-informed sentence selection** (FILCO-style, not deployable; a diagnostic).

## 4. Pre-registered selections (automatic, no human decision)

- **R\*** (made on the Mac before any generation): the method with the highest DEV answer-bearing recall@5 among {bm25, dense, rrf60, bm25+rr, rrf60+rr}. Ties go to the earlier method in that order.
- **DEV grid** (e2b only), at R\*:
  - k ∈ {3, 5, gate} × order {rank, best-last} × representation {R0, R2}.
  - Plus k=1 rank R0, plus the baseline B.
- **E\***: the DEV config with the highest **J1-only** accuracy on e2b.
  - Configs within 2 points of the best are tied. The tie goes to the config with the fewest components differing from B (method, k, order, representation), then to the earlier config in grid order.
  - Selection requires at least 95% of every candidate's DEV answers to be graded. Technical failures (after 3 attempts) and exact abstentions count as graded INCORRECT. An answer text judged once counts for every config that produced it.
  - E\* never uses output-format levers.
- **Probe decisions** (stage 0, frozen in `run-state.json`):
  - If the 31b's mean output tokens under T2 on 30 oracle DEV prompts exceed 1.3 × V1's 18.7, `num_predict` is 160 for every model; otherwise it stays 320.
  - If the tiny model's J1 oracle accuracy on 50 DEV questions is below 0.5 (with at least 30 graded), it is dropped from the run.
  - Judge concurrency is 3 if 3-way calls are at least 1.3× faster than 1-way with no errors; otherwise 1.
  - A deliberately oversize prompt must return `context_overflow`. If it does not, the report flags that `truncate:false` may be ignored.

## 5. Queue (one continuous run against a stop time `POC2_STOP_AT`)

- **Stage 0**: probe.
- **Stage 1**: DEV grid on e2b.
- **Stage 2**: J1 grades DEV in parallel (cloud calls). Meanwhile, generation runs P-oracle, P-B, S-floor and S-dist4hard on tiny, small and mid; the bridge replay; the e2b secondaries (dist9 hard, dist4 random, T1 format, the two null-perturbation cells, oracle-R2); and S-R2-B on mid.
- **Stage 3**: select E\*, then P-E\* on tiny, small and mid, then gold-informed selection on e2b (first 300).
- **Deferral rule** (only P-E\* depends on DEV grading, and the GPU never waits for it while E\*-independent work remains):
  - If E\* is not yet selected at stage 3, stage 6 runs first.
  - If E\* is still missing at stage 4, the 31b runs S-floor and the P-oracle/P-B blocks. P-E\* blocks join as soon as E\* exists and catch up to the other primaries' prefix.
  - The small-model P-E\* runs right after the 31b interleave.
- **Stage 4**: the 31b.
  1. S-floor (100).
  2. Then P-oracle (to 400), P-B (to 600) and P-E\* (to 600), interleaved in blocks of 50, so any stop leaves equal paired prefixes.
- **Stage 5**: the 31b secondaries in this order, each admitted only if its projected finish (pending items × the mean time per item so far, plus a reserve for any P-E\* work still pending) is before the stop time. Each admit/skip decision is recorded in `run-state.json` and never revisited after a restart:
  1. S-dist4hard 300
  2. S-oracle-R2 300
  3. P-oracle 400→600
  4. S-dist4rand 300
- **Stage 6**: the e2b abstract grid {R0, R1, R2} × {bm25, dense, rrf60} at k=5 (n = 600), and the e2b exploratory cells (n = 300).
- **E\* never selected**: if E\* is still missing after all E\*-independent work, the run waits for DEV grading until the stop time. It then stops with reason `no-estar`, and a later session resumes it.
- **Resuming**: whatever the stop time cuts resumes in a later session with the same command. Resuming never regenerates a finished answer (answers are keyed by model digest, options hash and prompt sha).

## 6. Grading

- **Deterministic first**:
  - A technical failure (any status other than ok/output_limit) is INCORRECT.
  - An exact `NOT IN EMAILS` is ABSTAIN, counted as INCORRECT.
  - Failures after 3 attempts count as INCORRECT (ITT), identically for every model in a contrast.
  - **Context overflow** (`context_overflow`, returned because `truncate:false`) is different: the shared prompt does not fit the 16,384-token window for any model. Such a question is excluded from every contrast using that cell, never retried, and counted in the report. This can only happen in cells outside the token cap: dist9, k=10, dense/RRF grid, rephrased queries, random distractors.
- **Judges**, pinned:
  - J1 `gpt-oss:20b-cloud` (think "low").
  - J2 `nemotron-3-nano:30b-cloud`.
  - Adjudicator: the first model of the chain `deepseek-v4-flash:cloud` → `mistral-large-3:675b-cloud` → `nemotron-3-super:cloud` that answers when adjudication starts. It is used for the whole pass. The first two are third-family models but are not on Ollama's free tier. `nemotron-3-super` is free (about 2 s per call; `nemotron-3-ultra` took 10 s) but shares J2's family, and the report flags it. `gpt-oss` is deliberately excluded: V1 showed its false negatives on verbose large-model answers, the error adjudication exists to catch. If no adjudicator is reachable, adjudication is skipped and the report falls back to the J1/J2 consensus, flagged.
  - A provider or model switch creates new verdict keys, so the affected contrast is re-judged in full, never mixed.
- **Tier A** (primaries, secondaries, diagnostic, bridge, DEV B and the DEV top-3): J1 + J2 + adjudication.
- **Tier B** (grid, exploratory, the rest of DEV): J1, plus J2 on a seeded 20% sample for agreement.
- **Adjudication** (tier A), blind to the J1/J2 verdicts. It covers:
  - (a) J1 ≠ J2,
  - (b) consensus-INCORRECT non-abstains,
  - (c) a seeded 10% of consensus-CORRECT answers.

  The adjudicator sees the emails the answerer saw (R0 text) and the references. A CORRECT verdict needs at least one quote that verifies verbatim (after normalisation) against the gold, one of its twins, or an answer-bearing email. **Quotes found only in distractors never verify.** An unverified CORRECT becomes INCORRECT. A suspected reference error is flagged, never silently upgraded.
- **Final score per answer**:
  - Adjudicated (primary): the adjudicator's verdict where it ran, otherwise the J1 = J2 consensus.
  - Also reported: J1-only, strict consensus (CORRECT only if J1 and J2 both say CORRECT), and the critical-span score (non-LLM, on questions whose gold has URLs, dates, numbers or contacts).
  - A confirmatory label is called **robust** only if it holds under adjudicated, strict consensus and span-match scoring.
- **Drift**: 200 tier-A answers are re-judged by J1 in every grading session (test-retest).
- **Agreement**: raw agreement, positive and negative agreement, Cohen's κ and PABAK, per tier.
- TEST is judged only after all generation ends, in a seeded random order across models and cells within priority groups (primaries, then the rest of tier A, then tier B). A pass cut short by usage limits therefore covers the confirmatory contrasts first. No Rogan-Gladen correction.

## 7. Hypotheses and decision rules

Estimator for every contrast: the mean per-question paired difference in accuracy (adjudicated score) over the common paired prefix, with a 95% percentile CI from a **mailbox-cluster bootstrap** (B = 10,000, seeded splitmix32). Bootstrap p-values:

- two-sided: 2·min(P\*(Δ ≤ 0), P\*(Δ ≥ 0))
- non-inferiority: 2·P\*(Δ ≤ −margin)

Both are floored at 1/B. The cluster-robust z-test is a cross-check only.

- **H1 (gate, full α = .05)**: Acc(31b, oracle) − Acc(e2b, oracle) ≠ 0 (two-sided). If H1 fails, H2 and H3 are reported as estimates without confirmatory labels.
- **If H1 passes, Holm (α = .05) over**:
  - **H2 (non-inferiority, margin 5 pts)**: Acc(e2b, E\*) − Acc(31b, B) > −0.05.
    - Also reported: the label at −2.5 pts, TOST ±5, and a conservative comparator (the 31b at max(B, E\*), chosen on TEST).
  - **H3 (difference in differences)**: per question, [e2b(E\*) − e2b(B)] − [31b(E\*) − 31b(B)] ≠ 0.
    - Labelled "the effect of a small-model-tuned pipeline transferred to the large model"; its MDE is stated in the report.
- **Primary estimand**: **gap closure** = [e2b(E\*) − e2b(B)] / [31b(B) − e2b(B)], with a cluster-bootstrap CI.
  - Reported beside it: each model's own-headroom closure, (E\* − B)/(oracle − B), and the engineering ladder B → R\* → E\* → gold-informed selection → oracle, per model.
- **Labels**: SUPERIOR / INFERIOR / NON-INFERIOR / EQUIVALENT / INCONCLUSIVE, always shown with the estimate, the CI and the margin. Never "no effect".
- **Secondary family (Holm, α = .05)**:
  1. The e2b vs 31b distraction interaction: [e2b(oracle) − e2b(dist4hard)] − [31b(oracle) − 31b(dist4hard)], as a risk difference. This test is dropped in advance if the 31b S-dist4hard cell was not admitted by the time rule.
  2. R2 − R0 at BM25 k=5 in the threaded stratum, for e2b (G-R2-bm25 vs G-R0-bm25).
  3. R2 − R0 at BM25 k=5 in the threaded stratum, for e4b (S-R2-B vs P-B).
  4. Answer-bearing recall@5: the best of {BM25, dense, RRF-60} vs the second best, on TEST + retrieval-only questions (retrieval only).
- **Exploratory**: everything else — tiny, per-user scope, rephrased questions, k, order, rerank, gate, RL, the V1 hybrid, capture vs dilution, gold-informed selection, the bridge. These get estimates with CIs, rescued/damaged counts net of the null-perturbation flip rate, and the conditional induced-error rate, but no confirmatory labels.
- **Cost (estimates, not hypotheses)**:
  - Warm time per answer (p50/p95, the ratio of totals, the geometric mean of paired ratios), labelled hardware-specific.
  - A hardware-independent FLOP proxy: 2 × non-embedding params × (prompt + output tokens) per correct answer.
  - Energy per correct answer (CPU package + GPU from LibreHardwareMonitor and nvidia-smi), labelled a lower bound.

## 8. Stop rule

The run stops at `POC2_STOP_AT`. Items are never started if their projected duration passes the stop time. Confirmatory contrasts use the common paired prefix of whatever finished. If the 31b P-B or P-E\* prefix is under 400 when the run stops, the report says so, and the contrast's MDE is recomputed for the achieved n.

## Deviation log

(none)
