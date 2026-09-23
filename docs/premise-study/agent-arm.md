# The agent arm: model-driven search

**Status (2026-09-23):**
- **Base agent arm:** built, pre-registered (`benchmarks/premise2/PREREG-AGENT.md`, commit `54ae8f8`), smoke-tested and pushed (commit `822571f`). **Not yet run on Windows.**
- **Index-factor extension** (below): approved by Kerem, **not yet built**.

## Why

With fixed BM25 top-5 contexts, the gold email is missing for 51 of the 600 questions the 31b answered. Both e2b and the 31b lose ~4.7 points to those misses, and no fixed pipeline can recover them. A model that writes its own queries can. The question is whether scale buys *search skill*, even though V2 found it buys little *reading skill*. It also answers the reviewer objection that fixed retrieval is a strawman.

**What is recoverable (stated in the addendum).**
- Of the 51 misses, 25 still have an answer-bearing twin in the BM25 top 5 (models score 76–84% on those).
- 26 are true misses (0–4%).
- So recall can add at most ~4.3 points, while the 549 hits can only lose.
- One search on the raw question already shows the gold in its top 10 for 566/600 questions: 17 of the 51 misses are fixable by opening a lower-ranked result (selection skill), and 34 need a rewritten query (query skill).

## Protocol (`benchmarks/premise2/agent.js`, version `premise2-agent-v1`)

The protocol is plain text and byte-identical for every model (gemma3:1b has no native tool support in Ollama). Each assistant turn is one action line:
- `SEARCH: <keywords>` returns 10 snippets: a stable id, subject, sender, and the first 200 body characters (QP-decoded, word-boundary cut).
- `OPEN: <id>, <id>, <id>` returns up to 3 full emails (R0, verbatim), each capped at 12,000 characters with an explicit marker. No gold email is over 7k characters.
- `ANSWER: <text>` ends the episode.

**Budget rules:**
- At most 5 SEARCH/OPEN rounds, then a forced answer turn.
- Every tool reply says how many rounds are left.
- A malformed turn consumes a round and gets a fixed correction; two in a row go straight to the forced answer.
- The model gets back only the canonical form of its action, never its own prose.

**Context guard:** the same byte bound for every model, with one 4,096-token output reserve for all arms. An OPEN that doesn't fit is refused explicitly, never truncated silently.

**Runtime:**
- The main study's options, with `num_predict` 160 per turn (4,096 for thinking arms).
- Stop sequences only on hallucinated tool output.
- Model digests and the Ollama version must match the main run, or the run refuses.

## Questions and arms

- **Questions:** the 600 TEST questions of P-B items 0..599, across 120 mailboxes. The first 200 hold all 51 misses, spread evenly (one every 3–4 slots) among 149 random hits; the other 400 hits follow (`agent-items.json`, committed).
- **Estimates** are design-weighted to the true shares (51/600 misses). The bootstrap recomputes the stratum sizes per replicate, using "ghost" rows for questions not yet completed. So any completed prefix is valid, and at full coverage the result equals the plain mean.
- **Arms and queue:**

  | order | arm | model | index | purpose |
  |---|---|---|---|---|
  | 0 | determinism pilot | e2b | BM25 | 10 DEV questions, run twice |
  | 1 | A-agent | e2b | BM25 | the agent arm |
  | 2 | A-agent | 31b | BM25 | the agent arm |
  | 3 | A-agent | e4b | BM25 | the agent arm |
  | 4 | A-agent | 1b | BM25 | the agent arm |
  | 5 | A-rawfirst | e2b | BM25 | the harness runs round 1 as SEARCH on the raw question: isolates who writes the query |
  | 6 | A-null | e2b | BM25 | answer-neutral rewording: the flip floor |
  | 7 | A-think | e2b | BM25 | thinking mode, exploratory |
  | 8 | A-think | e4b | BM25 | thinking mode, exploratory |

- **Hypotheses** (Family A, Holm α = .05):
  - **A1:** e2b(agent) − e2b(P-B), two-sided.
  - **A2:** [31b(agent) − 31b(P-B)] − [e2b(agent) − e2b(P-B)], two-sided.
  - **A3:** e2b(agent) − 31b(P-B), non-inferiority at −5.
- **Skill decomposition** (exploratory):
  - **query skill:** did the agent's own searches surface the gold, a twin or an answer-bearing email, against the raw-question top 10?
  - **selection:** did it open the gold when it was shown?
  - **reading:** was it correct when an answer-bearing email was opened, against the oracle?
  - **looping:** rounds used, forced answers, protocol errors, repeated searches.
  - **error causes:** never found / shown but not opened / opened but wrong / abstained / no answer.
- **Grading:** the same OpenRouter judges, every arm tier A. The adjudicator's evidence is exactly what the model saw (opened emails plus snippet lines), with no gold fallback, and quotes are verified against those shown texts. J1/J2 verdicts are reused for answers identical to main-study answers. Agent verdicts are written to `agent/verdicts.jsonl`.

**Isolation.** Everything the agent run writes goes under `.data/premise2/agent/`: state, answers, markers, energy, verdicts and `emails.sqlite`. The main run's files were verified byte-identical after the smoke run.

**Validated on the Mac:**
- a `gemma3:1b` smoke run through all 8 arms;
- resume and a hard kill mid-arm (no episode lost or repeated);
- grading and the report end to end;
- replaying P-B's answers as a synthetic agent gives A1 = 0.0 [0.0, 0.0], and the weighted estimate equals the plain mean at full coverage;
- in the smoke, the 1b model looped: it repeated one search five times and gave up, exactly the behaviour the looping metrics capture.

**Time estimate on Windows:** e2b 10–25 min; 31b 5–9 h; e4b and 1b under 1 h each; controls ~30 min; thinking arms 1.5–10 h. The thinking arms run last and are cut by the stop time if needed.

## Index-factor extension (approved 2026-09-23, not built)

**Kerem's rationale:** in the fixed pipeline every model got the same query, so the index effect was the same for all of them by construction. When models write their own queries, wording and index can interact. BM25 rewards exact keywords (names, subjects); dense rewards natural-language paraphrase. Since the paper is about indexing and retrieval, the agent should be tested on all three indexes.

**Choices made:**
1. Indexes: **BM25, dense (nomic) and hybrid RRF-60** (rerank excluded).
2. Tool text: the **same neutral wording** for all ("searches all emails"). Only the ranking behind SEARCH changes.
3. The 31b runs dense and hybrid on the **enriched core 200**, then extends toward 600 only if the stop time allows.
4. A **raw-question-first control for e2b on each index**, to measure the wording × index interaction directly.

**Design drafted:**
- **Search backends in `agent-run.js`:**
  - bm25 (as now);
  - dense: embed `search_query: <query>`, then `denseSearch` over `dense.f32`, top 10;
  - rrf: `rrf([bm25 top-100, dense top-100], 60)` from `retrieve.js`, top 10.
- **The key constraint:** Windows Ollama runs with one resident model, so embedding queries through Ollama would evict the generator (reloading the 31b every search). Plan: embed queries **in-process with transformers.js**, using `nomic-ai/nomic-embed-text-v1.5` ONNX fp32 with mean pooling and L2 normalisation, at a pinned revision. The library is installed and supports nomic_bert.
  - Validate on the Mac against Ollama's nomic-embed-text: cosine, and top-10 overlap with the frozen fixed-pipeline dense lists in `retrieval.jsonl`.
  - Add a Windows preflight that re-checks the overlap on 20 DEV questions.
  - Fallback if validation fails: Ollama embeddings with `OLLAMA_MAX_LOADED_MODELS=2` and `num_gpu: 0` for nomic, plus a residency check.
- **Episode keys** must include the index (`episodeSha` gains an index component). Arm cell ids encode it (for example `A-agent-dense`, `A-rawfirst-rrf`).
- **Queue:**
  1. pilot
  2. e2b × 3 indexes
  3. 31b: BM25 (600), dense (200), rrf (200)
  4. e4b × 3 and 1b × 3
  5. e2b controls (rawfirst × 3 indexes, null)
  6. thinking on the core 200
  7. 31b dense/rrf extension 200 → 600, interleaved in blocks of 50
  8. thinking extension

  Central estimate ~13 h before the extension; the stop time cuts the tail.
- **Hypotheses drafted for a separate Family B** (Holm α = .05). **Not yet pre-registered**: add them to `PREREG-AGENT.md` before the run.
  - **B1:** e2b(agent-dense) − e2b(agent-BM25).
  - **B2:** e2b(agent-RRF) − e2b(agent-BM25).
  - **B3**, who writes the query × index: [e2b(agent-dense) − e2b(rawfirst-dense)] − [e2b(agent-BM25) − e2b(rawfirst-BM25)].
  - **B4**, scale × index: [31b(agent-dense) − 31b(agent-BM25)] − [e2b(agent-dense) − e2b(agent-BM25)], on the rows the 31b completed.
- **Exploratory additions:**
  - e4b and 1b index effects;
  - RRF versions of B3 and B4;
  - the fixed-pipeline vs agent index penalty for e2b (against the G-R0-{bm25, dense, rrf60} cells, on the J1 basis);
  - query-style metrics: words per query, verbatim-question share, stopword share, names and numbers;
  - an embedding-fidelity check: rawfirst-dense round-1 results against the frozen dense top 10.
- **Open review question:** an independent critique of this design was started but cancelled. Worth running before building. Its focus: embedding fidelity (fp32 ONNX vs Ollama's GGUF f16), the power of B3 and B4 (the 31b has only ~200 rows on the new indexes), and CPU contention during the 31b arm.
