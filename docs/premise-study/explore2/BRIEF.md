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

---

# Round 2 (from Sun 4 Oct ~21:30 ET to Mon 5 Oct ~16:00 ET)

## What round 1 established (read the notes: f.md, r.md, o.md, a.md, w.md)

- **Hits are at e2b's reading ceiling** (gates reads gold-first in ~89% of hits; gold-only `oracles` fixes 13 and breaks 11 of gates' hit answers). Prompt-shape changes move hits ±1–2 at random per set. Gains so far come from **misses**.
- **e2b is deterministic** in these runs (identical prompt → byte-identical answer; reload per variant). Differences between variants on one set are real prompt effects but do not replicate across sets unless they are systematic.
- Best one-shot lead: **r5** = gates + when not switched, the best cross-encoder (MiniLM, CPU) email from the asker's mailbox BM25 top 30 replaces global #5. vs gates: S300-2 +1.9, S300-1 +0.4, S300-3 +2.3 (≈ +1.5 pooled), 1,240 ms. r4 (conditional swap) ≈ +1.0.
- Best hybrid lead: **a5** = gates + one model list-pick over 15 candidate lines; escalates (reads the pick alone) only when the pick is outside gates' context and covers the question's words ≥ 0.15 better. +0.4 [0.2, 0.6], never changed a hit answer in 500 questions.
- Lead stacks in `variants/s-stack.js`: s1 = r5 + mailbox dedup, s2 = s1 + rules-last prompt, s3 = s1 + a5 escalation (results pending).
- Useful primitives: e2b YES/NO relevance probe per email (w6/w7; ~95 ms/email; YES on 70% of answer-bearing, 6.7% of others); the cross-encoder (good for "best unseen email", bad for reordering a context); abstention is useless as a trigger (e2b almost never abstains when the answer is missing).
- Agents: harness-driven pick agents a2/a3 reach ~82–83 (P-B level) but lose to gates through wrong picks on hits (each lost hit ≈ 0.47 weighted points on S300 sets).

## The agentic gap (Kerem's main question for round 2)

Main study (TEST, frozen plain-text SEARCH/OPEN/ANSWER agent): e2b agent **40.0** vs its own P-B 88.0; e4b 69.2; **31b agent 75.8** (31b P-B 91.8). Diagnosis: e2b's failure is **selection and commitment, not reading or query writing** — its searches show the gold in snippets 91% of the time but it opens it only 41% of the time; reading the opened gold is 86.5% correct. The in-pool frozen e2b agent scores ≈37 on FULL-0. The question: **can scaffolding/harness design close the gap so an e2b agent matches the 31b agent (75.8) or even the one-shot pipelines (gates 86.8 in pool, 31b P-B 87.4 in pool)?** An agent here = the model chooses actions (what to search, what to open, when to stop/answer). It may be heavily scaffolded. Report agent results against: frozen e2b agent (≈37 in pool), gates, and the 31b reference.

## New tools

- `ctx.chatRaw(body)` posts any `/api/chat` body (`tools` for native function calling, `format` for JSON-schema constrained decoding, `messages`, `logprobs`/`top_logprobs` if this Ollama build supports them) with the main run's options by default (do NOT change num_ctx/num_batch — that reloads the model); counted as a model call. Test support with a 5-question smoke run before building on it.
- GPU queue is now FIFO with lead priority; grading has its own lock (no longer blocks the GPU). `cli2.js queue` shows the queue.
- Smoke tests: prefer `run S100-x myvar` (any S100 set) or `run S300-2 myvar 30`. Full screening on S300-2; second screening set for promising variants: **S300-1** (gates is there; phase-1 answers too). Don't use S300-3, FULL-0, FULL-1 (lead's confirmation sets).
- Be GPU-frugal: simulate offline from stored answers whenever possible; each GPU run ≤ 2 variants × 300 questions.

---

# Round 3 (Mon 5 Oct ~08:00 ET to Tue 6 Oct ~18:00 ET; lead wraps up by 20:00)

## Standings (Δ vs gates, weighted J1; FULL-1 is the cleanest set, never used for selection)

| id | kind | S300-2 | S300-1 | S300-3 | FULL-1 | wall ms | calls |
|---|---|---|---|---|---|---|---|
| **x1** (champion to beat; `variants/x-agent.js`) | agent | +1.1 | +3.8 | +2.3 [0.2, 4.3] | +1.3 [−0.4, 2.9] | ~1,800 | ~5.4 |
| k3 (`k-agent.js`) | agent | +1.1 | +2.7 | +3.2 | −0.1 | ~1,250 | ~4 |
| g5 (`g-agent.js`) | agent | −0.2 | +2.1 | +3.4 | +0.6 | ~1,490 | ~3.9 |
| p3 (`p-perfect.js`) | one-shot | +0.7 | +1.0 | +0.4 | +1.0 [0.3, 1.7] | ~1,320 | 1 |
| gates | one-shot | 85.1 | 83.9 | 83.7 | 84.6 (absolute) | ~750 | 1 |

x1 = YES/NO commit check over gates' first context (stop at first YES) → answer with gates' prompt → if mean token logprob < −0.1 hand to the g5 native-tools agent; no YES → k3's explore (CE-ordered list pick, own search, ≤3 opens). Read g.md, k.md, x.md, n.md, p.md before designing.

## Where the remaining points are

- **Hits (93% of the weight):** every system reads at ~88–90; gold-only reading (`oracles`) is 92.2. f.md: reading errors ≈ 9.7 points, ~3.4 of them J1 strictness (answer incomplete/over-specific vs the reference). Any hit-prompt change flips ~5% of hit answers at random, so hit-side ideas must be **targeted** (e.g. only on unsure answers, logprob < −0.1, where answers are 70–75% right) or **systematic** (answer form/completeness).
- **Misses:** x1 ≈ 43–49 vs gold-only 82. ~25/100 false YES stops (detectable, YES-logprob AUC 0.73, but recovery rarely finds a better email), ~11/100 never found.
- **Nondeterminism:** short decision calls interleaved with answer calls perturb answers via Ollama's prompt cache; decision prompts must not share the answer prompt's prefix. Offline simulations that reuse stored answers from a different call sequence overstate gains — confirm on the GPU.

## Promotion

Candidate = pooled Δ vs **x1** ≥ +1.0 over S300-2 + S300-1 (or Δ vs gates ≥ +2.5 pooled) within the cost cap. The lead confirms on S300-3 and FULL-1 (and FULL-0). Workers never run on S300-3, FULL-0, FULL-1. Each worker: ≤ 2 variants × 300 per GPU run; offline-first.
