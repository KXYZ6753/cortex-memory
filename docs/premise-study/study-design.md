# V2 study design (summary)

The binding definition is `benchmarks/premise2/PREREG.md`, which includes its deviation log. This page is the readable summary.

## Data

- **Source:** EnronQA from Hugging Face.
  - Questions: `MichaelR207/enron_qa_0922` at revision `c0b3a91`, test and dev parquet splits.
  - Corpus: `MichaelR207/enron_corpus_0922` at revision `4f07113`, 103,638 emails.
  - File sha256s are pinned in `dataset.js`, and `npm run premise2 -- verify-data` checks them.
- **Split by mailbox.** The splits share every email, so tuning and evaluation are separated by mailbox: 30 tuning mailboxes (6 per inbox-size quintile, seed 20260922) and 120 evaluation mailboxes.
- **Pools:**
  - DEV: 397 dev-split questions from the tuning mailboxes.
  - TEST: 955 test-split questions from the evaluation mailboxes, at most 8 per mailbox, ordered round-robin within size strata so any prefix is balanced.
  - Retrieval-only: 2,000 questions.
- **Exclusions:**

  | rule | count |
  |---|---|
  | unanswerable gold | 18 |
  | not in corpus | 1 |
  | V1 email | 40 |
  | V1 twin | 32 |
  | twin in a tuning mailbox | 92 |
  | duplicate twin group | 143 |
  | over the token cap (DEV / TEST) | 3 / 2 |

- **Twins.** A candidate is a twin when it contains at least 80% of the gold's word 8-grams, or its normalised body is identical. A near-duplicate has at least 50% containment in either direction.

## Factors

- **Generators** (Ollama, QAT). Parameter counts are non-embedding:

  | alias | model | params | note |
  |---|---|---|---|
  | tiny | `gemma3:1b-it-qat` | 0.70B | Gemma 3, excluded from the scale-curve fit |
  | small | `gemma4:e2b-it-qat` | 1.87B | |
  | mid | `gemma4:e4b-it-qat` | 3.94B | |
  | large | `gemma4:31b-it-qat` | 29.29B | |
  | bridge | `gemma4:e2b` (Q4_K_M) | 1.87B | V1 replay only |

- **Representation** of the reader text. The retention audit found 0 answer losses for R0, R1 and R2 across all 89,316 questions.
  - **R0:** the original email.
  - **R1:** safe-clean: quoted-printable decoded, whitespace collapsed, `>` stripped, `File:` dropped.
  - **R2:** message segmentation across 5 header patterns, with bracketed attribution lines such as `[Message 2 of 3 | From: … | Sent: … (ISO date) | …]`.
  - Controls: **RL**, the latest message only, and **RV1**, V1's lossy cleaning.

  Index text is always R0, so representation isolates *reading*.
- **Retrieval:**
  - BM25: SQLite FTS5, `bm25(0,0,1,1,1,1)`.
  - Dense: nomic-embed-text through Ollama, with `search_document:` / `search_query:` prefixes and exact cosine. The 103,368 × 768 vectors were built in about 2 h 10 min on the Mac.
  - RRF-60 over the BM25 and dense top-100.
  - A MiniLM cross-encoder rerank (`Xenova/ms-marco-MiniLM-L-6-v2`), with an adaptive k gate at the largest score gap within the top 5.
  - Scopes: global and per-mailbox. Fields: question and rephrased question.

## Contexts and prompts

All contexts and prompts are built once on the Mac: 35,321 unique prompts, content-addressed and byte-identical across models.

- **Contexts:**
  - oracle: the gold email only.
  - floor: no email.
  - dist4 / dist9 hard: answer-free BM25 neighbours, excluding twins, near-duplicates, answer-bearing emails and the same thread.
  - dist4 random.
  - retrieval contexts: k ∈ {1, 3, 5, 10, gate}, with ordering rank or best-last.
  - Gold position is balanced first/middle/last.
- **Templates:**
  - T2 (primary): answer every part in one or two sentences, copy names, dates, numbers and URLs exactly, or reply `NOT IN EMAILS`.
  - T1: V1's template.
  - A null variant (answer-neutral byte change) that measures the noise floor.
- **Token cap:** 15,500, by the conservative bound chars/2.2 + 64.

## Runtime (every call)

- temperature 0, top_p 1, seed 42, neutral penalties, `think:false`, `truncate:false`
- `num_ctx` 16384 and `num_batch` 512 for every model
- `num_predict` 160 (set by the probe)

## Queue (one supervised, resumable Windows run against a stop time)

1. Probe.
2. DEV grid on e2b, at R\* = BM25:
   - k ∈ {3, 5, gate} × order {rank, best-last} × representation {R0, R2}, plus k=1 and B.
3. Small-model primaries and secondaries, while J1 grades DEV in the cloud.
4. E\* selection, then P-E\*.
5. The 31b: floor, then P-oracle, P-B and P-E\* interleaved in blocks of 50.
6. The 31b's time-admitted secondaries.
7. e2b grid and exploratory cells.

## Grading

- Deterministic pre-grade: technical failures and exact abstentions are INCORRECT.
- **Tier A** (primaries, secondaries, diagnostics, bridge, DEV B and the DEV top-3): J1 + J2 + blind adjudication. Adjudication covers disagreements, consensus-INCORRECT answers and a seeded 10% of consensus-CORRECT answers.
- **Adjudicator quotes** must verify verbatim against the gold, a twin or an answer-bearing email, never a distractor. An unverified CORRECT becomes INCORRECT.
- **Tier B** (grid, exploratory): J1 alone, plus J2 on a 20% sample.
- **Scores reported:** adjudicated (primary), J1-only, strict consensus, and a critical-span anchor (non-LLM).

## Statistics

- **Estimator:** paired mean differences with a mailbox-cluster bootstrap (B = 10,000, seed 20260922).
- **Hypotheses:**
  - **H1** (gate): 31b vs e2b on oracle, two-sided.
  - If H1 passes, Holm over:
    - **H2:** e2b(E\*) vs 31b(B), non-inferiority at 5 pts.
    - **H3:** difference-in-differences of E\* − B between the models.
- **Primary estimand:** gap closure = [e2b(E\*) − e2b(B)] / [31b(B) − e2b(B)].
- **Secondary family (Holm):**
  - **S1:** distraction interaction.
  - **S2, S3:** R2 − R0 in threaded emails (e2b, e4b).
  - **S4:** answer-bearing R@5, the best method vs the second.
- **Labels:** SUPERIOR / INFERIOR / NON-INFERIOR / EQUIVALENT / INCONCLUSIVE.
