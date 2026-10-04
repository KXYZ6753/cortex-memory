# Exploration plan: adaptive e2b accuracy search (handover prompt)

Saved on 2026-10-03 at the start of the exploration session on the Windows eval box, as the record of the procedure (content unchanged; some bullet lists compacted). Deviations are logged in `explore-journal.md`, not here.

Two corrections found during the box inventory (not changes to the plan): `.env` on this box has no OpenRouter/judge variables yet, and the Ollama app had auto-update enabled with v0.35.1 staged.

---

You are Claude, continuing a research collaboration with Kerem Cakmak. A previous session on Kerem's Mac wrote this prompt so that you start with everything it knew. Treat it as your own memory: the facts, numbers and decisions below are settled. Re-check a fact against the repo only when you are about to act on it.

I (Kerem) explicitly opt in to multi-agent orchestration for this work. Use the Agent tool freely, and the Workflow tool when it fits (keep each workflow under about 10 agents). Give lighter models (Sonnet) the mechanical work: lookups, recomputation, well-specified leaf modules, formatting. Keep the full model for design, failure analysis, methodology and synthesis.

Run autonomously. Do not wait for me between rounds. After each round, send me a short status: what ran, what won, what you will try next, and money spent. Ask me only when you are blocked on something only I can do: credentials, the physical machine, or a decision that changes what the paper claims. When I say "up to you", decide and move on. I am not a statistician, so explain any statistics in plain words. Keep messages short, with numbers first.

## 1. The project

- **Paper:** "Does Retrieval Engineering Offset Model Scale? A Controlled Study on Email Question Answering", by Kerem Cakmak and Suleyman Vural (corresponding author). The abstract is already accepted, so the framing is fixed.
- **Deadline:** Friday 9 October 2026; aim to finish earlier. The repo docs still say Monday 5 October; that date is outdated.
- **Question:** can better retrieval and representation let a small model (Gemma 4 e2b) match a large one (Gemma 4 31b) on EnronQA email question answering, at a fraction of the cost?
- **Long-term project memory:** `docs/premise-study/`. Read its `README.md` first, then `results.md`, `agent-arm.md`, `operations.md` and `study-design.md` as needed. `benchmarks/premise2/README.md` is the command reference. `PREREG.md` and `PREREG-AGENT*.md` are the pre-registrations.

## 2. Results so far (TEST, the 600 questions the 31b completed, adjudicated scores unless marked J1)

| condition | e2b (small) | e4b (mid) | 31b (large) |
|---|---|---|---|
| oracle (gold email only) | 96.3 | 96.3 | 98.2 |
| P-B: BM25 global top 5, R0 verbatim, rank order | 88.0 | 90.7 | 91.8 |
| E\*: BM25 k5, best-ranked email last (DEV-selected) | 87.0 | – | 92.5 |

- **The gap to close:** e2b P-B 88.0 vs 31b P-B 91.8, which is 3.8 points.
- **H2** (e2b with E\* non-inferior to 31b P-B at a 5-point margin) is inconclusive: −4.8 [−6.9, −2.8]. Gap closure is about 0.
- **E\* failed to transfer.** It was +1.5 on DEV (397 questions) and −1.1 on TEST. This is the lesson behind this session's design: a small tuning set plus many variants means the winner wins by luck.
- **Exploratory:** e2b oracle beats 31b P-B by +4.5 [2.0, 7.1]. Retrieval costs e2b 7.6 points and the 31b 6.3 points.
- **Where e2b loses points on P-B** (on the agent's 600 questions):
  - 51 BM25 top-5 misses cost about 4.7 points. Of these, 25 still have an answer-bearing twin in the top 5 (e2b gets 80% on them); 26 are true misses (e2b gets 3.9%).
  - On the 549 hits, e2b gets 92.3% vs 96.0% with the oracle. That is distraction, worth about 3.4 points.
  - The small model is distractible: four random distractors added to the oracle cost e2b 5.7 points and the 31b only 0.3; four hard distractors cost e2b 6.7.
- **Retrieval, answer-bearing recall@5:** BM25 global 95.5%; BM25 per-mailbox 98.1%; hybv1 95.6%; RRF-60 91.3%; dense (nomic-embed-text) 79.8%. The MiniLM cross-encoder rerank made accuracy worse (−4.3, J1).
- **Exploratory, already seen on TEST** (disclose if used later): per-mailbox BM25 k5: +2.0 [−0.3, 4.4] (J1, n=300); R2 thread-aware rendering: no effect; k1, k3 and the gate: worse than k5.
- **Judge basis:** J1-only scores run about 4 points below adjudicated ones (e2b P-B on 955: 87.5 adjudicated vs 83.7 J1). Never compare across bases.
- **Noise floor:** null-perturbation flip rate 2.0–2.7%. The determinism pilot gave 9 of 10 identical transcripts.
- **Cost on this box, per question:** e2b P-B: about 570 ms generation plus 81 ms BM25. 31b P-B: about 15.5 s generation. Its pipeline time is about 24× e2b's, and it uses about 19× the energy per correct answer.

## 3. The agent arm (model-driven search) and its diagnosis

**Protocol** (`benchmarks/premise2/agent.js`, `premise2-agent-v1`): plain-text actions, one per turn — `SEARCH: <keywords>` returns 10 snippets (id, subject, sender, first 200 body characters); `OPEN: id, id, id` returns up to 3 full emails, each capped at 12,000 characters; `ANSWER: <text>` ends the episode. At most 5 rounds, then a forced answer. A malformed turn uses up a round; two in a row force the answer. Same options as the main study, with `num_predict` 160 per turn.

**Accuracy** (design-weighted to the 600 questions):

| model | P-B | agent | change |
|---|---|---|---|
| tiny (1b) | 51.2 | 1.3 | −53 |
| e2b | 88.0 | 40.0 | −48 |
| e4b | 90.7 | 69.2 | −21.5 |
| 31b | 91.8 | 75.8 | −13.7 (n=200 core, weighted) |

- **A1** (e2b agent vs e2b P-B): inferior. **A2** (scale buys search skill): +30.7 [20.2, 41.0]. **A3** (e2b agent vs 31b P-B): inferior.

**Diagnosis: the failure is selection and commitment, not reading or query writing.**
- Reading is fine: when the answer email is opened, e2b is correct 86.5% of the time (95.2% with the oracle).
- e2b finds the gold but doesn't open it: its own searches show the gold in the snippets 91.2% of the time, but it opens the gold only 41.3% of the time when shown. e2b error causes: 240 shown but not opened, 30 never found, 56 abstained, 34 opened but wrong. e4b and the 31b open the gold about 70% of the time when shown. The 31b's errors are mostly abstentions (43 of 62), and it hits the forced answer 7.5% of the time. The 1b never opens anything and hits the forced answer 75.6% of the time.
- Query writing doesn't matter: harness runs the raw question as round 1: +2.3 [−0.9, 5.6].
- Index changes didn't help: dense 35.2; RRF-60 39.0; field-BM25 39.7 vs BM25 40.0. RRF helped a little on true misses.
- Recovery of true misses is near zero: e2b 3.9%, the same as P-B; the 31b 11.5% vs 0%.
- The design flaw: the fixed pipeline amounts to "always open the top 5". The agent gave that up, so e2b's hits fell from 92.3% to 42.1%. The upside was capped anyway: perfect search on the misses is worth at most about 5 points (e2b would reach about 93 vs the 31b's 91.8). That is the only way past the 31b.

**Other exploratory runs** (branch `codex/overnight-word-overlap`): one-shot word-overlap retrieval: answer recall@5 82.5% vs BM25's 95.9%; a word-overlap agent: surfaced evidence 87.7% vs BM25's 94.0% for e2b. Both generated for several models, almost entirely ungraded; low priority, do not spend budget on them. The overlap report pairs a 600-question 31b BM25 agent set, so this box may hold more agent data than the Mac snapshot. Inventory before assuming.

## 4. Machine, repo, data, environment

- Windows 11, RTX 5060 Ti 8 GB, 40 GB RAM, Node 24.21, Ollama 0.34.2 (auto-update must stay off; the agent harness refuses other versions). The 31b runs mostly on CPU here.
- Models: tiny `gemma3:1b-it-qat`, small `gemma4:e2b-it-qat`, mid `gemma4:e4b-it-qat`, large `gemma4:31b-it-qat`. Digests must match the main run.
- Generation options: temperature 0, top_p 1, seed 42, `num_ctx` 16384, `num_predict` 160, `truncate: false`; pin `num_batch` too.
- Code: newest on `origin/codex/overnight-word-overlap`; create `premise-explore` from it. Commit often and push to origin. Never force-push.
- Files only on the Mac, untracked: `docs/premise-study/paper-draft.md`, `benchmarks/results/premise2/agent-snapshot-report.md`.
- Key modules to reuse in `benchmarks/premise2/`: `dataset.js`, `bm25.js`, `retrieve.js`, `contexts.js`, `prompts.js`, `represent.js`, `evidence.js`, `agent.js` (`runEpisode`), `agent-run.js` (`ensureEmailStore`), `judge.js` (`referenceVerdict`, `verdictKey`, `USAGE`), `grade.js`, `stats.js`, `ollama.js`, `energy-logger.js`.
- Frozen code: do not change the behaviour of frozen modules. Editing `agent.js` changes `PROTOCOL_HASH`. New code goes in new files (e.g. `benchmarks/premise2/explore/`) that import the frozen modules. Never edit `PREREG*.md` text above its `## Deviation log`.
- Tests: `npm run test:premise2`. Add small tests for new logic that branches or parses.
- Data: `.data/premise2/` is gitignored and not backed up; back it up first. All exploration output goes under `.data/premise2/explore/`.
- Grading: OpenRouter. J1 `openai/gpt-oss-20b` (reasoning effort low), J2 `nvidia/nemotron-3-nano-30b-a3b` (reasoning off), adjudicator `deepseek/deepseek-v4.1-flash`. Always send `reasoning.exclude` and `provider.sort: "throughput"`; retry once in plain format if a verdict fails to parse. `.env` needs `OPENROUTER_API_KEY`, `POC2_J1_PROVIDER`, `POC2_J1_MODEL`, `POC2_J2_PROVIDER`, `POC2_J2_MODEL`, `POC2_ADJ_PROVIDER`, `POC2_ADJ_MODEL`, `POC2_JUDGE_CONCURRENCY`.
- Windows lessons: PowerShell has no `&&` or inline `VAR=value`; with `OLLAMA_MAX_LOADED_MODELS=1` any embedding call evicts the generator; changing `num_ctx` forces a reload and silently changes `num_batch`; reload detection needs a ~1 s threshold; only one GPU generator at a time; scan new files for control bytes.
- Keep the machine awake for long runs; run generation in the background.

## 5. Goal of this session

Find the highest-accuracy way to answer with e2b, by any method (fixed pipeline, agent, or hybrid). Learn adaptively from each round. Confirm the winner once on TEST, with energy measurement.

Decisions made with Kerem:
- Objective: end-to-end e2b accuracy. Explore fast; energy only for the finalist.
- Cost cap: a selectable variant takes at most **5×** e2b P-B's mean wall time per question, measured on this box in round 0. Variants over the cap may run for insight but cannot win.
- Budget: **$5 total** OpenRouter. Stop exploration grading at **$3.50**; keep $1.50 for tier-A grading of finalists and TEST. Log spend after every grading batch.
- Test size: 50–100 questions per screening; promote to larger fresh sets.
- Adaptivity: each round designed from the previous round's failure analysis.
- Primary model: e2b. e4b may check generalisation. 31b only as in-pool target and optionally on TEST.

## 6. Data separation: the exploration pool

- TEST is off limits until the final confirmation: the 955 TEST questions, the 2,000 retrieval-only questions, and any question from the 120 evaluation mailboxes. Enforce in code: refuse any question whose mailbox is not one of the 30 tuning mailboxes (`pools.json` `dev` users), and any whose gold or twin paths intersect TEST or retrieval-only gold and twin paths.
- The 30 tuning mailboxes hold 17,175 emails with 25,011 dev-split and 21,496 test-split questions. Exclude the 397 DEV questions.
- Build once and freeze: main-study filters (answerable gold, gold in corpus, token cap; twin/near-duplicate bookkeeping); label each question hit (answer-bearing email, gold or twin, in frozen BM25 global top 5) or miss; record the true miss share (expect 5–8%); freeze with hashes under `.data/premise2/explore/`.
- Sets: round-robin across mailboxes, registry of used keys, never reuse a question across stages. S100: 50 misses + 50 hits, fresh each round. S300: 100 misses + 200 hits. FULL: 600 (~150 misses, 450 hits). Report design-weighted accuracy plus per-stratum accuracy.

## 7. The adaptive loop

Round 0: back up; branch; save this plan; build pool and harness; on S100-0 and FULL run e2b P-B (exactly as main study), e2b E\*, frozen e2b A-agent; measure wall time (sets cap) and J1 cost; check baseline ≈84% J1; queue 31b P-B on FULL for the first long GPU idle window.

Each round: read journal; propose 4–8 variants (hypothesis, failure bucket, expected effect); implement as flags in one harness where possible; run each plus champion plus baseline on a fresh S100; grade J1 (verdict cache); analyze (weighted accuracy, Δ vs baseline/champion with mailbox-cluster bootstrap, per-stratum, failure buckets, wall time, spend, ~10 failed transcripts per leader); decide promote/combine/kill; update journal, commit, send status.

Promotion rules: S100→S300: weighted Δ ≥ +2.0 vs baseline and hit stratum no worse than −3.0; also anything with miss-stratum Δ ≥ +15 as a component. S300→FULL: weighted Δ ≥ +1.5 and 95% lower bound > −1.5. Winner on FULL: highest weighted accuracy within the cost cap; within 1 point, take the simpler/cheaper. Noise: ±5 at 100, ±3 at 300, ±2 at 600.

Stop: no new champion for two consecutive rounds, exploration spend reaches $3.50, or freeze time.

## 8. Starting hypotheses

1. Fallback agent: start with P-B top-5 context; (a) tools only after the model says the answer is not in the emails; (b) tools from the start.
2. Auto-open agent: harness opens the top 2–3 results of every search.
3. Select-then-read: model picks 1–2 relevant emails among top 5 (or 10), then answers from those alone.
4. Per-mailbox scope for P-B and agents (recall@5 95.5% → 98.1%).
5. Query expansion: e2b rewrites into keywords; fuse raw and rewritten BM25 lists.
6. Quote-then-answer.
7. Agent ergonomics: longer snippets (~600 chars, with date), larger open budget, nudge to open before answering.
8. Verify and retry.
9. Thinking mode for e2b, within the cost cap.

Lower priority unless "never found" dominates: LLM-powered indexing, stronger embedder, document expansion; reranking, k/order tweaks, R2 rendering (already tested without gains).

## 9. Final confirmation (after the freeze)

1. Freeze the winner (plus one close runner-up).
2. Write `benchmarks/premise2/PREREG-EXPLORE.md`: frozen configuration and code hash; full selection history; hypotheses, Holm-adjusted — X1: e2b(winner) − e2b(P-B), superiority; X2: e2b(winner) − 31b(P-B), non-inferiority at 5 points plus superiority; same estimator as main study (paired differences, mailbox-cluster bootstrap, B = 10,000, seed 20260922).
3. Commit it before any TEST episode runs.
4. Run e2b(winner) on TEST (the 600 questions the 31b completed, plus the remaining 355 if time allows) with the energy logger (LibreHardwareMonitor on port 8085 plus `nvidia-smi`).
5. Grade tier A (J1 + J2 + blind adjudication), comparable with the adjudicated 91.8.
6. Report accuracy, latency, and energy per correct answer, gross and marginal.
7. Optional: the winner on the 31b over the 200-question core.

Report honestly whatever it shows. Disclose that per-mailbox BM25 was seen on TEST before exploration.

## 10. Time plan (Eastern time)

Sun 4 Oct morning: round 0, 31b in-pool target overnight. Sun rest of day: rounds 1+. Mon 5 Oct: rounds continue; freeze by 20:00. Tue 6 Oct: pre-register, TEST run with energy, tier-A grading, report. Wed 7 – Thu 8 Oct: paper. Fri 9 Oct: deadline.

## 11. The journal and outputs

- `docs/premise-study/explore-journal.md`, one section per round: time; hypotheses and targeted failure buckets; results table (weighted accuracy, Δ vs baseline and champion with CI, per-stratum, wall time × baseline, J1 calls, dollars); two or three transcript observations; decisions and next hypotheses. Record every variant tried, including losers.
- Machine-readable results: `benchmarks/results/premise2/explore/` (small JSON summaries, committed). Answers and verdicts stay under `.data/premise2/explore/`.
- Memory on this machine: deadline, section-5 decisions, section-6 data rules, journal location.

## 12. First actions, in order

1. Inventory (git, `.data/premise2/`, Ollama version and models, `.env` variable names).
2. Back up `.data/premise2/`.
3. Create `premise-explore`, save this prompt as `docs/premise-study/explore-plan.md`, commit.
4. Build and freeze the exploration pool with the hard block on evaluation mailboxes; report pool size and true miss share.
5. Build the minimal exploration harness on the frozen modules and test it.
6. Run round 0, then start the loop.
