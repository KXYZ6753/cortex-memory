# Project history and decisions

A chronological record of the project, with each decision's reason. People: Kerem Cakmak (first author, runs the experiments) and Suleyman Vural (corresponding author). The code was written with Claude Code; its decisions were made with Kerem.

## 1 September 2026: the original plan

`research-plan-original.md` laid out a 35-day plan:
- The grid: 2 representations × 3 retrieval methods × 2 generator sizes = 12 cells, plus a no-retrieval floor and an oracle ceiling.
- Four outcomes per cell, and a 5 October deadline.

At that point the repo (`cortex-memory`, an email-memory app) had working BM25, dense and hybrid retrieval and a retrieval benchmark. It had no generation stage, no answer grading, no energy or timing measurement, and stored no gold answers. The later work mostly followed that plan's spirit (controls, paired questions, confidence intervals, pre-registration) but not its calendar.

## Around 19 September: re-entry, and the V1 pilot ("premise benchmark")

**Kerem's ideas at re-entry.**
- Small models struggle most with noise (wrong or too many emails), so aim for precision in small pools, such as the top 3%. This was tested as the distraction cells.
- Extract facts with a small LLM (for example `birthday: 10-10-2000`) and search those. This was not pursued in V1 or V2 and is a candidate for future work.

**Constraints he set.**
- The eval box is a Windows PC with an RTX 5060 Ti (8 GB) and 40 GB RAM; development happens on a MacBook.
- If the research was going to fail, that had to be decided "this weekend".
- The eval box could run overnight.
- Windows commands must not use `&&` or inline `VAR=value`; settings go in `.env`.

**The V1 pilot.**
- Built as `benchmarks/premiseBenchmark.js` on branch `poc-premise`: a proof-of-concept tester that outputs every raw value, run overnight on the Windows box.
- Design: 100 questions; e2b (Q4_K_M) vs 31b-it-qat; oracle, floor and distractor cells; gpt-oss:20b-cloud as judge.
- A mid-run crash came from an Ollama 401 (not signed in to the cloud); a later commit stopped auth failures from masquerading as schema failures.
- V1 output: oracle e2b .88 vs 31b .94 (p = .18, "UNDERPOWERED").
- V1's own summary flagged truncation warnings, an energy number that was GPU-only, and a pool limited to 2,000 emails.

## 21–22 September: V2 design (the "semi-full" study)

Kerem asked for a longer V2 that fixes V1's mistakes and yields much more data. He supplied a list of 50 suggested fixes, asked for a smaller third model to amplify distraction effects, and asked for deep research into preprocessing for small models ("see missed opportunities", not confirm the thesis).

**Forensic findings on V1 that shaped V2.** All were verified on V1's data; the numbers are in `benchmarks/results/v1-pilot-reanalysis.md`.
- **Prompt length:** no prompt was actually truncated; the warnings came from a chars/3.67 estimator.
- **Timing:** the 27× time ratio included cold loads; warm, it is about 30×.
- **Preprocessing:** the −4 pts from preprocessing came from answer deletion (URLs turned into `[link]`, dates in dropped `Sent:` lines). It is not a reading effect.
- **Distractors:** many "hard negatives" contained the answer (twins, thread copies).
- **Judging:** judge errors were mostly false negatives on verbose, correct answers, which hurt the large model more.
- **Sampling:** the V1 pool was the smallest mailboxes.
- **Split leakage:** EnronQA's train, dev and test splits share all 73,772 emails, so tuning and evaluation must be split **by mailbox**.

**Decisions Kerem made:**
- **Models:** the QAT ladder (`gemma3:1b-it-qat`, `gemma4:e2b-it-qat`, `gemma4:e4b-it-qat`, `gemma4:31b-it-qat`), plus a V1 bridge on `gemma4:e2b` (Q4_K_M).
- **Midpoint:** add e4b.
- **No human audit.** The judging is strengthened instead: two judges, an evidence-grounded adjudicator, machine-verified quotes, a non-LLM span anchor, and a drift anchor set.
- **Judges:** J1 `gpt-oss:20b-cloud`; J2 `nemotron-3-nano:30b-cloud` ("for speed"), with graceful handling if cloud credits run out.
- **Margin:** non-inferiority at ±5 points.
- **Energy:** LibreHardwareMonitor (CPU package) plus nvidia-smi (GPU), labelled a lower bound.
- **Run length:** the PC can run about 20 h, so the two planned nights merged into one continuous run.
- **Subagents:** lighter models (Sonnet) for mechanical tasks, the strongest model for judgement.
- **Downloads** were approved (parquet files, packages, nomic-embed-text, gemma3:1b).
- **Autonomy:** "you are on your own… fix and continue… till you fully complete the task".

**Built in about a day on the Mac:**
- the full pipeline (see `study-design.md`);
- 185 unit tests;
- two review passes by independent agents, which caught critical bugs: E\* would never have been selected, P-E\* would never have been graded, a cell-id spread bug, and the run not stopping at the stop time;
- a `gemma3:1b` smoke test;
- a byte-identical determinism check of `prepare`.

**Found during the build:**
- The Ollama Cloud account is on the **free tier**: calls are serialised, J1 manages about 0.37 calls/s, and the third-family adjudicators (deepseek, mistral) return HTTP 402.
- The run was redesigned so the GPU never waits for DEV grading.

## 22–23 September: the V2 run (Windows)

- **Timing:** started 2026-09-22 12:45 UTC and finished `complete` at 2026-09-23 02:09 UTC, all 7 stages.
- **Output:** 27,644 answers in 13.3 h of generation, with one transient error and 106 at the output cap.
- **Time rule:** all four optional 31b secondaries were admitted.
- **Probe decisions:** `num_predict` 160 for all models; tiny kept; the overflow check passed (`truncate:false` honoured).
- **E\* selection:** k5-bestlast-R0 (BM25, k=5, best result placed last), selected on DEV by J1. k5-bestlast-R2 was 0.25 pts higher, but within the 2-point tie margin, so the tie-break chose the config closer to B.

## 23 September: grading

Kerem asked whether paid DeepSeek V4.1 Flash made sense for grading.

**The decision:** move all TEST grading to **OpenRouter**, for under $5 and with speed a priority:
- J1 `openai/gpt-oss-20b` (the same model on a different host);
- J2 `nvidia/nemotron-3-nano-30b-a3b`;
- adjudicator `deepseek/deepseek-v4.1-flash` (restoring the pre-registered third family).

This is recorded as a deviation in `PREREG.md`. DEV verdicts from the run stand, and E\* is not re-selected.

**Fixes needed to make it work:**
- exclude reasoning from responses (it broke JSON parsing and was billed);
- a plain-format retry;
- sorting providers by throughput, which took J1 from 0.5 to 19 calls/s.

**Result:** 15,463 J1, 12,323 J2 and 5,924 adjudication calls in 23 minutes, with zero errors, for **$4.57**. (Throughput sorting routes to pricier hosts, which is why that is above the $2.5 token estimate.)

## 23 September: results, and one correction

- The report was generated; see `results.md`.
- An independent review found that tier-B cells (grid and exploratory) had been compared against the *adjudicated* baseline, although they are scored by J1 alone. That made their deltas about 4 points too negative. This is fixed, and the ladder no longer shows the J1-only grid cell as R\*. Confirmatory results were not affected.

## 23 September: the agent arm

Kerem proposed testing an agentic loop: the model decides its own tool calls for up to 5 rounds, which separates prompting, evaluation and looping skills.

**His choices:**
- all four models;
- a round is one action, and OPEN takes up to 3 emails;
- global search scope;
- thinking arms for e2b and e4b only;
- all 600 questions the 31b answered, within about 18 h;
- enriched ordering (BM25 misses first);
- a pre-registered extension with three hypotheses.

**Where it stands:** built, pre-registered (`PREREG-AGENT.md`), smoke-tested, pushed, **not yet run**. Details are in `agent-arm.md`.

## 23 September: the index factor for the agent (approved, not built)

Kerem's point: in the fixed pipeline every model got the same query, so the index effect was the same for all of them by construction. With model-written queries, wording and index can interact, and since the study is about indexing, the agent should be tested on all three indexes.

**His choices:**
- BM25 + dense + hybrid (RRF);
- the same neutral tool text for all;
- the 31b on the core 200 for dense and hybrid, extended only if time allows;
- a raw-question-first control for e2b on each index.

The design is in `agent-arm.md`. It was approved but not built when this folder was written.
