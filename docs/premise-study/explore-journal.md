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
