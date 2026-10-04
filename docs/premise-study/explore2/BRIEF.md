# Exploration phase 2: shared brief for workers

Goal: the most accurate way to answer EnronQA questions with **Gemma 4 e2b** (`gemma4:e2b-it-qat`) as the only generator, in three categories: **one-shot** (fixed pipeline, no model-chosen actions), **agent** (the model chooses actions: searches, opens, etc.), **hybrid** (fixed pipeline plus model-driven or conditional extra steps). Phase 1 ended with a frozen, pre-registered winner `gates` (checkpoint tag `explore-checkpoint-gates`). Phase 2 looks for something better.

## Where we are (J1 accuracy, design-weighted, miss share 6.8%; FULL-0, n = 600)

| variant | weighted | miss | hit | wall ms |
|---|---|---|---|---|
| oracles (gold email only, sandwich prompt; diagnostic ceiling) | 91.5 | 82.0 | 92.2 | 334 |
| 31b P-B (target to beat) | 87.4 | | | |
| **gates** (champion) | **86.8** | 37.3 | 90.4 | 752 |
| pbs (P-B + sandwich prompt) | 83.5 | 3.3 | 89.3 | 667 |
| gatea (gate, T2 prompt) | 83.4 | 36.0 | 86.9 | 738 |
| P-B (BM25 global top 5, T2) | 80.3 | 2.7 | 86.0 | 649 |
| frozen agent (premise2-agent-v1) | ≈37 | | | |

`gates` (explore/variants.js `gatedMailbox(..., { onAbstain: true, sandwich: true })`): global BM25 top 5; mailbox BM25 top 20 reranked by RRF(k=10) of BM25 rank and a header-match rank (question words in Subject/Sender), top 5; if the global top-1 is from another mailbox, answer from the mailbox context first, else the global one; on an exact `NOT IN EMAILS`, retry once on the other context. Prompt: `sandwichPrompt` (T2 with the question also before the emails).

Strata: `miss` = the gold email is not in P-B's global top 5 (hard retrieval); `hit` = it is. Weighted = 0.068·miss + 0.932·hit. So **hits dominate**: +1 point on hits ≈ +0.93 weighted; +10 on misses ≈ +0.68. Headroom: hits 90.4 → 92.2 with the gold email alone (reading/distraction), misses 37 → 82 (retrieval).

What failed in phase 1 (don't repeat without a new twist): model-chosen email selection (select-2-of-5/10/15), quote-then-answer, e2b keyword expansion, RRF of mailbox+global, cascades, thinking mode (too slow), fallback agents and auto-open agents (agentx.js), extra prompt rules ("find the email first", "match people/subject/date"), a subject/sender index before the emails, 6 emails instead of 5, header rerank of the global list, mailbox-only contexts.

## Hard rules

1. **TEST is off limits.** Only the exploration pool (`explore/pool.js` `loadPool`) and the sets in `.data/premise2/explore/sets/`. Never open or compute on `benchmarks/premise2/agent-items.json`, `.data/premise2/pools.json` TEST/retrieval parts, `.data/premise2/verdicts.jsonl`, `.data/premise2/answers.jsonl`, or anything under `.data/premise2/agent*`, `simple-run`, or `benchmarks/results/premise2/` other than `explore/`. The runner enforces `assertExplorable`; offline scripts must use pool records only.
2. **Do not edit existing code**: nothing in `benchmarks/premise2/*.js`, `benchmarks/premise2/explore/*.js`, `PREREG*.md`, `tests/`. You may import from them. New code only in `benchmarks/premise2/explore2/variants/<your-prefix>-*.js` (variant modules, each `export const VARIANTS = { id: { version, describe, run(ctx, record) } }`) and `benchmarks/premise2/explore2/tools/<your-prefix>-*.js` (offline scripts). Notes in `docs/premise-study/explore2/<your-prefix>.md`. Do not git commit; the lead commits.
3. **Generator = e2b only**, through `ctx.generate({ prompt | messages, options })` (default options = main run's, num_predict 160; `generationOptions({...})` from `../../ollama.js` to change num_predict/stop). Retrieval helpers allowed (count in wall time; disclose): BM25 (`ctx.search(query, k, user|null)`, raw `ctx.bm25`), the MiniLM cross-encoder on CPU (`../../rerank.js` `loadReranker`, `rerankText`), nomic-embed dense on CPU (`ctx.embedQuery`, `../../dense.js` `loadDense`/`denseSearch` over `.data/premise2/dense.f32` + `dense-docs.json`; load once with `ctx.resource(name, loader)`). No other LLMs as generators, judges or rerankers.
4. **Cost cap:** mean wall time ≤ **3,243 ms/question** (5× P-B). Report wall ms and calls/question.
5. **GPU only through the locked CLI** (it serialises all workers; expect to wait in a queue — do offline work while waiting). Never call Ollama directly outside it, never load other models, never unload. Keep each `run` to ≤ 2 variants on one set (≤ ~12 min).
6. Variant ids start with your prefix; bump `version` whenever behaviour changes. Reuse helpers by importing from `../../explore/variants.js` (`sandwichPrompt`, `byHeaderRank`, `headerScore`, `selectionPrompt`, `parseSelection`, `clip`, ...) and `../../prompts.js` (`buildPrompt`, `ABSTAIN`, `isAbstain`).

## Tools

```
node benchmarks/premise2/explore2/cli2.js list
node benchmarks/premise2/explore2/cli2.js run S300-2 myvar [limit]      # e.g. limit 20 as a smoke test (answers are kept; the full run resumes)
node benchmarks/premise2/explore2/cli2.js grade S300-2 myvar           # J1 (gpt-oss-20b via OpenRouter), cents per 300
node benchmarks/premise2/explore2/cli2.js report S300-2 pb gates       # table vs pb and gates, failure buckets
```

Data for analysis: `.data/premise2/explore/answers.jsonl` (one JSON per answer: variant, version, set, questionKey, answer, status, contextPaths, readPaths, switched, used, wallMs, calls, ...), `verdicts.jsonl` (J1 verdicts by vkey; join via `explore/grade.js` `latestAnswers`, `verdictIndex`, `answerVerdictKey` and `judgeConfig("j1")` from `../judge.js`, as `explore/analyze.js` does), pool records (`loadPool(dataDir).byKey`: questionKey, question, user, path = gold email, twins, nearDups, stratum, gold = reference answer, alternates). Emails: `ensureEmailStore(dataDir, join(dataDir, "agent"), log)` from `../agent-run.js` → `.emailOf(path)`. `.env` must be loaded (`process.loadEnvFile(".env")`) for grading. dataDir = `.data/premise2`.

Sets: **S300-2** is the shared screening set (pb and gates are run there). FULL-0 (600) has every phase-1 variant's answers: use its stored answers freely for offline analysis, but do not run new variants on FULL-0, FULL-1 or S300-3 — the lead uses those for confirmation. S100-0..9 are free for quick smoke checks (older variants' answers are there too).

## Noise and promotion

e2b at temperature 0 is not deterministic here: re-running identical prompts changes ~30% of answer texts and 2–6 verdicts per 100. Differences under ~2 points on 300 questions are noise. Report Δ vs gates on S300-2 with the CI the report prints. **Candidate for promotion:** Δ vs gates ≥ +1.5 on S300-2 within the cost cap. Tell the lead (in your final report) the id; the lead confirms on S300-3, FULL-0 and FULL-1.

Think like a scientist: form a hypothesis from the failure data, test cheaply offline when you can (e.g. retrieval recall needs no GPU), then run. Prefer few strong ideas over many weak ones. Write what you tried, numbers and conclusions to your notes file as you go.
