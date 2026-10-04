# premise2 pre-registration addendum 3: the exploration winner on TEST

The adaptive exploration (`docs/premise-study/explore-plan.md`, log in `docs/premise-study/explore-journal.md`) searched for the most accurate way to answer with e2b alone, on questions from the 30 tuning mailboxes only. This file freezes the winner and states, before any TEST episode of it runs, how it will be tested. It is committed first. The confirmation runner (`benchmarks/premise2/explore/confirm.js`) refuses to generate unless this file is committed, unmodified, and records the current code hash of `benchmarks/premise2/explore/`. Earlier pre-registrations are unchanged.

Code hash: `9801148b3056002a9e5cf48b5972acb71cd218cd90ec5b24918d63590254f910`

## 1. The frozen winner: `gates`

One question, at most two model calls, no model-written queries:

1. **Retrieve two candidate contexts with BM25** (the main study's FTS5 index over the full corpus):
   - *global*: BM25 top 5 over all mailboxes (P-B's context);
   - *mailbox*: BM25 top 20 within the asker's mailbox, re-ranked by reciprocal-rank fusion (k = 10) of the BM25 rank and a header-match rank, top 5. The header-match score counts question words (lower-cased, ≥ 3 characters, minus a fixed stop list) found in the email's Subject or Sender line (1 each), plus recipient-line matches (0.5 each, at most 2). No model call.
2. **Gate:** if the global top-1 email is from another mailbox, the mailbox context is tried first; otherwise the global context.
3. **Answer** with T2 (the main study's answer template), the question also stated once before the emails ("sandwich"); otherwise byte-identical to T2.
4. **On abstention:** if the answer is exactly `NOT IN EMAILS`, ask once more on the other context. The second answer is final.

Model and settings, as in the main run: `gemma4:e2b-it-qat` with the digest in `run-state.json`, Ollama 0.34.2, the main run's generation options exactly (temperature 0, top_p 1, seed 42, num_ctx 16384, num_batch 512, num_predict 320). Exploration used num_predict 160. No answer of the winner on the 600-question exploration set reached that limit (0 of 600), so using the main study's 320 changes nothing but the cap.

Runner-up, frozen but not run on TEST: `gates6`, the same with 6 mailbox emails when the gate switches (FULL-0: −0.1 [−0.3, 0.1] against the winner).

Cost check (explore-plan cap: at most 5× e2b P-B's 649 ms per question): 759 ms mean on 100 fresh questions after a model reload (1.17×), p95 1.2 s, 1.04 model calls per question.

## 2. Selection history

All exploration accuracy is J1-only (gpt-oss-20b), design-weighted to the pool's 6.8% miss share, on sets drawn without overlap (questions, emails or twin groups) from a frozen pool of 37,336 questions. Promotion: S100 → S300 if Δ ≥ +2.0 and hits ≥ −3.0 (or misses ≥ +15 as a component); S300 → FULL-0 (600) if Δ ≥ +1.5 with the 95% lower bound above −1.5. Stop after two rounds with no new champion on FULL-0.

| round | tried (S100) | reached FULL-0 | FULL-0 Δ vs P-B [95% CI] |
|---|---|---|---|
| 0 | P-B, E*, frozen agent | all three (baselines) | E* +2.0 [−1.2, 5.3]; agent −43.5 |
| 1 | mailbox P-B, RRF mailbox+global, select-2-of-5, select-2-of-mailbox-10, quote-then-answer, keyword expansion, two fallback agents, auto-open agent | none (S300: best +2.2 [−1.7, 5.6]) | – |
| 2 | cascades, mailbox select variants, mailbox quote, wide selection, thinking mode (over the cost cap) | none | – |
| 3 | header-match rerank (global, mailbox), mailbox fill, top 3 | hdru, pbfill | +0.6 [−1.9, 3.1], +0.4 [−2.5, 2.8] |
| 4 | hdrud10, hdru6, hfill | all three | +2.2 [−0.4, 4.8], −0.0, +1.6 [−1.2, 4.0] |
| 5 | gate, gatea (gate + abstain retry) | gatea | **+3.1 [2.2, 4.0]** (champion) |
| 6 | gatea + mailbox top 10, + third try, + sandwich prompt (gates) | gates; pbs (diagnostic, prompt only) | **gates +6.5 [4.2, 8.9]** (champion); pbs +3.2 [0.9, 5.4] |
| 7 | gates + "find the email first" rule, + "match people, subject and date" rule | both | −2.2 and −1.4 vs gates |
| 8 | gates + subject/sender index, gates with 6 mailbox emails | both | −1.2 and −0.1 vs gates; stop rule met |

Diagnostics on FULL-0: e2b with only the gold email, T2 88.6, sandwich prompt 91.5; 31b P-B 87.4 (gates 86.8). In all, 35 e2b configurations were run (plus 3 diagnostics: two gold-only oracles and a replicate of P-B), on 9 screening sets of 100 (a tenth was used only to re-time the winner), one of 300 and one of 600; the full list with every set's numbers is in the journal.

## 3. Population

The agent's 600 TEST questions (P-B items 0..599, `benchmarks/premise2/agent-items.json`, in that order): the questions on which the 31b P-B score of 91.8 was measured. If time allows, the remaining 355 TEST questions follow (secondary analyses only).

## 4. Hypotheses (Holm, α = .05, over the three tests)

- **X1** e2b(gates) − e2b(P-B): superiority.
- **X2-NI** e2b(gates) − 31b(P-B): non-inferiority at a 5-point margin.
- **X2-sup** e2b(gates) − 31b(P-B): superiority.

Estimator, as for the main study's H2: per-question paired differences over the 600 questions where both arms have a final tier-A score, unweighted; mailbox-cluster bootstrap with B = 10,000 and seed 20260922 (`stats.js` `clusterBootstrap`, `bootstrapP`, `classify`); Holm-adjusted p-values across X1, X2-NI and X2-sup.

For calibration, not as a criterion: on the exploration pool gates was +6.5 J1 points over P-B and 0.6 below 31b P-B. On TEST the e2b P-B to 31b P-B gap is 3.8 adjudicated points. Effects tuned on the pool may shrink on TEST, as E* did (+1.5 on DEV, −1.1 on TEST).

## 5. Grading

Tier A, as in the main study: J1 `openai/gpt-oss-20b` and J2 `nvidia/nemotron-3-nano-30b-a3b` on every answer; blind adjudication by `deepseek/deepseek-v4.1-flash` (all via OpenRouter) when J1 and J2 disagree, when both say INCORRECT, and for a seeded 10% of consensus-CORRECT (`inCorrectAudit` on `X-explore-gates|small|<questionKey>`). The adjudicator sees the emails the final answer call saw, and quotes must verify against the gold, its twins or answer-bearing emails. Exact abstentions and technical failures are INCORRECT without a judge call. Verdict keys are the main study's, so an answer identical to one already judged reuses that verdict.

Comparators: the main study's tier-A verdicts for the e2b and 31b P-B answers on the 600 (the published 88.0 and 91.8). If those verdict files are not available on the analysis machine, the unchanged comparator answers are graded by this same tier-A procedure instead, and that is logged as a deviation.

## 6. Missing data and failures

- A winner answer that overflows the context window, or fails technically after 3 attempts, counts INCORRECT: its prompts are built at run time, so the failure is part of the pipeline. Sensitivity: the same tests with those questions excluded.
- A tier-A answer left without a final verdict (J1 and J2 disagree and no adjudication) is excluded pairwise; the count is reported.

## 7. Secondary and exploratory (estimates and CIs only)

- X1 and X2 on the J1-only basis (comparable with exploration).
- X1 over every TEST question run (up to 955).
- Latency per question (wall time including BM25): mean, p50, p95; calls per question; how often the gate switched and the abstention retry fired.
- Energy: CPU package plus GPU (a lower bound, as in the main study), logged by `energy-logger.js` (LibreHardwareMonitor on port 8085 plus `nvidia-smi`), with a 30 s idle baseline with the model resident and blocks of 50 questions; gross and marginal joules per answer and per correct answer, against the main study's e2b and 31b P-B figures.

## 8. Disclosures

- Per-mailbox BM25 (one ingredient of the winner) was seen on TEST before exploration: +2.0 [−0.3, 4.4] J1, n = 300.
- Exploration used J1 only, which runs about 4 points below adjudicated scores; exploration and TEST numbers are not on the same basis.
- e2b at temperature 0 is not fully deterministic on this build: re-running identical prompts changed about 30% of answer texts and 2–6% of verdicts per 100 questions. This noise is per question and inside the bootstrap.
- FULL-0 (600) decided between several finalists, so the winner's FULL-0 margin carries some selection optimism. This confirmation is the guard against it.

## 9. Order

1. Commit this file (with exploration code at the hash above).
2. `node benchmarks/premise2/explore/cli.js confirm-run 600` (energy logger on).
3. `confirm-grade`, then `confirm-analyze`; results in `benchmarks/results/premise2/explore/confirm.{json,md}`.
4. Report whatever it shows.

## Deviation log
