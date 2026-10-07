# Exploration journal: adaptive e2b accuracy search

Procedure: `explore-plan.md`. Code: `benchmarks/premise2/explore/`. Answers, verdicts and spend: `.data/premise2/explore/` (not committed). Summaries: `benchmarks/results/premise2/explore/`.

Accuracy here is J1-only and design-weighted to the pool's true miss share unless stated. J1 runs about 4 points below adjudicated scores, so these numbers are not comparable with the main study's adjudicated table.

## Setup (Sat 3 Oct 2026, evening ET)

- Data backed up to `C:\Users\Kerem\backups\premise2-20261003` (2.9 GB, 38 files, same disk: the box has only C:).
- Branch `premise-explore` from `codex/overnight-word-overlap` (b24dd38).
- Box state: Ollama 0.34.2 with model digests matching the main run. The Ollama app had `auto_update_enabled=1` with v0.35.1 staged (Kerem asked to switch it off). `.env` had no OpenRouter/judge variables (Kerem asked to add them). Generation can proceed without them; grading waits.
- Pool guard (`pool.js`): refuses questions outside the 30 tuning mailboxes, any whose gold, twins or near-duplicates are a TEST, retrieval-only or bridge email or twin, and the 397 DEV questions; also excludes DEV emails and their twins, and V1 pilot emails. The twin rule is strict: a candidate is dropped if any of its twins/near-duplicates is a forbidden path.
- Pre-existing test failure unrelated to this work: `tests/premise2/indexes.test.js` end-to-end case fails under `node --test` on this box (`ERR_WORKER_INVALID_EXEC_ARGV`: the test runner's exec flags are rejected by the BM25 worker threads).

## Pool (frozen Sat 3 Oct 23:03 ET)

- 37,336 questions from 14,375 emails of the 30 tuning mailboxes (20,102 dev-split, 17,234 test-split). Pool hash `d403c1f9bc3d…`.
- Exclusions: unanswerable gold 327, gold not in corpus 744, DEV questions 397, other questions on DEV emails 957, DEV twins 256, V1 emails 63, forbidden (TEST/retrieval/bridge) emails 569, forbidden twins/near-duplicates 4,699, over token cap 1,159.
- **True miss share 6.80%** (2,539 misses: no answer-bearing email in frozen BM25 global top 5). Answer recall@5: global 93.2%, per-mailbox 95.6% (lower than TEST's 95.5% / 98.1%).
- Where the misses' answers are: global top 10 for 758 (30%), global top 20 for 1,284 (51%); **per-mailbox top 5 for 906 (36%)**, per-mailbox top 20 for 1,867 (74%). Per-mailbox top 5 loses the answer on only 24 of 34,797 hits. So scope plus depth (with a selection step against distraction) is the most promising lever for misses.
- Sets drawn: S100-0, FULL-0 (600: 150 miss / 450 hit), S100-1, S100-2. Sets never share a question, an email or a twin group.
- Timing caveat: Ollama's prompt cache can make a variant whose first prompt equals an earlier P-B prompt look cheaper. P-B runs first on every set, so baseline times are clean; a finalist will be re-timed on fresh questions.

## Round 0 (started Sat 3 Oct 23:15 ET)

Runs: e2b P-B, E*, frozen A-agent on S100-0 and FULL-0; 31b P-B on FULL-0 (in-pool target). Results pending J1 grading (OpenRouter keys not yet on the box).

## Round 1 (generated overnight with round 0, on S100-1)

Variants (all e2b, num_predict 160 unless stated), hypothesis → failure bucket targeted → expected effect:

| id | what | targets | expected |
|---|---|---|---|
| pbu | P-B over the asker's mailbox only | never found (misses) | misses +15–30, hits ≈0 |
| rrfu | RRF of mailbox and global BM25, top 5 | never found | between pb and pbu on misses, safer on hits |
| sel5 | model picks ≤2 of the top 5, answers from those | distracted on hits | hits +2–4 |
| sel10u | picks ≤2 of mailbox top 10 | both (depth + scope, selection against distraction) | misses +20, hits ±2 |
| quote | quote the supporting line, then answer (320 tokens) | distracted / read wrong | hits +1–3 |
| qx | e2b keywords fused with the raw query (RRF) | never found | misses +5 |
| fba | P-B; tools (4 rounds) only after it abstains | misses where it abstains | misses +, hits = pb |
| fbb | P-B emails pre-opened, tools from turn 1 | misses | misses +, hits risk |
| auto2 | agent; each search auto-opens its 2 best new results | shown not opened | far above the frozen agent; below pb |

## Incident: Ollama auto-update (Sat 3 Oct 23:07 ET)

- The Ollama app updated itself to 0.35.1 and restarted the server during the S100-0 E* run. 8 E* calls failed during the restart (http_error, retried later); 6 E* answers were generated on 0.35.1 before the queue was stopped. Those 6 were moved to `answers-quarantine-ollama0351.jsonl` and are never used. The remaining queue steps refused to start (preflight version check).
- Reinstalled the official 0.34.2 installer (SHA-256 8c9eb7ba…a8b, matching GitHub's published digest) silently over 0.35.1; set `auto_update_enabled=0` in the app's settings database. Version 0.34.2 confirmed; the runner re-checks model digests against the main run on every start.
- The runner now also re-checks the Ollama version every 25 questions and aborts on a change, and stores the version on every answer.

## Round 0 partial: S100-0 e2b P-B (J1)

- e2b P-B: **84.4% weighted** (hits 90.0%, misses 8.0%), matching the expected ~84% J1. Wall 645 ms/question → cost cap 5× ≈ 3.2 s/question (to be fixed on FULL-0).
- On the 50 misses: 31 wrong answers with no answer-bearing email in context, 15 abstentions ("NOT IN EMAILS"), 4 correct. On hits: 5 wrong with the evidence in context.
- J1 cost: 153 calls for $0.0028 (≈$0.02 per 1,000 calls; gpt-oss-20b at $0.018/M in, $0.09/M out). Grading cost is not a binding constraint for J1 screening.

## Round 0: S100-0 complete (J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| pb | 84.4 | – | 8.0 | 90.0 | 645 |
| estar | 76.8 | −7.6 [−17.2, 1.9] | 6.0 | 82.0 | 645 |
| agent (frozen) | 36.5 | −47.9 [−61.5, −33.1] | 16.0 | 38.0 | 924 |

The main study's pattern reproduces inside the pool: E* below P-B, and the frozen agent about 48 points below, failing mostly by not opening the answer email (agent buckets: shown-not-opened 6 miss / 21 hit).

## Round 1 results (S100-1, Sun 4 Oct ~00:00 ET, J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | Δmiss | Δhit | × pb wall |
|---|---|---|---|---|---|---|---|
| sel10u | 87.1 | +10.2 [2.4, 18.3] | 48 | 90 | +40 | +8 | 1.65 |
| pbu | 86.7 | +9.8 [1.7, 18.3] | 42 | 90 | +34 | +8 | 0.91 |
| rrfu | 84.5 | +7.5 [−1.8, 16.5] | 36 | 88 | +28 | +6 | 0.81 |
| sel5 | 84.4 | +7.5 [−1.8, 16.2] | 8 | 90 | 0 | +8 | 1.17 |
| quote | 84.3 | +7.3 [−0.1, 15.8] | 6 | 90 | −2 | +8 | 1.46 |
| qx | 77.1 | +0.1 | 10 | 82 | +2 | 0 | 1.16 |
| pb | 77.0 | – | 8 | 82 | – | – | 1.00 |
| fba | 75.1 | −1.9 | 8 | 80 | 0 | −2 | 1.08 |
| auto2 | 73.4 | −3.6 | 10 | 78 | +2 | −4 | 1.42 |
| fbb | 68.1 | −8.9 [−17.0, −1.7] | 14 | 72 | +6 | −10 | 1.93 |

J1 spend for round 0 + 1: $0.021 cumulative.

Reading: P-B's hit accuracy on this draw (82%) is 8 points below S100-0's 90%, so a good part of every variant's +8 on hits is likely the baseline's bad luck; the hit gains need fresh questions. The miss gains are large and specific: mailbox scope takes misses from 8% to 36–48% correct. The model-in-the-loop designs did not help: the fallback agent (a) fell back on only 7 of 50 misses' abstentions and never recovered one (its never-found bucket grew); fbb lost 10 points on hits (opened emails it did not need); auto2 still showed-but-did-not-open on 15 questions.

Transcript observations (sel10u failures): (1) the selector often lists 3+ emails ("1, 2, 3", once seven); keeping only the first 2 sometimes discards the answer email at rank 3–5 → test keeping 3; (2) several J1 INCORRECT answers look right to a human reader ("Steve Couch Memorial Golf Tournament", "Candle Corporation", the Haas email address) — J1 strictness, common to all arms; (3) remaining miss failures are mostly true misses (answer email not in mailbox top 10).

Decisions: promote sel10u, pbu, rrfu, sel5, quote to S300-1 (all meet Δ ≥ +2 and hit ≥ −3; sel10u, pbu, rrfu also qualify as miss components). Kill qx, fba, fbb, auto2. Round 2 (S100-3; S100-2 skipped and kept spare) combines the winners: mailbox selection with 3 kept (sel10u3), mailbox top-5 selection (selu5), mailbox quote (quoteu), abstain cascades (casc: mailbox first; cascg: P-B first), and wide selection over 15 clipped candidates (selx).

## Round 0: FULL-0 complete (Sun 4 Oct 00:05 ET, J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| estar | 82.3 | +2.0 [−1.2, 5.3] | 4.0 | 88.0 | 645 |
| pb | 80.3 | – | 2.7 | 86.0 | 649 |
| agent (frozen) | 36.9 | −43.5 [−47.9, −38.2] | 12.0 | 38.7 | 906 |

- **Cost cap fixed: P-B mean wall 649 ms/question on FULL-0 → cap 3.25 s/question** (`benchmarks/results/premise2/explore/cost-cap.json`).
- E* is +2.0 here, −7.6 on S100-0 and −1.1 on TEST: its sign flips from set to set, consistent with no real effect.
- J1 spend so far: $0.143 (FULL-0 grading 1,325 calls, $0.12).

## Interruption (Sun 4 Oct ~00:05 ET)

Claude Code stopped the background queue (and its watcher) because the machine was critically low on RAM (6.3 GB free of 31 GB afterwards). The stop came after FULL-0 was graded and before round 2 (S100-3) generated anything; no partial answers. Per the harness rule the queue is not restarted without Kerem's go-ahead. Pending, in order: round 2 on S100-3 (pb, pbu, sel10u, sel10u3, selu5, quoteu, casc, cascg, selx), the S300-1 promotions (pb, pbu, sel10u, rrfu, sel5, quote), then 31b P-B on FULL-0. Script: `.data/premise2/explore/queue-2.sh` (drop its first wait loop).

## Correction to the interruption, and an overlap incident (found Sun 4 Oct ~10:45 ET)

- The harness stop killed the queue's shell but not its `node` children, so generation continued. Worse, two queues overlapped from 04:11 to 10:13 UTC: e2b round 2 (S100-3 pb, pbu, sel10u, sel10u3) and 31b P-B on FULL-0 ran at the same time, so Ollama swapped models on every call (`reloaded` is true on all 1,000 of those answers). Their wall times (31–74 s/question) are meaningless; their accuracy should be unaffected (temperature 0, fixed seed), which a replicate run (`pbrep`, identical to pb) on S100-3 checks. The 31b weights held mostly in system RAM (4.8 of 20.5 GB in VRAM) are the likely cause of the low-memory stop.
- The restart queue (`queue-3.sh`) found these runs finished, ran the oracle diagnostic and pbuthink, and graded. Node heap is now capped at 8 GB.

## Round 2 results (S100-3, J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| oracle (diagnostic: gold email only) | 93.3 | +5.6 [0.6, 11.4] | 84 | 94 | 310 |
| cascg | 90.3 | +2.5 [0.3, 6.7] | 12 | 96 | 665 |
| sel10u | 89.1 | +1.4 [−5.5, 8.2] | 50 | 92 | (overlap) |
| sel10u3 | 89.0 | +1.3 [−5.4, 7.8] | 48 | 92 | (overlap) |
| pb | 87.7 | – | 2 | 94 | (overlap) |
| selu5 | 86.5 | −1.3 | 38 | 90 | 740 |
| quoteu | 82.7 | −5.0 | 38 | 86 | 929 |
| casc | 81.0 | −6.7 | 40 | 84 | 741 |
| pbu | 79.1 | −8.6 [−16.7, −0.8] | 40 | 82 | (overlap) |
| selx | 78.9 | −8.9 | 36 | 82 | 1,038 |
| pbuthink | 78.9 | −8.9 | 36 | 82 | 3,694 (over the cap) |

Reading: on this draw pb's hits are 94%, equal to the oracle's, so the hit side has no headroom here and every variant that changes the hit context loses some. pbu, +9.8 on S100-1, is −8.6 here: hit-side swings of ±10 points on 50 hits are mostly noise from changing which five emails are shown. The oracle bounds what retrieval alone can buy on this set: +5.6, almost all from misses. Decisions: promote cascg to S300-1 (Δ ≥ +2, hit +2). Kill pbuthink (over the cost cap and no gain), casc, selx, quoteu. sel10u3 is no better than sel10u.

## S300-1 results (J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms | × pb |
|---|---|---|---|---|---|---|
| pbu | 79.8 | +2.2 [−1.7, 5.6] | 36 | 83.0 | 638 | 1.01 |
| quote | 79.6 | +1.9 [−4.3, 8.9] | 5 | 85.0 | 923 | 1.46 |
| sel10u | 79.4 | +1.8 [−3.2, 6.8] | 44 | 82.0 | 1,093 | 1.72 |
| rrfu | 79.1 | +1.4 [−1.3, 4.2] | 32 | 82.5 | 695 | 1.10 |
| sel5 | 78.1 | +0.5 [−4.6, 5.6] | 4 | 83.5 | 745 | 1.18 |
| pb | 77.6 | – | 4 | 83.0 | 634 | 1.00 |

No variant meets the FULL rule (Δ ≥ +1.5 and lower bound > −1.5); pbu is closest (lower bound −1.7). The consistent part of every mailbox variant is the miss gain (+28 to +40 points on misses, worth about +2 to +2.7 weighted at the 6.8% miss share); the hit effect averages about zero but adds noise.

## 31b P-B on FULL-0 (in-pool target, J1)

31b P-B: **87.4** (hits 93.6, misses 3.3) vs e2b P-B 80.3: a 7.1-point gap, almost all on hits. On the 450 FULL-0 hits, 31b is right where e2b is wrong 48 times and the reverse 14 times. Reading those 48: mostly e2b answering from the wrong one of the five emails (the wrong governor, phone number, date or person) or giving a partial list. 31b also abstains on 94 of 150 misses, where e2b mostly answers wrong.

## Round 3 plan (S100-4 and diagnostics)

Offline screen (gold or twin in context, frozen BM25 lists, every 4th pool question): pb hit 97.3 / miss 0; pbu 97.9 / 32.6; header-match rerank (no model call) global top 5 95.6 / 12.1, mailbox top 5 96.6 / 38.5; pbfill 97.9 / 32.6; pb3 94.3 / 0. Header reranking pushes the gold down on hits, so the global header variants are dropped. Runs: S100-4 pb, pbrep, pbfill (P-B's context, with other mailboxes' emails swapped for the asker's best unseen ones: same as P-B when all five are the asker's, so less hit noise), hdru, pb3 (fewer emails against distraction); S300-1 cascg; FULL-0 oracle (distraction ceiling on 450 hits); S100-3 pbrep (determinism check for the overlap runs).

## Round 3 results (J1)

**Determinism.** `pbrep` (an exact copy of pb) on S100-3, run hours after pb, matches pb on all 100 answers: the overlap runs' accuracy stands. On S100-4, run straight after pb (Ollama prompt cache warm, 305 ms vs 587 ms), it differs on one hit (−1.9 weighted). So cached-prefix evaluation changes about 1 answer in 100: a noise floor for every comparison, and another reason timing and close calls need fresh questions.

**Retrieval ceiling.** Oracle (gold email only) on FULL-0: **88.6** (hits 88.9, misses 85.3) vs pb 80.3. Even with perfect retrieval e2b reaches only about 31b P-B's 87.4; distraction costs at most about 3 points on hits (88.9 vs 86.0). The rest of the hit gap to 31b is e2b's reading.

S100-4:

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| hdru | 83.1 | +4.4 [−3.7, 12.9] | 44 | 86 | 581 |
| pb3 | 80.6 | +1.9 [−3.9, 8.6] | 6 | 86 | 461 |
| pbfill | 80.3 | +1.6 [−7.4, 10.5] | 30 | 84 | 623 |
| pb | 78.7 | – | 6 | 84 | 587 |

S300-1 cascg: 78.6, **+1.0 [0.5, 1.4]** (misses 18 vs 4, hits equal). A real but small gain, below the +1.5 FULL bar; it changes only questions P-B abstains on.

Decisions: promote hdru (Δ ≥ +2, hit +2, miss +38) and pbfill (miss component, +24) to S300-1. Drop pb3. Round 4 (S100-5) adds hdrud10 (header rerank of the mailbox top 10 only: offline hit recall 97.6 vs hdru's 96.6, miss 37.7), hdru6 (6 emails: 97.6 / 42.7) and hfill (pbfill with header-ranked spares).

## Round 4 results (J1)

S100-5:

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms | × pb |
|---|---|---|---|---|---|---|
| hdrud10 | 86.3 | +6.0 [−1.9, 16.1] | 36 | 90 | 472 | 0.75 |
| hdru | 84.7 | +4.4 [−3.0, 14.2] | 40 | 88 | 616 | 0.98 |
| hdru6 | 83.3 | +3.0 [−6.8, 14.2] | 46 | 86 | 529 | 0.84 |
| hfill | 82.6 | +2.3 [−3.1, 7.9] | 36 | 86 | 565 | 0.90 |
| pbfill | 80.9 | +0.6 [−3.7, 3.4] | 38 | 84 | 572 | 0.91 |
| pb | 80.3 | – | 2 | 86 | 628 | 1.00 |

S300-1 promotions:

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| **hdru** | **82.7** | **+5.0 [1.1, 9.2]** | 37 | 86.0 | 629 |
| pbfill | 80.0 | +2.4 [−1.0, 5.8] | 32 | 83.5 | 701 |

hdru is the first variant to meet the FULL rule clearly; pbfill meets it too (lower bound −1.0 > −1.5). hdru replicates across three sets (S100-4 +4.4, S100-5 +4.4, S300-1 +5.0), with hits never below pb's. Decisions: hdru and pbfill to FULL-0; hdrud10, hdru6, hfill to S300-1.

## FULL-0: hdru and pbfill (J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| hdru | 80.9 | +0.6 [−1.9, 3.1] | 42.0 | 83.8 | 648 |
| pbfill | 80.7 | +0.4 [−2.5, 2.8] | 35.3 | 84.0 | 716 |
| pb | 80.3 | – | 2.7 | 86.0 | 649 |

On 600 questions the mailbox variants keep their miss gain (+33 to +39 points) but lose about 2 points on hits, netting about +0.5. Their S300-1 hit gains were luck: pb's S300-1 hits (83%) are low, and S300-1 has now been reused for many comparisons. Conclusion: switching every question to the mailbox context trades a reliable miss gain for a small hit loss.

## Round 5: gating the switch (S100-6)

Offline screen for a no-model miss signal: "the global top 1 is from another mailbox" flags 51.6% of misses and 5.2% of hits (estimated +1.3 weighted vs +0.6 for always switching). `gate` uses hdru's context when that holds, else P-B's; `gatea` also retries an abstention once on the other context.

**Run-to-run nondeterminism.** Re-running identical prompts changes about 30% of e2b's answer texts (S100-6 pb: 32 of 100; hdru 34; gate 33; S100-4 pbrep 27), with or without a model reload, and flips about 2–6 verdicts per 100. (S100-3's pbrep matched pb on all 100; there pb ran with a reload before every call.) The paired bootstrap resamples questions, so this per-question noise is inside the CIs, but it makes S100 hit-side differences of ±2–4 points meaningless. The runner now reloads the model before each variant and stores those answers as version `<v>+cold`. This rules out cross-variant prompt-cache reuse; it does not remove the nondeterminism.

S100-6 (cold reruns): hdru +3.9 [1.1, 8.0], gatea +2.0 [1.0, 3.1], gate +1.6 [0.7, 2.5], cascg +1.4 [0.5, 2.2]. Promote gatea (Δ ≥ 2) and gate (miss component).

S300-1: **gatea +1.8 [0.2, 3.5]** (miss 31, hit 83.0 = pb), gate +1.3 [−0.1, 2.4]. gatea meets the FULL rule. hdru6 (+4.5 [0.6, 8.3]), hdrud10 (+4.2 [0.4, 7.9]) and hfill (+4.4 [0.3, 8.9]) also met it in round 4 and go to FULL-0 with gatea.

## FULL-0: gatea and the round-4 qualifiers (J1)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms | × pb |
|---|---|---|---|---|---|---|
| **gatea** | **83.4** | **+3.1 [2.2, 4.0]** | 36.0 | 86.9 | 738 | 1.14 |
| hdrud10 | 82.5 | +2.2 [−0.4, 4.8] | 41.3 | 85.6 | 655 | 1.01 |
| hfill | 81.9 | +1.6 [−1.2, 4.0] | 38.0 | 85.1 | 723 | 1.11 |
| hdru6 | 80.3 | −0.0 [−2.6, 2.8] | 42.0 | 83.1 | 711 | 1.10 |
| pb | 80.3 | – | 2.7 | 86.0 | 649 | 1.00 |

**New champion: gatea**, +3.1 points with a tight interval: it leaves about 95% of hit contexts as P-B's and takes the mailbox gain on half the misses.

Offline, more retrieval-structure gate signals (mailbox #1 not in global top 5 or top 10, own-mailbox count, distinct mailboxes) add no misses beyond "global top 1 from another mailbox" without pulling in many hits; the gate signal is saturated.

## Round 6 (S100-7, Sun 4 Oct ~13:00 ET)

| variant | weighted | Δ vs pb [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| gates (gatea + question also before the emails) | 89.5 | +11.0 [−0.2, 25.0] | 28 | 94 | 753 |
| gatec (gatea + third try on unseen mailbox emails) | 83.8 | +5.2 | 26 | 88 | 777 |
| gatea | 83.5 | +5.0 [0.7, 13.5] | 22 | 88 | 750 |
| gateb (gatea, mailbox context from top 10) | 83.4 | +4.8 | 20 | 88 | 749 |
| pb | 78.6 | – | 4 | 84 | 663 |

gatec and gateb add nothing over gatea and are dropped. gates changes only the prompt: T2 with the question also stated before the emails (otherwise byte-identical to T2). On the same contexts it gains 6 hit points over gatea here.

S300-1: **gates +6.2 [0.4, 12.6] vs pb** (+4.4 [−1.2, 10.8] vs gatea; hits 87.5 vs 83.0). pbs (P-B with the same prompt, no gate) +3.8 [−2.0, 10.3]: below the FULL rule (lower bound −2.0), run on FULL-0 only as a diagnostic to separate the prompt effect from the gate effect; it is not eligible to win.

## FULL-0: gates (J1)

| variant | weighted | Δ vs pb [95% CI] | Δ vs gatea | miss | hit | wall ms | × pb |
|---|---|---|---|---|---|---|---|
| oracle (diagnostic) | 88.6 | +8.3 [5.3, 11.2] | | 85.3 | 88.9 | 308 | |
| **gates** | **86.8** | **+6.5 [4.2, 8.9]** | +3.4 [1.2, 5.5] | 37.3 | 90.4 | 752 | 1.16 |
| pbs (diagnostic) | 83.5 | +3.2 [0.9, 5.4] | +0.1 | 3.3 | 89.3 | 667 | 1.03 |
| gatea | 83.4 | +3.1 [2.2, 4.0] | – | 36.0 | 86.9 | 738 | 1.14 |
| pb | 80.3 | – | | 2.7 | 86.0 | 649 | 1.00 |

**New champion: gates**, 86.8, within 0.6 of 31b P-B's in-pool 87.4. The two effects add almost exactly: the prompt alone (pbs) +3.2, almost all on hits; the gated mailbox switch alone (gatea) +3.1, almost all on misses; both together +6.5.

## Round 7 (S100-8; FULL-0 diagnostic)

Oracle with the sandwich prompt (gold email only) on FULL-0: **91.5** (hits 92.2) vs 88.6 with T2. The prompt lifts reading itself, not only distraction, and the ceiling under perfect retrieval rises with it.

S100-8: gatesf (gates + "First find the email that answers the question, then answer from that email only.") +5.5 vs pb, +1.9 [0.0, 6.2] vs gates; gatesm (gates + a rule to use the email matching the question's people, subject and date) +3.8, +0.1 vs gates; gates +3.6. S300-1: gatesf +6.0 [0.6, 12.1] (−0.2 vs gates), gatesm +5.2 [0.1, 10.9] (−1.0 vs gates). Both meet the FULL rule against pb; FULL-0 decides, with the within-1-point rule favouring the simpler gates.

## Rounds 7–8 and the stop (Sun 4 Oct, afternoon ET)

FULL-0, against gates (86.8):

| variant | weighted | Δ vs pb [95% CI] | Δ vs gates [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|---|
| oracles (diagnostic: gold only, sandwich prompt) | 91.5 | +11.2 [8.0, 14.6] | +4.7 | 82.0 | 92.2 | 334 |
| gates | 86.8 | +6.5 [4.2, 8.9] | – | 37.3 | 90.4 | 752 |
| gates6 (6 mailbox emails when switched) | 86.7 | +6.4 [4.1, 8.8] | −0.1 [−0.3, 0.1] | 36.0 | 90.4 | 767 |
| gatesi (subject/sender index before the emails) | 85.6 | +5.3 [2.6, 8.2] | −1.2 [−2.9, 0.7] | 34.7 | 89.3 | 777 |
| gatesm (rule: use the email matching people, subject, date) | 85.5 | +5.1 [2.1, 8.2] | −1.4 [−3.5, 0.6] | 35.3 | 89.1 | 764 |
| gatesf (rule: find the answering email first) | 84.7 | +4.3 [1.6, 7.5] | −2.2 [−4.0, −0.2] | 36.0 | 88.2 | 762 |

Screening history: S100-8 gatesf +1.9 vs gates, gatesm +0.1; S100-9 gatesi +3.7 [0.0, 9.6] vs gates (hits 96 vs 92), gates6 +0.3; S300-1 gatesi +1.2 [−0.8, 3.4] vs gates. All four regressed to at or below gates on FULL-0: extra instructions and the index cost e2b a little reading accuracy. **Two rounds without a new champion: exploration stops** (Sun 4 Oct ~16:00 ET; spend $0.43 of $3.50).

## Freeze

- **Winner: gates** (gatea's gated mailbox switch with abstention retry, plus the sandwich prompt). FULL-0 86.8, +6.5 [4.2, 8.9] vs P-B; in-pool 31b P-B 87.4. Runner-up: gates6.
- Re-timed cold on the unused S100-2 (100 fresh questions, model reloaded): mean 759 ms (1.17× P-B; cap 3,243), p50 732, p95 1,200, max 1,523; 1.04 calls per question; one context overflow.
- No gates answer hit the 160-token output cap on FULL-0, so the TEST run uses the main study's num_predict 320.
- `benchmarks/premise2/PREREG-EXPLORE.md` written; `confirm.js` (TEST runner, tier-A grader, X1/X2 analysis) added. The runner refuses TEST unless the pre-registration is committed, clean, and names the current code hash of `explore/`, which was checked by running it before the file existed.

## Before the TEST run (blocked on the machine)

- **LibreHardwareMonitor is not running** (installed at `C:\Users\Kerem\hwMonitor\LibreHardwareMonitor.exe`; nothing on port 8085). It needs administrator rights and its remote web server on port 8085 for CPU package power. nvidia-smi works.
- **The main study's tier-A TEST verdicts are not on this box.** `.data/premise2/verdicts.jsonl` holds only 2,475 old J1 verdicts from `gpt-oss:20b-cloud`; the OpenRouter tier-A grading ran on the Mac. X1/X2 pair against those verdicts. The fallback (pre-registered, logged as a deviation): re-grade the unchanged comparator answers with the same tier-A procedure.

## Phase 2 (Sun 4 Oct, from ~16:40 ET; at Kerem's request)

The stop rule had fired and `gates` is frozen and pre-registered (tag `explore-checkpoint-gates`, commit ae287a5; PREREG-EXPLORE.md unchanged). Kerem asked for about six more hours of exploration with subagents, across one-shot, agent and hybrid methods. Phase 2 does not touch the frozen winner's code: new code lives in `benchmarks/premise2/explore2/` (the code hash of `explore/` is unchanged, `9801148b…`). A GPU lock (`explore2/lock.js`) serialises every generation and grading run from parallel workers. New sets: S300-2 (shared screening), S300-3 and FULL-1 (confirmation, lead only). Workers: retrieval (r), one-shot reading (o), agent/hybrid (a), multi-call methods (w), failure analysis (f); brief in `docs/premise-study/explore2/BRIEF.md`. If phase 2 finds a better method, it gets its own pre-registration addendum before any TEST run; `gates` stays the registered primary unless that addendum says otherwise.

### Phase 2, round 1 results (Sun 4 Oct evening)

Workers' notes: `docs/premise-study/explore2/{f,r,o,a,w}.md`. Findings: hits are at e2b's reading ceiling; e2b is deterministic in these runs (identical prompt, identical answer), so variant differences are prompt effects, but any change to a hit question's prompt flips about 5% of hit answers in a random direction. No single worker method reached +1.5 vs gates.

| variant | S300-2 Δ vs gates | S300-3 Δ | FULL-0 Δ [95% CI] | note |
|---|---|---|---|---|
| r5 (CE swap into slot 5, always) | +1.9 | +2.3 | **−0.8 [−3.1, 1.5]** (misses +10, hits −1.5) | hit gains on S300 were luck |
| r4 (swap only if CE close to global best) | +0.5 [0.2, 0.9] | +0.8 [−0.2, 1.8] | +0.4 [−0.4, 1.2] | changes few hit prompts |
| s1 (r5 + mailbox dedup) | +2.1 | +1.7 | – | |
| s2 (s1 + rules-last prompt) | −0.0 | +1.4 | – | |
| s3 (s1 + a5 escalation) | +2.3 [0.0, 4.6] | +2.0 | – | |
| a5 (guarded list-pick escalation) | +0.4 [0.2, 0.6] | +0.6 [0.2, 1.0] | – | never changed a hit answer |
| w7 (YES/NO probe reorder, 18.7 calls) | +0.7 | – | – | 2.55 s |
| o4 / o12 (prompt layout / + dedup) | +0.7 / +0.9 | – | – | |
| a3 / a2 (harness-driven pick agents) | −2.3 / −3.5 | – | – | wrong picks on hits |

Design principle adopted: lasting gains are miss-side changes that leave hit prompts unchanged. Next: s4/s5 (r4 + a5 [+ dedup]) on FULL-0; round-2 workers g, k (agent gap), h (hybrid), p (one-shot), n (new methods).

### Phase 2, round 2 results (Mon 5 Oct, to ~05:30 ET)

Workers: g (native function-calling agents), k (commit-check agents), p (one-shot swap trigger), n (logprobs and new methods), h (probe hybrids); notes in `docs/premise-study/explore2/{g,k,p,n,h}.md`. Confirmation by the lead at queue priority 0. FULL-1 (600 questions) is the cleanest test: no variant, `gates` included, had been run on it. FULL-0 favours `gates`, which was chosen partly on FULL-0 in phase 1 (its hit score there is 90.4 against 87.5–89 on every other set).

Δ vs `gates` (weighted J1; 95% paired cluster bootstrap CI where shown):

| variant | kind | S300-2 | S300-1 | S300-3 | FULL-0 | **FULL-1** | wall ms | calls |
|---|---|---|---|---|---|---|---|---|
| **k3** (commit-check agent) | agent | +1.1 | +2.7 | **+3.2 [1.4, 5.2]** | +0.5 [−0.8, 1.9] | −0.1 [−1.6, 1.4] | ~1,200 | ~4 |
| **g5** (native-tools agent) | agent | −0.2 | +2.1 | +3.4 [−0.2, 7.1] | −2.2 [−4.6, 0.2] | +0.6 [−2.0, 2.7] | ~1,490 | ~3.9 |
| **x1** (k3 commit check; unsure answers → g5 agent) | agent | +1.1 | **+3.8 [0.9, 6.9]** | **+2.3 [0.2, 4.3]** | +0.6 [−1.2, 2.6] | **+1.3 [−0.4, 2.9]** | ~1,770 | ~5.4 |
| **p3** (triggered 2-email swap) | one-shot | +0.7 [0.4, 1.0] | +1.0 [0.3, 1.7]* | +0.4 [−1.0, 1.3] | (trigger fitted on it) | **+1.0 [0.3, 1.7]** | ~1,320 | 1.0 |
| g10 (logprob gate → g5) | hybrid | +1.6† | +1.8† | +1.3 [−0.3, 2.9] | −1.0 [−2.7, 0.8] | – | ~1,400 | 2.6 |
| n-g5 (logprob gate → r5) | hybrid | +1.4 | +1.6 | +0.6 [−0.8, 2.1] | −0.3 [−2.0, 1.3] | – | ~1,200 | 1.4 |
| h4 (r4 + YES/NO probe escalation) | hybrid | +0.5 | +1.6 | – | – | – | ~2,000 | ~6 |

\* S300-1 was in p3's trigger training data. † simulated from stored answers.

Absolute weighted scores on FULL-1: x1 86.0, p3 85.7, g5 85.3, gates 84.6, k3 84.6.

**Agentic gap.** The frozen plain-text e2b agent scores 36.9 on FULL-0 (main study TEST: 40.0; 31b agent 75.8). The two new e2b agents, where the model writes its own queries and decides what to read and when to answer, score at `gates` level on every set (FULL-0: k3 87.4, g5 84.7; FULL-1: g5 85.3, k3 84.6). In both, the gain over `gates` comes from misses (+9 to +12 points). Their hits stay at e2b's reading ceiling, so the gap was the interface, not the model:
- **g5:** native function calling, with the top 3 search results shown in full. The gold email reaches full text in 91% of episodes, against 41% opened by the frozen agent.
- **k3:** a per-email YES/NO commit check that stops at the first YES. Otherwise the model picks from a list and runs its own search; it picks the shown gold 68–80% of the time.

**Other findings:**
- e2b's mean token logprob separates its confident answers (about 95% right on hits) from unsure ones (70–75%, where any prompt change flips about 50:50). As a gate it did not survive confirmation: the −0.1 threshold was tuned on the screening sets.
- Decision calls that share the answer prompt's prefix perturb later answers through Ollama's prompt cache (k2, h4). Decision prompts should not share the answer prompt's prefix.
- Gates-start agents, which see `gates`' full context first, almost never search or open another email: safe but useless.


**x1 (fusion worker, Mon 5 Oct morning)** is the best method found in phase 2 and the only one ahead of `gates` on all four sets where the comparison is fair. Pooled over the 1,500 questions in S300-1/2/3 and FULL-1 it is about +2.0 against `gates`. How it works:
1. The harness makes the first search (`gates`' contexts). e2b checks each email with a YES/NO prompt and stops at the first YES (78–80% of questions).
2. On a YES, it answers with `gates`' prompt. If that answer is confident (mean token logprob ≥ −0.1, worker n's gate), it stands. If not, the question goes to the g5 native function-calling agent (33–35% of questions).
3. With no YES, it runs k3's explore step: a cross-encoder-ordered list pick, its own search, up to 3 opens.

Pooled vs k3 it is +0.5 (the g5 handover's flips nearly cancel). What it reliably does is keep `gates`' confident hit answers. When the gold email is shown, it ends up in the final reading context 93–94% of the time; the frozen agent opened it 41%. x2 (k3 starting from p3's swap context) and x3 (doubted YES keeps exploring) did not beat it. False-YES stops are detectable from the YES logprob (AUC 0.73), but a better email is rarely found afterwards.
So it is an agent in which the model makes every stop/search/read decision. Its gain comes mainly from misses (FULL-1 miss 42.7 against 29.3; hits 89.1 against 88.7). Cost is about 1.8 s and 5.4 calls per question (cap 3,243 ms). FULL-0 (favours gates): +0.6 [−1.2, 2.6] (87.4 vs 86.8). Pooled over all five sets (2,100 questions): about +1.6. Code: `explore2/variants/x-*.js`, notes `docs/premise-study/explore2/x.md`.

### Round 3 (Mon 5 Oct evening – Tue 6 Oct): agent ablation ladder and null results

**Ablation ladder** (worker t; J1 weighted, pooled over S300-2 and S300-1; step Δ vs the previous rung, paired bootstrap CI; `docs/premise-study/explore2/t.md`):

| # | rung | component added | pooled (miss / hit) | step Δ [CI] | wall ms | calls | gold read when shown |
|---|---|---|---|---|---|---|---|
| 0 | frozen agent | plain-text SEARCH/OPEN/ANSWER protocol | 39.2 (11.5 / 41.3) | – | 946 | 2.9 | 44% |
| 1 | t1 | native tool calls | 56.3 (16.0 / 59.3) | **+17.1 [12.3, 22.6]** | 869 | 3.0 | 63% |
| 2 | t2 | top-3 search results in full text | 79.4 (13.0 / 84.3) | **+23.1 [18.2, 28.1]** | 974 | 3.0 | 86% |
| 3 | t3 | separate sandwich answer call | 81.3 (13.5 / 86.3) | +1.9 [−1.2, 4.4] | 1,430 | 4.0 | 86% |
| 4 | g5 | asker's-mailbox search + small-model fixes | 85.4 (43.5 / 88.5) | **+4.1 [2.0, 6.9]** | 1,477 | 3.8 | 91% |
| 5 | g2 | harness runs the first search | 84.7 (39.0 / 88.0) | −0.8 [−2.1, 1.2] | 1,656 | 2.7 | |
| 6 | k1 | per-email YES/NO commit check + list-pick explore | 85.7 (47.0 / 88.5) | +1.0 [−0.2, 2.9] | 1,241 | 4.3 | 97% |
| 7 | k3 | cross-encoder-ordered pick list | 86.4 (47.0 / 89.3) | +0.7 [0.0, 1.4] | 1,273 | 4.2 | 97% |
| 8 | x1 | logprob handover of unsure answers to g5 | 86.9 (48.0 / 89.8) | +0.5 [−0.9, 2.1] | 1,910 | 5.5 | 93% |
| ref | gates | no agent | 84.5 (32.5 / 88.3) | | 759 | 1.0 | |

Reading: of the ~48-point gap between the frozen e2b agent and x1, ~40 points are the interface (native tool calls +17: the model opens emails instead of answering from snippets; full text of the top results +23), ~4 retrieval scope (mailbox search, all on misses), ~2 the separate answer call, ~2 agent control (only the per-email commit check is near-reliable; CE list and handover are noise-level). x1 is byte-identical on re-run (600/600); its variation comes from call-sequence/prompt-cache effects (the g5 sub-agent inside x1 matches its standalone answers on 61/104). x1 wall: mean 1,910, p50 1,939, p95 3,634, max 5,361 ms; calls mean 5.5, max 14. Simplified forms: t-lx (x1 without model-written search and opens 2–3) −0.1 vs x1 at −13% wall; t-lk (commit check + one list pick, no handover) −0.8 at −38% wall.

**Null results** (no promotion; Δ vs x1 pooled over S300-2/S300-1):
- j2, re-reading the YES email alone when unsure: about +0.5. j's taxonomy of 84 wrong x1 hit answers: 23 wrong fact/relation from the right email (the e2b reading limit), 15 incomplete, 12 judge strictness on correct-looking answers (not addressed: fixing them would be judge-gaming), 10 wrong email, and smaller classes.
- z, thinking mode / quote-verified JSON extraction on x1's unsure half: −1.4 / −0.9. All readings fail on the same questions; e2b quotes the right email verbatim on 96% of hits, so hit errors are misreadings, not grounding failures.
- e, ensembles: agreement cannot select between two answers (g5 vs gates disagreements: 67 vs 69 right). e1 is about +0.15.
- m, miss-side recall (m1/m2/m3): YES/NO recovery probes down a snippet-CE list of the asker's mailbox when x1's first YES is unsure (token logprob < −0.1).
  - Δ vs x1: m1 +0.1 / +0.0, m2 −0.1 / **+0.3 [0.1, 0.7]**, m3 +0.4 [0.1, 0.9] / +0.0 (S300-2 / S300-1).
  - Pooled about +0.1 to +0.2.
  - On S300-2 the false-stop golds sit deep (8/27 beyond mailbox rank 100), so the probes have nothing to find. On S300-1 the recovered emails were answer-bearing on 11 of 18 misses, but that is only about +5 to +7 misses per 100. Notes: `explore2/m.md`.

Round 3 ends with no promotion: nothing beat x1 by the +1.0 bar.

### Round 4 (Tue 6 Oct, 16:50–19:30 ET)

The PC restarted around 10:30 ET. All round-3 runs had already finished, so nothing was lost. I restarted Ollama 0.34.2 with `ollama serve`; auto-update is still off and the digests match.

Round 4 has three workers:
- **y** stacks j2 and m2 on x1 and on t-lx.
- **h** works on hit-side reading on x1's unsure-commit (handover) path.
- **v** builds the final pooled tables and the cost/accuracy frontier offline.

The lead confirms t-lk (the minimal agent) on S300-3 and FULL-1.

**t-lk confirmation (lead, J1).** t-lk is the minimal agent: a YES/NO commit check over gates' first context and one pick from the CE-ordered list, with no model search and no handover.

| set | t-lk | Δ vs gates | Δ vs x1 | miss / hit | wall ms | calls |
|---|---|---|---|---|---|---|
| S300-3 | 85.3 | +1.6 [−0.3, 3.6] | −0.7 [−2.9, 1.4] | 34.0 / 89.0 | 1,185 | 3.5 |
| FULL-1 | 84.8 | +0.2 [−1.1, 1.7] | −1.1 [−3.0, 0.7] | 38.3 / 88.2 | 1,193 | 3.3 |

FULL-1 has 599 graded answers; one answer was a technical error.

Summary over four sets (S300-2, S300-1, S300-3, FULL-1):
- t-lk vs x1: −0.8, −1.6, −0.7, −1.1.
- t-lk vs gates: +1.0, +2.2, +1.6, +0.2.

So the minimal agent keeps about half of x1's gain over gates at about two thirds of x1's wall time. The handover and the model-written search are worth about 1 point together. Grading spend: $0.644 so far.

**Where x1's gain comes from** (lead, offline, `explore2/tools/lead-paths.js`; 5 sets, 2,100 questions, same questions as gates):
- **Hits: x1 ≈ gates on every path**, about +10 questions over 1,500 hits.
- **Misses: almost all of the gain is the explore "found" path.** When no first-context email gets a YES and the agent finds one, x1 is right on 74 misses where gates is wrong, and wrong on 6 where gates is right.
- **Remaining hit errors vs the gold-only oracle** (FULL-0) concentrate on the unsure-commit → g5 handover path: 108/128 vs 115/128.

**Round 4 worker results** (J1; Δ vs x1 pooled over S300-2 + S300-1 unless stated):
- **h (hit-side reading on the handover path):** h7 (j2 + a re-ask for the specific item when the answer is vague) +0.3, h8 (+ answer from the YES-marked emails only) +0.4 at 1,929 ms. Both are −0.2 vs j2. e2b quotes the sentence around the asked item instead of naming it, and 73% of these questions have a single YES email, which j2 already covers. The 15 handover hit errors left after j2 are mostly e2b reading limits. Notes: `explore2/h.md`.
- **y (stacking j2 and m2):**
  - y1 = x1 + m2 + j2: **+1.07 [−0.3, 2.4]** (S300-2 +1.4, S300-1 +0.7), 88.0 weighted, +3.5 [1.7, 5.4] vs gates, 2,280 ms (p95 4.45 s), 6.7 calls.
  - y2 = the same on t-lx: +0.97 [−0.4, 2.3] at 2,152 ms.
  - The two add-ons add up with no interference. About +0.84 is mechanism: j2's hit gains, all on S300-2, and m2's miss gains, all on S300-1, the set m2's rule was chosen on. About +0.23 is re-roll luck on unchanged paths.
  - Fresh replicate (S100-4 + S100-5, 200 questions, x1 and y1 in the same command): y1 −0.66 [−2.5, 0.5]. The miss-side recovery held (+5/−1), the hit-side re-read was null, and one g5 re-roll set the sign. Over all 800 paired questions: +0.74 [−0.1, 1.8].
  - Engineering note: on S300-2 the stack moved Ollama's prompt cache onto a different trajectory after question 13, even though the calls within each question were identical to the parents'. Unchanged-path answers were re-rolled at 17–50%, netting zero. Offline simulation from stored parent answers cannot predict this. Notes: `explore2/y.md`.
- y1 formally meets the promotion bar (point estimate ≥ +1.0 within the cap), so the lead runs it on S300-3 and FULL-1 (§2 of the addendum draft: not negative on both).

**y1 confirmation (lead, J1; Δ vs x1 and gates on the same questions, paired stratified bootstrap from `explore2/tools/y-table.js`):**

| set | y1 | Δ vs x1 | Δ vs gates | miss / hit | wall ms (p95) | calls |
|---|---|---|---|---|---|---|
| S300-3 | 83.9 | −2.1 [−5.1, 0.9] | +0.2 [−3.4, 3.8] | 42.0 / 87.0 | 2,138 (4,362) | 6.3 |
| FULL-1 | 86.2 | +0.2 [−1.2, 2.4] | +1.6 [−0.5, 3.5] | 46.0 / 89.1 | 2,203 (4,431) | 6.4 |
| both (900) | 85.5 | **−0.5 [−1.6, 1.6]** | +1.2 [−0.7, 3.4] | 44.4 / 88.5 | 2,181 | 6.4 |

By mechanism, over every set y1 ran on (S300-2, S300-1, S100-4/5, S300-3, FULL-1; 1,700 paired questions):
- **m2's recovery** (YES/NO probes down the asker's mailbox list when the first YES is doubted) is consistently right on misses: +9/−1 on the screening and replicate sets, +6/−2 on S300-3, and +5/−1 on FULL-1. That is about +16 net misses. With misses weighted at 6.8%, it is worth about +0.2 weighted points.
- **j2's re-read** (re-reading the YES email alone when the committed answer is unsure) is null on hits: +4/−1 on screening (all on S300-2), +1/−4 on S300-3, and +2/−2 on FULL-1. j2's round-3 gain of +0.55 was a fluke specific to S300-2.
- Paths whose logic is unchanged re-roll at roughly ±2 hits per set and net out to zero.

**Decision: no successor. x1 stays the phase-2 arm.** y1 is negative vs x1 on S300-3 and on the 900 confirmation questions pooled, so it fails rule 3 of the draft's §2. Round 4 ends with no promotion.

t-lk FULL-1 stays at 599/600. The missing question (`dev:dasovich-j/deleted_items/1872.#1`) returns `http_error` on t-lk's second call on every re-run, so it is reported as a technical failure. Grading total: $0.653.

## Phase 2 summary (Tue 6 Oct, 19:30 ET; pause at the soft deadline)

Phase 2 ran about 75 configurations across one-shot, hybrid and agent families. All numbers are J1, design-weighted. The exploration pool is the 30 tuning mailboxes. TEST was never touched.

- **Best agent: x1** (the YES/NO commit check over gates' first context; an unsure answer goes to the g5 tool agent; with no YES, a CE-ordered list pick plus a model-written fielded search).
  - 86.7 over 2,100 questions, +1.6 [0.5, 2.6] vs gates.
  - On the never-used confirmation sets (900 questions): +1.7 [0.2, 3.3].
  - 1,778 ms and 5.3 calls per question, about 55% of the 3,243 ms cap. It is byte-identical on re-run.
- **Minimal agent: t-lk** (commit check plus one list pick). +1.0 [0.1, 2.0] vs gates at 1,191 ms, keeping about half of x1's gain.
- **Best one-shot: p3** (triggered email swap). +0.8 [0.3, 1.3] vs gates, positive on all 4 of its sets.
- **Hybrids** (a confidence gate between one-shot and agent) did not beat gates reliably: n-g5 +0.6 [−0.5, 1.7], g10 −0.2.
- **The agentic gap closes.** On the same 600 questions:
  - the frozen plain-text e2b agent scores 39.2 and x1 scores 86.9;
  - native tool calls are worth +17, full text of the top results +23, mailbox-scoped search +4, and agent control about +2;
  - on FULL-0, x1 = 31b P-B (87.4 vs 87.4).
- **What limits further gains:**
  - Hit reading is at e2b's ceiling: gold-only reading scores 92.2 on hits, while every system from gates on reads hits at 88.5–90.5.
  - The remaining headroom is on misses (x1 46 vs gold-only 82), but misses carry 6.8% of the weight. So even m2's real recall gain (+16 misses over 1,700 questions) moves the weighted score by about +0.2.
- **Rounds 3–4 nulls:**
  - ensembles e1 +0.15;
  - thinking mode / quote-verified extraction −1.4 / −0.9;
  - specificity re-ask and YES-filtered context (h7/h8) +0.3 / +0.4;
  - recall probes m1–m3 +0.1 to +0.2;
  - j2 null on confirmation;
  - the y1 stack −0.5 on confirmation.
- **Methodological lesson:** screening gains of +0.5 to +1 shrink on fresh sets (x1 +2.5 → +1.7, n-g5 +1.5 → −0.3, j2 +0.55 → 0, y1 +1.07 → −0.5). Selecting on 600 questions cannot resolve effects below about 1.5 points. Re-rolls from Ollama's prompt cache add about ±2 hit flips per 300 questions, even with identical calls.

**State at pause:**
- `gates` stays the registered primary.
- The x1 TEST arm is drafted in `docs/premise-study/explore2/PREREG-X1-DRAFT.md`. It is not binding; Kerem decides.
- The TEST confirmation of `gates` is still blocked on LibreHardwareMonitor (admin, web server on port 8085) and the Mac tier-A verdict files, or the registered fallback.
- `explore2/confirm2.js` does not exist yet; it is needed only if the x1 arm runs.

### Round 5 (Tue 6 Oct ~21:00 ET to Wed 7 Oct 18:00 ET; Kerem: "a new major discovery")

Kerem extended exploration to Wed 18:00 ET. LibreHardwareMonitor is now running at http://localhost:8085.

New sets drawn Tue 20:45 ET; all are registered and email-disjoint from earlier sets:
- **S300-4, S300-5:** decision sets. Each worker may run at most 2 variants there.
- **FULL-2:** clean confirmation, lead only.
- **DEMO-1 (100), DEMO-2 (600):** demonstration bank, never evaluated.
- The older sets become development sets.

Promotion bar raised to **+1.5 vs x1** pooled over S300-4 + S300-5, because round 4 showed that gains of +0.5 to +1 vanish.

Workers (brief: `explore2/BRIEF.md` "Round 5"):
- **b:** in-domain few-shot demonstrations.
- **c:** email rendering and reading format for a 2B model.
- **d:** retrieval recall lab (dense, hybrid, thread expansion).
- **u:** literature methods (context-aware decoding, generator-as-scorer).
- **i:** cache-history determinism and energy per question.

The lead runs x1 and gates on S300-4 and S300-5.

**x1 and gates on the fresh decision sets** (lead, Tue 21:20 ET; J1):

| set | gates | x1 | x1 − gates |
|---|---|---|---|
| S300-4 | 87.9 | 86.9 | −1.0 [−3.5, 2.2] |
| S300-5 | 83.2 | 82.8 | −0.4 [−2.7, 1.5] |

- **Misses vs hits:** x1 wins the misses by a wide margin (51 vs 32 and 32 vs 17) but loses 8 net hits out of 400. The hits are lost on two paths:
  - the g5 handover when the first YES was not W0's top email (6 vs 10);
  - the explore path when the gold was in W0 but drew no YES (35 vs 38).
- **Pooled over all 7 sets (2,700 questions):** x1 is +1.1 [0.1, 1.7] vs gates, down from +1.6 over 5 sets. Its hit-side gain pooled over the 7 sets is about zero, so its advantage is the miss stratum, about +1 weighted.
- **Implication for the paper:** a TEST arm's Y3 (x1 > gates) is very likely null.
- **Measurement caveat:** wall times are inflated while round-5 workers run CPU jobs (gates 967 ms on S300-5).

**b (few-shot demonstrations) is null** (Wed 02:20 ET; `explore2/b.md`). 13 demo-vs-parent comparisons on development sets; every CI includes 0.
- **gates + 4 similar demos:** −0.0 [−2.7, 3.0] over 600 questions.
- **gates + 4 fixed demos:** −0.9.
- **x1 + 4 fixed demos:** −0.4 [−4.3, 3.7] on S300-2.
- **Gold-only reading with demos:** −1.2 to +0.1.

Demos change the answer's form, not the reading. Answers get 20–25% shorter and about 90% of texts change; the lost hits are mostly short answers that dropped needed context. Demos also suppress abstention (17 → 2 in 600 questions) and make x1's commit answer more confident, so fewer questions go to g5. A different prompt is a coin flip on e2b's unsure hits, so confidence gating gives the same +0.8 with any prompt. b ran nothing on the decision sets.

**d (retrieval) is a small real gain, not a candidate** (Wed 04:10 ET; `explore2/d.md`).
- **Hits are not a retrieval problem.** Only 12 of 1,600 wrong-or-right dev hits lack an answer-bearing email in the final context. x1's "wrong email" hits are misreads among contexts that include the right email.
- **Misses:** perfect retrieval plus gold-only reading is worth at most +2.4 weighted; a perfect explore list, about +0.5.
- **Dense retrieval (nomic)** is worse than BM25 as a first stage. Fused with BM25 it adds only +2 golds to the explore list. Embedding the query inside a run slows e2b 3–6× on this box, so it is out.
- **Thread expansion, sender/recipient filters and date cues** add nothing.
- **d8** = x1 with a lexical CE explore list plus the email x1's YES-probe accepted seeded into g5's first search. The x1 replay is +0.6 [0.0, 1.2] over 1,500 dev questions; on S300-4 + S300-5 it is +0.5 [−0.7, 1.6] vs x1. The flips are mechanism: explore misses +17/−1, seeded handover hits +9/−3.

**c (email rendering) is null** (Wed 04:30 ET; `explore2/c.md`).
- **Where the errors are:** 57% of gold emails are reply/forward chains, and they hold 104 of x1's 154 wrong dev hits. Who-questions on chains are the weakest cell (x1 75%, gold-only 76%).
- **Gold-only presentations, 850 hits:** thread labels, all-email labels, bold key sentences, CE/lexical excerpts, oldest-first threads and question-type hints all land within run-to-run noise (2–4 verdict flips per 200). FULL-1 was negative for every presentation.
- **End to end:**
  - x1 + thread labels: +0.47 [−0.9, 1.6] over 1,800 questions; on S300-4 + S300-5, +0.8 [−1.1, 2.9].
  - gates + labels: +0.44 over 1,500 questions; −0.7 on the decision sets.
- 13% of hits are right under some presentations and wrong under others, but no presentation wins consistently.

**New worker l** (Wed 04:35 ET): pointwise self-verification to select among diverse candidate answers. There is answer diversity on unsure hits (c, n), and no selector yet beats a coin flip (pairwise choose, voting). A pointwise YES/NO with logprob has not been tried. l measures the verifier's within-question pairwise accuracy on stored candidates first, and builds a best-of-K variant only if that accuracy is clearly above 50%.

**Wed 07:01 ET: the PC restarted again.** Ollama was restarted with `ollama serve` (0.34.2, same digest). Worker u had already stopped earlier on an API usage limit, and worker l was interrupted; l was resumed at 07:20.

**u (literature methods) is closed** (`explore2/u.md`).
- **Prompt repetition** (Leviathan et al.) is null pooled: gates + repetition 0.0, x1 + repetition −1.1.
- **Speculative context-aware decoding (CAD, α 0.5)** improves single-email reading: gold-only hits +38/−24 over four dev sets (+1.3 hit points), and +2.2 over a padding placebo.
- **CAD does not survive multi-email contexts:**
  - x1 with CAD on every answer call is +0.3 on S300-2;
  - gates + CAD is −0.1.
- **x1 + CAD re-read of the YES email alone on sure commits (u-xyc)** is null:
  - S300-4: −0.1 [−2.3, 2.1];
  - S300-5: +0.1 [−1.9, 1.8];
  - S300-1: −0.6.
- **Calibration:** a content-free placebo (gates with its prompt padded by periods) moved S300-4 + S300-5 pooled by +0.7 (S300-5 alone +2.5). The +1.5 bar is about two placebo draws.

**i (determinism and energy) is done** (`explore2/i.md`).
- **The `det()` wrapper** (`variants/i-det.js`) issues a long fixed reset prompt before each call. That makes every prompt compute from cache position 0, so answers no longer depend on earlier questions.
- **Verified natural experiment:** behind det, x1 and t-lk give byte-identical answers on every path where they issue the same prompts. Unwrapped, 5 verdicts flipped on those paths from history alone.
- **Cost of det:** gates +36 ms per question (byte-identical to stored gates), x1 +151 ms. Accuracy is unchanged.
- **Identical call sequences reproduce exactly** (x1, t-lk and gates re-runs 300/300).
- **Energy per question, S300-1:**
  - RTX 5060 Ti board power; idle 8.2 W subtracted from the marginal figures;
  - CPU attributed to the runner, llama-server and ollama;
  - design-weighted J1.

| system | J1 | wall ms | total J/question | J per correct answer |
|---|---|---|---|---|
| P-B | 77.6 | 647 | 72 | 93 |
| gates | 83.9 | 759 | 81 | 96 |
| t-lk | 86.1 | 1,099 | 114 | 132 |
| x1 | 87.7 | 1,687 | 174 | 199 |

- Energy tracks wall time, a little sublinearly: agents draw 96–98 W against P-B's 111 W.
- gates buys +6.3 points for +3% energy per correct answer.
- x1 buys +10.1 points over P-B for +114%.

**q (stacking the small real gains) is done** (`explore2/q.md`, Wed 09:32 ET).
- **q1** = x1 + d8 (g5 seeded with the doubted first-YES email) + m2 (recovery of an answer-bearing email on committed questions) + d6's explore list. **q2** = q1 + thread labels (c). Both run behind det (mode "all"); the baseline is `i-det-x1` v2.
- **Stub check:** 0 failures over 8 scenarios. q1 issues exactly the calls of x1, d8 or m2 wherever only that component acts. On the decision sets, the 411 of 600 questions where no component acts gave byte-identical answers.
- **Decision sets** (S300-4 + S300-5, Δ vs det x1, mailbox-cluster bootstrap):
  - q1: +1.20 [−0.1, 3.0] (S300-4 +2.41, S300-5 +0.00). With S300-1 added: +0.94 [−0.0, 2.0] over 900 questions.
  - **q2: +2.51 [0.2, 4.6], p = 0.026** (S300-4 +1.94, S300-5 +3.07). It passes the +1.5 bar.
  - Labels alone (q2 − q1): +1.30 [−1.1, 3.4], and set-dependent (−0.47, +3.07, +0.14 on S300-1), as in c.
- **Flips, q1 vs det x1:** hits +7/−3, misses +13/−5. m2 on misses is the most robust piece (+15/−3 over 900 questions).
- **Wall time with det:** q1 2,494 ms, q2 2,480 ms, det x1 2,025 ms. Without det, about 2,300 ms. Inside the 3,243 ms cap.
- **Erratum found by q:** the LCG used for bootstrap intervals in several analysis tools multiplies in doubles. Its period is about 10,466 and its output is not uniform. Affected tools: `y-lib`, `t-ladder`, `c-pooled`, `l-lib`, `l-stub`, `e-lib`, `x-tau`, `p-logit`, `h-clean`, `c-gold-eval`.
  - Point estimates are unaffected; intervals from those tools are unreliable.
  - Example: the y1 confirmation interval −0.5 [−1.6, 1.6] becomes [−1.91, 0.93] with a correct RNG. The decision is unchanged.
  - Intervals from `analyze.js` and `cli2 report` are correct.
  - An audit of the journal's intervals follows.

**Lead confirmation on FULL-2. The rule is fixed here, before the run** (Wed 09:45 ET).
- **Arms**, all behind det (mode "all"): `i-det-x1` v2 (reference), `q-det-q1` v1, `q-det-q2` v1, `i-det-gates`.
- **Primary contrast:** q-det-q2 − i-det-x1. J1 weighted, paired, mailbox-cluster bootstrap (`cli2 report`).
- **Outcomes:**
  - *confirmed*: Δ ≥ +1.0 and the 95% CI lower bound > 0;
  - *consistent*: Δ > 0 but not confirmed;
  - *not confirmed*: Δ ≤ 0.
- **Secondary (descriptive only):**
  - q1 − x1: the retrieval mechanisms;
  - q2 − q1: the labels;
  - q2 − gates: against the registered primary;
  - the pooled estimate over S300-4 + S300-5 + FULL-2.
- **Cost:** mean wall time with det must be ≤ 3,243 ms.
- **Energy:** `energy-logger.js` is recording to `.data/premise2/explore/r5-energy.jsonl`, with an `i-idle` baseline. Energy per question is reported with `tools/i-energy.js`.
- No variant changes after this entry, and FULL-2 is not used for any selection.

**r (bootstrap interval erratum) is done** (`explore2/ci-erratum.md`, Wed 10:05 ET).
- **The bug:** 15 analysis tools under `explore2/tools/` used `seed * 1103515245 + 12345` computed in doubles.
  - The `& 0x7fffffff` and `% 2^31` forms share one cycle of period 10,466. `c-gold-eval` (`>>> 0`, re-seeded at 7) has a cycle of only 419.
  - Synthetic test: with period 10,466 each bound is off by about ±0.4 points rms and coverage is 92–93%; `c-gold-eval`'s intervals are about half the correct width, with 63% coverage.
  - `analyze.js` / `cli2 report`, `v-final.js` and `q-stats.js` were never affected.
- **The fix:** `tools/rng.js` (mulberry32, B = 10,000), now used by every affected tool.
- **The audit:** about 190 intervals were recomputed from stored data; every old value reproduced first.
- **No promotion, null or confirmation decision changes.** Key corrected intervals:
  - y1 − x1 confirmation: [−1.9, 0.9];
  - x1 − gates over 2,700 questions: [0.15, 2.0], still excluding 0;
  - x1 + thread labels over 1,800 questions: [−0.75, 1.7].
- **Four statements in worker notes no longer hold at 95%:**
  1. l's selector l-xs1 − x1: [−3.74, 0.16] (printed as excluding 0).
  2. t's k1 − gates: [−0.38, 2.8].
  3. c's gold-only presentation tables: about half width, so only `thread` stays significantly negative on FULL-1.
  4. c's c-fin1 − x1 on S300-2: [0.00, 4.9].
- The PREREG-X1 draft's copies of the y1 intervals are corrected in its deviation log.

**FULL-2 confirmation result** (lead, Wed 10:55 ET; J1; all arms behind det; FULL-2 is used for nothing else).

| arm | weighted | miss | hit | Δ vs det x1 [95% CI] | Δ vs det gates | wall ms | calls |
|---|---|---|---|---|---|---|---|
| i-det-gates | 84.3 | 27.3 | 88.4 | −1.1 [−3.6, 0.8] | – | 807 | 2.0 |
| i-det-x1 | 85.4 | 40.7 | 88.7 | – | +1.1 [−0.8, 3.6] | 1,944 | 11.0 |
| q-det-q1 | **86.8** | 49.3 | 89.6 | **+1.4 [0.6, 2.2]** | +2.5 [0.4, 5.1] | 2,363 | 13.0 |
| q-det-q2 | 86.3 | 48.0 | 89.1 | +0.9 [−1.5, 3.1] | +2.0 [−0.6, 4.9] | 2,362 | 13.1 |

- **Primary contrast** (q2 − det x1): +0.9 [−1.5, 3.1]. By the rule fixed above, q2 is **consistent, not confirmed**. Its screening gain of +2.51 shrank as in round 4.
- **The labels did not replicate.** q2 − q1 is −0.5 [−3.0, 1.7] on FULL-2 (hits +13/−15, misses +3/−5). Over 2,400 questions across rounds, thread labels are noise.
- **The retrieval stack q1 replicates** (secondary contrast, descriptive by the rule):
  - FULL-2: +1.4 [0.6, 2.2];
  - S300-4: +2.41;
  - S300-5: +0.00;
  - S300-1 (dev): +0.41.
- **Pooled over the three fresh sets**, S300-4 + S300-5 + FULL-2 (1,200 questions, `tools/q-stats.js`):
  - **q1 − det x1: +1.29**:
    - mailbox-cluster bootstrap [0.49, 2.47];
    - stratified question bootstrap [0.42, 2.19];
    - sign-flip randomisation p = 0.004;
    - discordant pairs: misses +30/−9, hits +12/−4.
  - q2 − det x1: +1.65 [0.17, 3.31], p = 0.038.
  - Behind det every concordant pair is byte-identical, so only the discordant pairs carry information. That is why q1's interval is narrow.
- **Where q1's gain comes from:**
  - mostly misses: m2's recovery of an answer-bearing email plus g5 seeded by d8, giving miss accuracy 40.7 → 49.3;
  - plus a small hit gain (+0.9).
  - Against det gates it is +22.0 on misses and +1.1 on hits.
- **Energy on FULL-2** (GPU board power, design-weighted, idle 6.8 W from 3 `i-idle` windows; `tools/i-energy.js`, summary in `.data/premise2/explore/r5-energy-summary.json`):

| arm | GPU J/question (gross) | GPU J/question (marginal) | GPU J per correct answer |
|---|---|---|---|
| det gates | 81 | 76 | 96 |
| det x1 | 168 | 156 | 197 |
| q1 | 189 | 175 | 218 |
| q2 | 189 | 174 | 219 |

  - CPU attribution is unavailable for this run because the CPU sampler was not running. The raw CPU package numbers are upper bounds, since other workers' CPU jobs ran concurrently.
  - q1 buys +2.5 points over gates on FULL-2 for 2.3× the GPU energy per correct answer.
  - Over det x1, q1 buys +1.4 for +11% energy per correct answer.
- **Reading:**
  - q1 = x1 + d8 + m2 (+ d6's explore list) is the first stack in rounds 4–5 whose gain held on a fresh confirmation set. Round 4's y1 (x1 + m2 + j2) failed confirmation; the difference is that j2 (null) is out and d8 is in.
  - The effect is small (about +1.3 weighted) and lives mostly on misses, which carry 6.8% of the weight.
  - q1 was named before the run as the secondary arm and as the lower-variance choice. Preferring it over q2 now is still a post-hoc choice on FULL-2, and any TEST arm needs its own addendum.

**l (pointwise self-verification) is closed: a clean negative** (`explore2/l.md`, Wed 10:55 ET).
- **The prize exists.** Oracle selection among x1's own deployable candidates (commit answer, the YES email read alone, CAD) is worth about +4 weighted.
- **The verifier sees grounding, not correctness.** e2b's YES/NO verifier ("is the proposed answer correct and complete according to this email?") ranks right above wrong:
  - in 76.9% of hit pairs with the gold email as evidence, against 73.6% for plain word overlap with the same email;
  - in 72.1% with the deployable YES email, against 69.8% for word overlap.
  - On pairs where both answers are drawn from the evidence email it is about 50%. That is exactly the class of x1's remaining hit errors: a wrong fact or relation read from the right email.
- **NO-framing fails outright.** e2b ignores the negation in "is anything wrong or missing?"
- **The deployable selector `l-xs1` hurts:** −1.74 vs x1 over 600 dev questions (S300-1, S300-3). The corrected interval is [−3.74, 0.16] (the printed [−3.4, −0.1] came from the defective generator; see r). Two reasons:
  - Checking a single read against the email it was read from is circular. Switches where the YES email was not the gold went +1/−19.
  - The in-sample simulation was biased, because single-read proxies existed almost only where the YES email was the gold.
- **No other rule rescues it:** lexical selection −1.5; re-scoring with the answer-before-email prompt −0.07; the best cell is +0.66, placebo-sized.
- **Side finding:** the verifier score of x1's own answer is a between-question confidence signal (AUC 0.71, vs 0.59 for answer logprob), but on hits there is no better answer to escalate to.
- No S300-4/5 slot was used.

**q1 without det on S300-1** (lead, Wed 11:10 ET; energy logger and CPU sampler running):
- **Accuracy:** 88.2 vs stored x1 87.7, +0.5 [0.1, 0.9]. Hits are identical (90.5); misses go 49 → 56.
- **Cost:** wall 2,261 ms mean (p95 4,212).
- **Energy:** 189 J per question GPU gross; 181 J per question total; 205 J per correct answer.
- **Against i's S300-1 table** (x1: 174 J per question, 199 J per correct answer), q1 costs about 3–4% more energy per question.
- **Decision memo:** `explore2/TEST-ARM-OPTIONS.md` lays out the TEST-arm options for Kerem: A gates only; B x1; C q1. It recommends C behind det, as a replacement for B.

**s (cloze and recognition reformulations of reading) is closed: a clean negative** (`explore2/s.md`, Wed 11:28 ET).
- **Setup:** a gold-only diagnostic on 400 dev hits (S300-1, S300-2), with a reset before every call.
- **Change in hit points vs the standard prompt:**
  - padding placebo: +1.3;
  - cloze by continuation: −3.5 [−6.3, −0.8];
  - explicit fill-in-the-blank: −6.0;
  - multiple choice over spans pulled from the email: −10.8;
  - per-option YES/NO: −8.0.
- **Narrower rules** fixed on S300-1 (single-part questions, who-questions, confident choices only) all fail on S300-2.
- **Why cloze fails:** it fixes some who-question inversions, but cannot hold two-part questions (23% of hits).
- **Why multiple choice fails:** e2b recognises the right span when it is offered (91%), but picks "None of the above" only 25% of the time when no option is right. Only 40 of 1,050 dev hits are both wrong and of a type spans can be pulled for, so even perfect recognition caps out near +3.8 hit points.
- **Reading floor, summary across workers:** presentation (c), demonstrations (b), decoding (u: CAD, repetition), selection (e, w, n, l), quote/thinking (z), re-reads (j, h) and task reformulation (s) all fail to move e2b's residual hit errors. The remaining errors are e2b misreading the right email.

**FULL-3: second replication of q1. Set drawn and rule fixed before any run** (lead, Wed 11:35 ET).
- **The set:** FULL-3 was drawn now: 600 questions from 21 mailboxes, hash 2b0e7a36dab8, email-disjoint from all earlier sets. It is lead-only and used for nothing else.
- **Arms**, all behind det: `i-det-x1` v2, `q-det-q1` v1, `i-det-gates`. A cheaper variant may be added later, if a worker screens one on dev sets first. Behind det, a later run is paired exactly with these.
- **Primary contrast:** q-det-q1 − i-det-x1 on FULL-3. J1 weighted, mailbox-cluster bootstrap (`cli2 report`).
- **Outcomes** (same as for FULL-2):
  - *confirmed*: Δ ≥ +1.0 and the 95% CI lower bound > 0;
  - *consistent*: Δ > 0;
  - *not confirmed*: Δ ≤ 0.
- **Secondary (descriptive):**
  - q1 − det gates on FULL-3;
  - the pooled q1 − det x1 over S300-4 + S300-5 + FULL-2 + FULL-3 (1,800 questions, `tools/q-stats.js`).

**FULL-3 result: q1's second replication is essentially null** (lead, Wed 12:25 ET; J1; all arms behind det).

| arm | weighted | miss | hit | Δ vs det x1 [95% CI] | Δ vs det gates | wall ms |
|---|---|---|---|---|---|---|
| i-det-gates | 82.0 | 18.7 | 86.7 | −2.0 [−3.7, −0.8] | – | 794 |
| i-det-x1 | 84.0 | 38.7 | 87.3 | – | +2.0 [0.8, 3.7] | 2,016 |
| q-det-q1 | 84.1 | 42.7 | 87.1 | **+0.06 [−0.49, 0.27]** | +2.0 [0.9, 3.7] | 2,508 |

- **Primary contrast** (q1 − det x1): +0.06. By the letter of the rule fixed before the run this is "consistent" (Δ > 0), but in practice it is null.
  - Discordant pairs: misses +12/−6, hits +1/−2.
  - Sign-flip p = 0.91.
  - The cluster interval is narrow and lopsided because FULL-3 has only 21 mailboxes. The stratified question bootstrap gives [−0.76, 0.85].
- **Pooled over the four fresh sets**, S300-4 + S300-5 + FULL-2 + FULL-3 (1,800 questions): **q1 − det x1 = +0.87**:
  - mailbox-cluster bootstrap [0.28, 1.88];
  - stratified question bootstrap [0.24, 1.52];
  - sign-flip p = 0.007;
  - discordant pairs: misses +42/−15, hits +13/−6.
  - Over the two clean confirmation sets alone (FULL-2 + FULL-3): +0.74 [0.23, 1.17], p = 0.03.
- **Reading:**
  - The miss mechanism (m2's recovery plus g5 seeded by d8) is robust on every fresh set: +42/−15 discordant misses over 1,800 questions. It is worth about +0.4 weighted, because misses carry 6.8% of the weight.
  - The hit part (+13/−6) is small and set-dependent; most of it came from S300-4.
  - The honest size of q1's gain over x1 is about **+0.9 weighted**, with an interval of roughly [0.3, 1.9]. It is never negative on a fresh set (S300-4 +2.41, S300-5 0.00, FULL-2 +1.4, FULL-3 +0.06), but it is set-dependent.
  - The shrinkage pattern holds once more: the screening estimate (+1.2 on the decision sets) overstated the true effect.
- **Against gates on the two clean sets:** x1 is +1.1 (FULL-2) and +2.0 (FULL-3); q1 is +2.5 and +2.0.

**A cheaper arm added to FULL-3 and FULL-2. Rule fixed before the run** (lead, Wed 13:45 ET).
- **The arm:** worker lite's leading candidate, `lite-det-ub` (`variants/lite-stack.js`), behind det. It is t-lk + d6's explore list + m2 recovery (only on doubted, unsure commits) + a d8-seeded g5 handover (only when the recovery finds no email). It skips x1's g5 handover on unsure commits that have a confident first YES.
- **Dev screening, det vs det:**
  - vs det x1: S300-1 about −0.1, S300-2 −0.86, S300-3 +0.20;
  - GPU energy per correct answer 14–16% lower.
- **Question:** does it keep x1-level accuracy on fresh sets at lower energy?
- **Reported, all descriptive** (no selection; FULL-2 and FULL-3 are used for nothing else):
  - lite-det-ub − det x1 per set and pooled over FULL-2 + FULL-3;
  - lite-det-ub − det gates;
  - wall time, calls, and GPU J per question and per correct answer.
- **Pre-stated reading:**
  - *x1-level*: the pooled Δ vs det x1 ≥ −0.5 with the CI lower bound ≥ −1.5, and lower energy per correct answer than det x1;
  - otherwise *not x1-level*.

**lite-det-ub on FULL-2 and FULL-3: x1-level accuracy at about 15–22% less energy** (lead, Wed 14:35 ET; J1; det vs det).

| set | lite-det-ub | Δ vs det x1 | Δ vs det gates | wall ms (det x1) | GPU J/question (det x1) | GPU J per correct answer (det x1) |
|---|---|---|---|---|---|---|
| FULL-2 | 85.4 | +0.02 [−1.6, 1.4] | +1.1 [0.2, 2.5] | 1,684 (1,944) | 131 (168) | 154 (197) |
| FULL-3 | 83.4 | −0.62 [−1.5, 0.0] | +1.4 [0.1, 2.7] | 1,826 (2,016) | 146 (173) | 175 (205) |
| **pooled, 1,200 questions** | | **−0.30 [−1.24, 0.46]**, p = 0.55 | **+1.25 [0.78, 2.11]** | | | |

- **Discordant pairs vs det x1, pooled:** misses +25/−20, hits +8/−12.
- **Against det gates:** misses +62/−7.
- **Pre-stated reading:**
  - pooled Δ ≥ −0.5: met;
  - CI lower bound ≥ −1.5: met (−1.24);
  - lower energy per correct answer than det x1: met (−22% on FULL-2, −15% on FULL-3).
  - So **x1-level**.
- **FULL-3 energy table** (`.data/premise2/explore/r5-energy-full3.json`; GPU J per correct answer, gross):
  - det gates 99;
  - lite-det-ub 175;
  - det x1 205;
  - q1 237.
- **The frontier on the clean confirmation sets:**
  - gates: the cheapest;
  - lite-det-ub: +1.25 over gates, at about 1.6–1.8× gates' energy per correct answer;
  - x1: the same accuracy as lite, at about 2.1×;
  - q1: about +0.9 over x1 on the four fresh sets, at about 2.3–2.4×.
- **What it means:**
  - x1 is dominated by lite-det-ub on this evidence.
  - Most of x1's g5 handover is not worth its energy. lite keeps the handover only for doubted, unsure commits where m2's recovery finds no email.
- **Technical failures, lite on FULL-2:** 7 of 600 (context overflow 4, output limit 2, http_error 1). One answer is ungraded.
- **Note on question keys:** keys with a `test:` prefix are EnronQA's source split inside the exploration pool. They are not the study's TEST set; the pool excludes the evaluation mailboxes and their emails (`pool-manifest.json` exclusions).

**lite (a cheaper frontier point) is done** (`explore2/lite.md`, Wed 15:05 ET).
- **Variants, all in `variants/lite-stack.js` with det forms:**
  - lite-a = t-lk + d6 + m2 as in q1, no g5;
  - lite-u = m2 only on doubted, unsure commits;
  - lite-ub = lite-u + a d8-seeded g5 only where m2 finds nothing (11% of questions).
- **Stub check:** 183 checks, 0 failures.
- **Dev results** (det, S300-1/2/3, 900 questions; GPU J per correct answer measured):

| system | weighted | wall ms | GPU J per correct answer |
|---|---|---|---|
| det t-lk | 85.67 | 1,278 | 125 |
| lite-det-u | 85.90 | 1,576 | 141 |
| lite-det-ub | 86.53 | 1,742 | 161 |
| det x1 | 86.77 | 1,911 | 195 |
| det q1 | 86.97 | 2,409 | 220 |

- **lite-det-ub's paired differences:**
  - vs det x1: −0.24 [−1.22, 0.70];
  - vs det q1: −0.45 [−1.16, 0.20].
  - Where lite-ub makes q1's calls, its answers are byte-identical to q1's on 529 of 529 questions. Its losses come from the three parts it drops: the handover after a confident first YES, x1's full explore, and m2 on sure commits.
- **m2's recovery is not cheap.** Each time it fires it costs about 2 s: CPU cross-encoder list building plus up to 6 probes. That is why lite-a, which runs m2 on every doubted commit, is dominated (−0.8 vs det x1 on S300-1, by exact replay). Its replay method reproduced two real runs 596/596.
- **lite-det-u** is +0.27 [0.12, 0.43] over det t-lk, all on misses, but it is off the convex frontier.
- **Fresh-set result:** see the lead's FULL-2/FULL-3 entry above. lite-det-ub is x1-level there (−0.30 [−1.24, 0.46]) at 15–22% less energy per correct answer.

## Round 5 summary (Wed 7 Oct, 15:30 ET)

Round 5 had 10 workers (b, c, d, u, i, l, q, r, s, lite) plus v5 for the tables. Its evaluation used three new fresh sets (S300-4, S300-5, FULL-2) and one drawn today (FULL-3). Every decision rule was fixed in this journal before its run. Exploration spend on J1 grading is about $0.92 in total.

**What held on fresh data (all contrasts det vs det):**

| system | what it is | Δ vs det x1, fresh sets | Δ vs det gates, FULL-2 / FULL-3 | GPU J per correct answer, FULL-2 / FULL-3 |
|---|---|---|---|---|
| det gates | one-shot (registered primary) | – | – | 96 / 99 |
| **lite-det-ub** | t-lk + d6 + m2, g5 only when recovery fails | −0.30 [−1.24, 0.46] (FULL-2+3) | +1.1 / +1.4; pooled **+1.25 [0.78, 2.11]** | **154 / 175** |
| det x1 | hybrid agent (round 2) | – | +1.1 / +2.0 | 197 / 205 |
| **q1** (q-det-q1) | x1 + d8 + m2 | **+0.87 [0.28, 1.88]** (four sets, 1,800 questions, p = 0.007) | +2.5 / +2.0 | 218 / 237 |

1. **Retrieval engineering still pays on misses.**
   - m2's recovery of an answer-bearing email, plus g5 seeded by d8, is robust on every fresh set (q1 vs x1: misses +42/−15).
   - Because misses carry 6.8% of the weight, the effect is under +1 weighted.
2. **There is a cheaper frontier point.** lite-det-ub keeps x1's accuracy at 15–22% less energy per correct answer, which makes x1 dominated. Most of x1's g5 handover is not worth its energy.
3. **Reading floor.** Nothing moves e2b's residual hit errors, which are a wrong fact or relation read from the right email:
   - demonstrations (b);
   - rendering and thread labels (c; labels failed replication on FULL-2: q2 − q1 −0.5);
   - decoding (u: CAD +1.3 on single-email reading, null end to end);
   - self-verification (l: a grounding check, not a correctness check);
   - cloze and multiple-choice reformulation (s: −3.5 to −10.8 hit points);
   - the same holds for every attempt in rounds 3–4 (selection, quote, thinking, re-reads).
   - Oracle selection among e2b's own candidates would be worth about +4, but no e2b-internal signal finds it.
   - This is the part of the gap that engineering around e2b did not move. Whether a larger model moves it is the main study's question.
4. **Methods:**
   - det() makes every answer independent of earlier questions. Concordant pairs are then byte-identical and only discordant pairs carry information, so a change that touches few questions gets a narrow interval.
   - A placebo moves pooled decision sets by +0.7.
   - Screening gains do not carry over reliably: q2 went +2.5 → +0.9; q1 was +1.2 on the decision sets, then +1.4 and +0.06 on the two confirmation sets.
   - A defective bootstrap generator was found and fixed (r); no decision changed.
5. **Energy:** the GPU J per correct answer ladder runs gates ≈ 96–99 < lite 154–175 < x1 197–205 < q1 218–237. The agentic tier (t-lk) on S300-1 used 122.

**Open for Kerem (nothing runs on TEST without him):**
- The gates TEST confirmation still needs the Mac tier-A verdict files (or the registered fallback) and his go-ahead. LibreHardwareMonitor is ready.
- Second TEST arm: `explore2/TEST-ARM-OPTIONS.md`.
  - A: none.
  - B: x1 (dominated).
  - C: q1 behind det (recommended for Y3).
  - D: lite-det-ub behind det (the best accuracy per joule).
  - Whichever arm is chosen needs its own addendum and `confirm2.js`.
