# premise2 pre-registration addendum 2: the index factor in the agent arm

An extension of the agent arm (PREREG-AGENT.md), which it leaves unchanged. This file is committed, with the DEV index choice filled in, before any episode of the extension runs. The text above the deviation log is hashed into the extension's own fingerprint (`agent/state.json`, `extFingerprint`). The original addendum's fingerprint is unchanged, so episodes run under it (Stage A below) keep their keys and count here.

## 1. Question

In the main study every model received the same query, so the effect of the index was the same for every model by construction, and the index text was always the original email (R0). Two things are untested:

1. **Preprocessing for search.** Does preprocessing the text that is *searched* (not the text that is read) help? The main study found no reading benefit from lossless preprocessing (S2, S3).
2. **Index × query author.** When a model writes its own queries, does the index it searches change what model-driven search achieves? Keyword indexes reward exact names and subjects; dense indexes reward paraphrase.

A further limitation motivates one more arm. EnronQA's questions were generated from the gold email and name its entities, so one BM25 search on the raw question already shows the gold in its top 10 for 566 of 600 questions. The rephrased questions (which cost the fixed pipeline 4 points) are the more realistic test of query skill.

## 2. Index variants and the DEV choice (retrieval only, before any extension episode)

Every variant uses the main index's FTS5 schema, `porter unicode61` tokenizer and query sanitiser; only the indexed text or column weights differ. The email returned and shown to the model is always R0. Code: `indexes.js` (`premise2-indexes-v1`).

| variant | what is indexed |
|---|---|
| `bm25` | the main study's index (R0; subject, sender, recipients, body weighted 1) |
| `bm25-fields` | the same index with subject ×3 and sender ×2 at query time |
| `bm25-r1` | the body as R1 safe-clean text (quoted-printable decoded, `>` quoting stripped, whitespace collapsed) |
| `bm25-msg` | one row per message of the R2 segmentation, each message's own header lines kept; an email ranks by its best message |
| `bm25-latest` | the newest message only (RL; lossy by design) |

**Selection rule.** `npm run premise2 -- index-eval` computes answer-bearing recall@5 of each variant on the DEV pool (397 questions from the 30 tuning mailboxes, questions field). The new index is the candidate among `bm25-fields`, `bm25-r1`, `bm25-msg`, `bm25-latest` with the highest DEV recall@5; a tie keeps the earlier candidate in that order. It is chosen whether or not it beats `bm25`. TEST and retrieval-only recall are reported for every variant, but never used for the choice. `index-eval.md` and `index-eval.json` are committed with this file.

**DEV choice: TO BE FILLED FROM index-eval BEFORE THE EXTENSION RUNS.**

## 3. Arms and queue

Questions, strata, design weights, protocol, runtime, grading and the stop rule are those of PREREG-AGENT.md. The only changes:

- **Search backend per arm.** `SEARCH` runs on the arm's index. The tool text is identical for every index ("searches all emails"). Dense: `search_query:` plus the query, embedded by Ollama's `nomic-embed-text` (the model that built `dense.f32`) on the CPU (`num_gpu: 0`), exact cosine over the 103,368 document vectors. RRF-60: BM25 top 100 and dense top 100, as in the main study.
- **Dense fidelity preflight.** Before the first dense episode, 20 DEV questions are embedded on the eval machine and their dense top 10 compared with the main study's frozen dense lists. The run refuses if the mean top-10 overlap is below 90%.
- **Rephrased arms** ask the EnronQA rephrased question instead of the question; a question without a rephrasing is skipped by those arms.
- **Round-cap arm** allows 2 SEARCH/OPEN rounds instead of 5 (the instructions state the budget).
- **Dropped:** the thinking arms of PREREG-AGENT.md (not run; time).

Run order (`cells.js` `agentQueue`; arm id = cell, then `-reph` or `-r2`, then `@index` for a non-BM25 index):

| tier | arms |
|---|---|
| must | e2b agent on `bm25`, the new index, `dense`, `rrf60`; 31b agent on `bm25` (first 200 questions); e2b raw-question-first on the four indexes |
| should | e2b rephrased on `bm25` and `dense`; e4b agent on the four indexes; 31b agent on the new index (first 200) |
| nice | 1b agent on `bm25`; e2b 2-round cap on `bm25`; e2b rewording control; 31b agent on `bm25` extended to 600 |

The 31b does not run dense or RRF (a second resident model would evict it on the 8 GB card). The first 200 questions hold all 51 BM25 misses (PREREG-AGENT.md §2), so the 31b's arms are design-weighted like every other.

**Stage A.** Before this extension was ready, the original addendum's queue ran under its own fingerprint: the determinism pilot, e2b agent on BM25 and the 31b agent on BM25, until a stop time. Those episodes have the same keys as the corresponding arms here and are not rerun.

## 4. Hypothesis (Family B, α = .05, one test)

- **B1** (does preprocessing the searched text help model-driven search): e2b(agent on the DEV-chosen new index) − e2b(agent on `bm25`), two-sided.

The estimator, CI, p-value and robustness rule are those of PREREG-AGENT.md §7 (design-weighted paired difference, mailbox-cluster bootstrap, B = 10,000, seed 20260922; robust only if the label holds under strict consensus and the span anchor).

Family A (A1–A3) is unchanged and remains its own Holm family.

## 5. Exploratory (estimates and CIs only)

- **Index effects for e2b and e4b:** agent on dense, RRF-60 and the new index, each minus agent on BM25.
- **Who writes the query, per index:** agent − raw-question-first, on each index; and the interaction [agent(dense) − rawfirst(dense)] − [agent(bm25) − rawfirst(bm25)].
- **Fixed pipeline vs agent, per index (e2b):** agent on an index minus the main study's fixed top-5 cell on the same index (G-R0-bm25, G-R0-dense, G-R0-rrf60; J1 basis, since those cells are tier B).
- **Scale × index:** [31b(new index) − 31b(bm25)] − [e2b(new index) − e2b(bm25)], on the rows the 31b completed.
- **Rephrased questions:** e2b agent on rephrased BM25 and dense, against the main study's fixed rephrased cell X-rephrased-bm25-k5 (J1 basis; the 300 questions the two share) and against the agent on the original questions.
- **Round budget:** e2b 2-round cap − e2b 5 rounds, on BM25.
- **Retrieval-only:** recall of every variant on DEV, TEST and the retrieval-only pool, questions and rephrased fields (`index-eval.md`).
- **Query style per model and index:** words per query, share of queries that repeat the question verbatim, stopword share, names and numbers per query.
- **Cost:** time and energy per correct answer per arm, including the embedding time of dense searches.

## 6. Missing data

As PREREG-AGENT.md §9. Every episode counts; contrasts use the rows every arm of the contrast completed, with design weights.

## Deviation log

(none)
