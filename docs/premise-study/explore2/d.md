# Worker d: retrieval (round 5)

Prefix `d`. Code: `explore2/variants/d-*.js`, tools `explore2/tools/d-*.js`. Topic: get the gold email in front of e2b more often (x1's misses and wrong-email hits): dense / hybrid retrieval, deeper CE pools, thread expansion, sender filters, rule-based query rewrites. Recall lab first (no GPU), then integrate into x1's explore list and/or gates' contexts.

Development sets used: S300-1, S300-2, S300-3, FULL-0, FULL-1, S100-0..9 (3,100 disjoint questions; 1,100 miss / 2,000 hit). Never S300-4/5 (only for ≤ 2 finished variants), FULL-2, DEMO-1/2. (Disclosure: a set-size listing loop at the start printed the key *count* of every file in `sets/`, FULL-2.json included; no keys or records of FULL-2 were read or used.)

## 0. Where x1's errors sit (`tools/d-where.js`; stored x1 answers + J1, 2,300 questions: S300-1/2/3, FULL-0/1, S100-4/5)

"AB-in" = an answer-bearing email (gold, twin or EvidenceCache AB) is in x1's final reading context.

| stratum / x1 path | n | correct | AB in final ctx | wrong, AB in ctx | wrong, **no AB in ctx** |
|---|---|---|---|---|---|
| hit, all | 1,600 | 1,434 | 1,582 | 154 | **12** |
| hit, commit | 895 | 835 | 895 | 60 | 0 |
| hit, handover (g5) | 566 | 491 | 549 | 63 | 12 |
| hit, explore (found/nofound/nopick) | 139 | 108 | 138 | 31 | 0 |
| miss, all | 700 | 317 | 377 | 84 | **299** |
| miss, commit (false/true YES) | 172 | 91 | 108 | 22 | 59 |
| miss, handover (g5) | 219 | 89 | 100 | 21 | 109 |
| miss, found | 155 | 96 | 114 | 24 | 35 |
| miss, nofound | 154 | 41 | 55 | 17 | 96 |

**The hit side is not a retrieval problem.** Only 12 of 1,600 hits are wrong with no AB email in the final context (all on the g5 handover); the "wrong email" hits of j.md are wrong reads *among* emails that include the AB one. Perfect retrieval on hits is worth ≤ 0.75 hit points (≤ +0.7 weighted), only through g5's own searches.

**The miss side:** 299 of 700 misses (42.7 miss points) are wrong without an AB email in the final context. Even if retrieval put AB in front of e2b on all of them and e2b read them at the gold-only rate (82%), that is +35 miss points ≈ **+2.4 weighted** as an absolute ceiling; the parts an explore-list change can reach (explore paths: 131 = 18.7 miss points) are worth ≤ +1.0 weighted at perfect recall and reading.

## 1. Recall lab (no GPU)

Tools: `d-feat.js` (lexical lists per question: mailbox BM25 top 200 + gold rank to depth 2,000, owner-stripped, subject-weighted, name-filtered, global top 20), `d-lib.js`, `d-ce.js` (MiniLM CE cache, CPU, 4 threads, seeded from p-ce-std), `d-lab.js` (tables), `variants/d-dense.js` (`d-qemb` / `d-qemb-all`: nomic query vectors, no generation).

**Dense index coverage:** `.data/premise2/dense.f32` has 103,368 rows = the whole corpus; all 30 tuning mailboxes are fully covered (24,481 emails, per-mailbox row counts equal to corpus counts). **Query embedding cost:** nomic-embed on the CPU (num_gpu 0) through Ollama: 20 ms mean per query in a no-generation run (§1c), but ~1,050 ms inside a generation run (§2); brute-force mailbox search < 5 ms, global ≈ 80 ms.

**Gold depth (mailbox BM25 rank of gold/twin, 3,100 dev questions):**

| rank | 1–5 | 6–10 | 11–20 | 21–30 | 31–50 | 51–100 | 101–200 | >200 | none |
|---|---|---|---|---|---|---|---|---|---|
| miss (1,100) | 448 | 242 | 140 | 58 | 59 | 56 | 34 | 55 | 8 |
| hit (2,000) | 1,965 | 6 | 10 | 7 | 7 | 2 | 0 | 3 | 0 |

81% of miss golds are inside mailbox BM25 top 30 (x1's explore pool), 86% inside top 50; 14% beyond 50.

**Mailbox ranking, AB recall@1/5/10/15/30 (table A, 3,100 questions):**

| method (asker's mailbox) | misses (1,100) @1/5/10/15/30 | hits (2,000) @1/5/10 |
|---|---|---|
| BM25(question) | 204 / 475 / 732 / 816 / 928 | 1,892 / 1,999 / 2,000 |
| gates' order (header rerank of BM25 top 20) | 217 / 542 / 741 / 824 / 928 | 1,713 / 1,986 / 2,000 |
| owner-name-stripped BM25 | 220 / 539 / 760 / 838 / 936 | 1,883 / 1,994 / 1,999 |
| subject×3 / sender×2 BM25 | 232 / 550 / 759 / 846 / 945 | 1,895 / 1,998 / 1,999 |
| names in the question as sender/recipient filter | 41 / 124 / 195 / 234 / 288 | 861 / 954 / 963 |
| thread expansion of BM25 (siblings after each top-5 hit) | 204 / 451 / 691 / 800 / 927 | 1,892 / 1,990 / 2,000 |
| nomic dense (question) | 239 / 469 / 563 / 638 / 720 | 1,568 / 1,837 / 1,894 |
| RRF(k=10) BM25 + dense | 250 / 577 / 720 / 807 / 940 | 1,770 / 1,974 / 1,999 |
| RRF(k=60) BM25 + dense + stripped + subject-weighted | 250 / 577 / 751 / 857 / 956 | 1,831 / 1,978 / 1,995 |
| RRF(k=10) BM25 + stripped + subject-weighted (lexical only) | 207 / 526 / 757 / 845 / 945 | 1,890 / 1,998 / 2,000 |
| CE over own-mailbox W1 ∪ BM25 30 ∪ stripped 20 ∪ subject-weighted 20 (top 30 = pool size) | 392 / 664 / 781 / 837 / 948 | (CE only scored for explore hits) |

Dense alone is a weak first-stage ranker here (misses @5 469 vs BM25 475, @30 720 vs 928; hits @1 1,568 vs 1,892). Fused with BM25 it lifts the head (misses @5 +100) but costs hits (@1 −120). The cross-encoder over a lexical pool is the strongest head (misses @1 392, @5 664).

**Candidate pool recall, x1's explore-path misses (table D; W0 excluded; 309 misses on the 7 sets with x1 answers):** x1's pool (W1 ∪ BM25 top 30) holds AB in 216; BM25 top 50: 237; top 100: 253; top 200: 260; + nomic dense mailbox top 10 / 20 / 30: 236 / 242 / 246; BM25 top 50 + dense top 30: 257; + stripped/subject-weighted top 20: 225; + name filter top 10: 218; + thread siblings (≤ 15): 216 (no gain).

**Where it lands in gates (table B; does AB reach W0 / W0 ∪ W1 if the mailbox context were the top 5 of another ranking; switch rule unchanged):**

| mailbox context | misses W0 / W0∪W1 (1,100) | hits W0 (2,000) |
|---|---|---|
| gates (header rerank of BM25 top 20) | **422** / 542 | 1,999 |
| plain BM25 | 412 / 475 | 1,999 |
| subject-weighted BM25 | 429 / 550 | 1,999 |
| dense | 296 / 469 | 1,980 |
| RRF(k=10) BM25 + dense | 408 / 577 | 1,998 |
| CE over BM25 top 20 | 416 / 633 | 907 / 910 |

The mailbox context is W0 only on switched questions (615 misses, 100 hits); there gates' header rerank already holds AB for 422 of the 615 switched misses and nothing beats it. Better mailbox orderings raise only W1 (unswitched misses: AB in W1 120 / 485 with gates' order), which neither gates nor x1 reads except on an abstention. **No W0 gain is available from the mailbox context.**

**The global list (table E; W0 on the 1,900 unswitched hits / 485 unswitched misses):** AB in top 5 / top-5 set changed vs P-B:

| global list | misses | hits | hits whose top 5 changes |
|---|---|---|---|
| P-B (BM25 top 5) | 0 | 1,900 | 0 |
| RRF(k=10) BM25 + dense (global) | 139 | 1,876 | 1,800 |
| BM25 top 4 + dense global #1 | 76 | 1,896 | 1,780 |
| BM25 top 4 + dense mailbox #1 | 95 | 1,896 | 1,784 |
| BM25 top 4 + CE-best of mailbox top 30 (r5-like; CE-scored subset) | 159 | 855 / 857 | 784 / 857 |
| BM25 top 3 + CE-best + dense mailbox #1 (CE-scored subset) | 187 | 854 / 857 | 837 / 857 |

A W0 swap is where retrieval *could* move misses at scale (CE alone puts AB into W0 for a third of unswitched misses; dense adds +28 / 485 on top), but every such swap rewrites the prompt of ~90% of unswitched hits. That is r5 / p3 / x2's territory (p3 +0.8 vs gates; x2 / x4 ≈ x1), and the dense part is unusable at run time (§2).

**Dropped (no recall):** thread / Re:-chain expansion (+0 AB in any pool; same-subject siblings of top hits are not where missing golds are, as m.md found for false YES stops: same subject 12/112); sender/recipient filters (far below BM25; +2 in pool); date cues (the corpus headers carry no Date field; dates exist only in quoted "Sent:" lines, which BM25 already matches as tokens).

### 1a. Where it lands in x1: the explore pick list (table C; W0 excluded; 309 explore-path misses / 139 explore-path hits of the 2,300 questions with x1 answers)

x1's explore path (no YES in W0: ~20% of questions) shows the model a 15-line list. AB in the list's top 5 / 10 / 15:

| list (W0 excluded) | explore misses (309) | explore hits (139) |
|---|---|---|
| **x1's first list as logged** (CE over W1 ∪ BM25 top 30) | **135 / 168 / 182** | 26 / 30 / 32 |
| same, rebuilt offline (check) | 133 / 168 / 183 | 25 / 29 / 32 |
| CE over W1 ∪ BM25 top 50 / top 100 | 138 / 166 / 187 · 138 / 167 / 192 | |
| CE over W1 ∪ BM25 30 ∪ dense 20 | 141 / 173 / 191 | |
| CE over own-mailbox W1 ∪ BM25 30 (foreign global emails dropped) | 142 / 175 / 189 | 21 / 25 / 28 |
| CE over own W1 ∪ BM25 30 ∪ dense 20 | 148 / 179 / 197 | |
| **CE over own W1 ∪ BM25 30 ∪ owner-stripped 20 ∪ subject-weighted 20 (d6)** | **148 / 181 / 198** | 22 / 26 / 28 |
| CE over own W1 ∪ BM25 30 ∪ dense 20 ∪ stripped 20 ∪ subject 20 | 148 / 180 / 200 | |
| RRF(k=10) BM25 + stripped + subject (no CE) | 138 / 179 / 200 | 24 / 31 / 34 |
| RRF(k=60) BM25 + dense + stripped + subject (no CE) | 140 / 176 / 207 | 25 / 30 / 32 |
| CE over W1 ∪ BM25 30 ∪ thread siblings / name filter | 133 / 165 / 184 · 132 / 167 / 183 | |

On explore hits AB is already in W0 in 138 / 139 (the probes said NO to it), so the list matters for misses only.

- **Best lexical list (d6):** +13 / +13 / +16 AB-listed explore misses at top 5 / 10 / 15 over x1, i.e. +4–5% of explore misses. Dense adds ≤ +2 on top (and is unusable at run time, §2).
- **Expected value:** with x1's pick rate for a listed AB (~60–65%) and its found-AB read rate (96 / 155 = 62%), +16 listed ≈ +6 correct misses per 700 ≈ **+0.9 miss points ≈ +0.06 weighted.** That is the explore list's realistic contribution; the perfect-list ceiling is ≈ +0.5 weighted (§0: 131 wrong explore misses without AB).
- Never-shown explore misses (116): AB was in W0 but probed NO in ~36 (a list cannot help), at BM25 rank 31–100 in 34, beyond 100 or unmatched in 24.

### 1b. x1's g5 handover search (`tools/d-g5.js`; 784 handovers, 2,300 questions)

g5 (the unsure-commit handover, ~⅓ of questions) makes exactly one model-written `search_mailbox` (BM25 top 20 → header rerank → top 3 in full + 7 previews), reads, answers. The offline replay holds every email g5 finally read in 784/784 cases. AB in the replayed top 3 (= read) / top 10, and how often the top 3 changes vs g5's:

| list | hits (566) top 3 / 10 / changed | x1-wrong hits (75) | misses (218) top 3 / 10 / changed | x1-wrong misses (129) |
|---|---|---|---|---|
| g5 (model query, what it saw) | 535 / 564 / 0 | 62 | 91 / 141 / 0 | 18 |
| original question (gates' mailbox order) | 551 / 566 / 368 | 68 | 88 / 151 / 181 | 30 |
| RRF(g5 list, question list) | 547 / 566 / 196 | 66 | 97 / 150 / 127 | 25 |
| header rerank of RRF(BM25 q, BM25 question) top 20 (what g5 would show if its search were fused) | 543 / 566 / 199 | 65 | 97 / 155 / 130 | 25 |
| hybrid: RRF(BM25 q, nomic dense q) (model query embedded) | 511 / 559 / 482 | 61 | 95 / 137 / 204 | 30 |
| header rerank of RRF(BM25 q, dense q) top 20 | 515 / 561 / 442 | 63 | 97 / 137 / 201 | 28 |
| RRF(g5 list, question list, dense(question) top 20) | 550 / 565 / 426 | 66 | 105 / 156 / 181 | 35 |
| **x1's first-YES email added to g5's search results, then g5's header rerank (d8)** | **548 / 566 / 59** | **68** | **102 / 147 / 108** | **29** |
| x1's first-YES email forced to position 1 of what g5 shows | 564 / 566 / 141 | 74 | 104 / 147 / 143 | 32 |

Split by the first YES's position in W0: on the 47 handover hits whose first YES was not W0's top email (the lead's "6 vs 10" loss), g5's own query puts AB in its top 3 only 33 times; with the YES email seeded 40 (forced 45).

- The model's own query is *worse* than the raw question for putting AB in the top 3 on hits (535 vs 551) and on x1-wrong misses (18 vs 30), better only on misses x1 gets right (selection effect).
- Fusing the question into g5's search: +8 hits and +6 misses with AB in the top 3, but the top 3 changes on 35% of handover hits (199) and 60% of handover misses, so every one of those answers is re-rolled. With unsure-hit handovers known to be coin flips (x.md, n.md), expected net ≈ +0.2–0.3 weighted with ± noise of the same size. Hit-side AB failures on the handover are only 17 (12 of them wrong).
- **Seeding g5 with the commit's YES email dominates question fusion:** more AB in front (hits +13 vs +8, misses +11 vs +6) with a third of the prompt changes on hits (59 vs 199). The YES email is the evidence the commit check found; g5's cold start throws it away in 31 / 566 handover hits.
- Dense on the model's query *hurts* hits (535 → 511 AB in the top 3) and changes 85% of the top 3s: dense is not a better first-stage ranker than BM25 here. Adding dense(question) as a third list gives the best recall (hits 550, misses 105) but re-rolls 75% of handover hit prompts.

### 1c. x1's explore plan search (`tools/d-plan.js`; 331 plan searches)

After the first pick is probed NO, the model writes FROM / TO / ABOUT; the filtered mailbox BM25 top 10 is prepended to the pick list. AB in that top 10 (W0 excluded) / AB that was not already in the first pick list, misses (198) and hits (133):

| list | misses | hits |
|---|---|---|
| plan search as run (logged) | 57 / 11 | 16 / 1 |
| nomic dense of the plan text | 58 / 20 | 18 / 0 |
| RRF(plan search, dense plan text) | 63 / 17 | 20 / 1 |
| RRF(plan search, dense question) | 67 / 19 | 21 / 1 |

Dense adds about +8 *new* AB emails per 198 plan searches on misses (≈ 4% of explore misses), before the pick (≈ 65%) and the read (≈ 62%): ≈ +0.1 miss points per 100 misses. Not worth a variant on its own.

**Query embedding cost (d-qemb-all, 3,100 questions, CPU through Ollama, num_gpu 0):** mean 20 ms, median 19, p95 27 (one 1,054 ms cold load). Model-written search texts: 1,115 in 20.6 s (18 ms each).

**Lead note (21:25 ET) taken on board:** all d variants are x1-based, so they are judged by the paired Δ vs x1 on S300-4 + S300-5 (bar +1.5), with Δ vs gates reported too; walls compared only within the same time window. My offline CE cache job was cut from 4 to 2 onnx threads at 21:23 to inflate others' wall times less.

## 2. Engineering finding: query embedding during a generation run is not usable here

`d1` smoke (S100-4, 20 questions; x1 + nomic dense top 20 of the question in the explore pool; one `ctx.embedQuery` per question, CPU, num_gpu 0): **7,338 ms per question vs x1's ~2,200 on the same questions.**
- The embedding call itself took ~1,050 ms every time (aux), against 20 ms in the no-generation diagnostic (`d-qemb-all`): with e2b generating in between, Ollama reloads nomic on every call.
- e2b's own calls slowed 3–6× in the same run (a 2-call commit: gen 4,244 ms vs 715 ms in x1's run; e2b load_duration stayed ≈ 0, so e2b was not reloaded). The runs immediately before and after (u-xrep, i-pert-det-x1) had normal speed, so it is the interleaved embedding, not machine load.
- Answers were unaffected (19/20 texts identical to x1's; every commit / handover text identical): it is a speed problem, not a determinism one.
- Consequence: any per-question dense query embedding puts a variant over the 3,243 ms cap in this setup. Since the recall lab shows dense adds little over BM25 + CE (below), dense is dropped from the integrated variants. The queued dense variants (d1r/d2r/d3r replays, S300-4/5 d2,d3) were cancelled before they started (22:08 ET).

## 3. Integrated variants (`variants/d-agent.js`; x1 wrapped, not copied)

All wrap x1 (`x-agent.js` VARIANTS.x1) through a ctx proxy, so every path the change does not touch is x1 call for call (stub checks `tools/d-stub*.js`: W0, the commit probes and W0's top 4 identical on 20/20; extras computed once; the g5 search fused on 8/8 forced handovers).

- **d6** (explore list, lexical): when x1 explores (it loads the CE only then), the wrapper appends the owner-stripped and subject×3/sender×2 mailbox BM25 top 20 to the BM25 top-30 array x1 already holds, and hands x1 a CE proxy that scores the foreign (other-mailbox) global emails at −1e9. The 15-line list is then CE over own(W1) ∪ BM25 30 ∪ stripped 20 ∪ subject 20 (lab: explore misses AB@15 198 vs 182). Cost on explore questions only: one extra BM25 query (~100 ms), one subject-weighted query (~70 ms), ~10–15 more CE pairs (~250 ms).
- **d7** = d6 + the g5 handover search fused with the original question (RRF k=10 of BM25(model query) and BM25(question) mailbox top 20, then g5's own header rerank). Changes the top 3 g5 reads on ~35% of handover hits (lab: +8 hits, +6 misses with AB in g5's top 3).
- **d8** = d6 + YES-seeded g5 handover: the wrapper notes the first email e2b probed YES (matched through the probe prompt, which holds the clipped email) and, while g5 runs, its first own mailbox search returns [YES email, ...BM25(query) top 20]; g5 header-reranks that as usual. Lab: AB in g5's top 3 on hits 535 → 548 (59 top-3 changes), misses 91 → 102. No extra model call, no extra search.
- d1–d5 (dense / deep-BM25 pools): written, not run beyond the d1 smoke (§2).
- **Replay screening on dev sets** (`d6r`, `d7r`, as z-replay.js): x1's stored answer where the change cannot act (d6r: commit and handover questions; d7r: sure commits), the full variant (commit check included) on the rest. Paired and exact on the untouched questions; cheap on the GPU.

Queue (23:18 ET): d8r on S300-1, S300-2, S300-3, FULL-1 (d8r's explore path is exactly d6, so its flips by path give d6's and the seeding's effects separately; the earlier d6r,d7r jobs were cancelled before starting to save GPU time — d7's fusion is dominated by d8's seeding in the lab), then the real **d6 and d8 on S300-4 and S300-5** (my two screening variants; the earlier S300-4/5 d6,d7 and S100 replays were cancelled before they started).

## 4. Development replays: d8r (Wed 03:00–03:30 ET; J1; `tools/d-flips.js d8r S300-1,S300-2,S300-3,FULL-1`)

| set | n | weighted | miss | hit | Δ vs x1 [95% CI] | Δ vs gates [95% CI] | wall ms (x1) | calls (x1) |
|---|---|---|---|---|---|---|---|---|
| S300-1 | 300 | 87.8 | 51.0 | 90.5 | +0.1 [0.0, 0.4] | +4.0 [1.0, 7.3] | 1,862 (1,999) | 5.4 (5.4) |
| S300-2 | 300 | 86.3 | 50.0 | 89.0 | +0.2 [−1.8, 2.2] | +1.3 [−1.9, 4.7] | 1,868 (1,820) | 5.6 (5.6) |
| S300-3 | 300 | 86.3 | 42.0 | 89.5 | +0.3 [−1.0, 1.6] | +2.6 [0.5, 4.8] | 1,698 (1,702) | 5.1 (5.3) |
| FULL-1 | 600 | 87.1 | 48.0 | 90.0 | +1.2 [−0.2, 2.5] | +2.5 [0.6, 4.4] | 1,792 (1,772) | 5.2 (5.4) |
| **pooled** | 1,500 | 87.0 | 47.8 | 89.8 | **+0.6 [0.0, 1.2]** | +2.6 [1.4, 3.8] | 1,802 (1,813) | 5.3 (5.4) |

(Replay: x1's stored answer, wall and calls on the sure-commit questions; d8 run in full on handover and explore questions. Wall of the run rows is from this window, of the replayed rows from x1's run.)

Flips vs x1 by path (n, +, −, identical answer text):

| path | hits | misses |
|---|---|---|
| x1 sure commit (replayed) | 582: 0 / 0 | 106: 0 / 0 |
| explore, d6 list differs from x1's | 36: **+2 / −1** | 152: **+13 / −1** |
| explore, same list | 53: 0 / 0 (44 same text) | 56: 0 / 0 |
| handover, seeding changed g5's top 3 | 45: **+5 / −2** | 62: **+6 / −1** |
| handover, seeding a no-op (YES email already in g5's top 3) | 312: +3 / −2 (237 same text) | 70: 0 / 0 |
| commit check differed from x1's stored run (cross-run noise, S300-3 / FULL-1) | 22: 0 / −1 | 4: +1 / −1 |

- Every unchanged path is identical in text on S300-1 / S300-2 (deterministic); on S300-3 / FULL-1 x1's stored run does not fully reproduce (seed no-op hits 237 / 312 identical texts, +3 / −2; 22 questions took another commit path), which is the noise floor here (±5 per 1,500).
- **The mechanism flips are one-sided:** explore list +15 / −2, g5 seeding +11 / −3. Net ≈ +17 misses (of 450) and +4 hits (of 1,050) ≈ +3.8 miss points and +0.4 hit points ≈ **+0.6 weighted**, as the CI says. That is above the lab's estimate for the explore list (+13 / −1 on changed explore misses vs ≈ +6 expected), and in line with it for the g5 seeding.
- Cost: no extra model calls; the extra BM25 queries and CE pairs run only on explore questions. Wall within the same window ≈ x1's.

## 5. Screening: d6 and d8 on S300-4 + S300-5 (real variants, Wed 03:30–04:10 ET; J1)

| id | set | weighted | miss | hit | Δ vs x1 [95% CI] | Δ vs gates [95% CI] | wall ms (x1) | calls (x1) |
|---|---|---|---|---|---|---|---|---|
| d6 | S300-4 | 86.6 | 53.0 | 89.0 | −0.3 [−1.6, 0.3] | −1.4 [−4.3, 1.9] | 1,926 (1,906) | 5.7 (5.7) |
| d6 | S300-5 | 82.9 | 33.0 | 86.5 | +0.1 [0.1, 0.1] | −0.3 [−2.7, 1.6] | 1,982 (2,391) | 6.0 (6.0) |
| d6 | pooled | 84.7 | 43.0 | 87.8 | **−0.1 [−0.8, 0.2]** | −0.8 [−2.5, 1.8] | 1,954 (2,148) | 5.9 (5.9) |
| d8 | S300-4 | 87.9 | 53.0 | 90.5 | +1.1 [−0.8, 2.9] | +0.0 [−2.9, 3.2] | 1,921 (1,906) | 5.7 (5.7) |
| d8 | S300-5 | 82.7 | 30.0 | 86.5 | −0.1 [−1.4, 1.2] | −0.5 [−3.6, 2.0] | 1,975 (2,391) | 6.0 (6.0) |
| d8 | pooled | 85.3 | 41.5 | 88.5 | **+0.5 [−0.7, 1.6]** | −0.2 [−2.2, 2.6] | 1,948 (2,148) | 5.9 (5.9) |

x1's walls here are the lead's 20:44–21:10 run, inflated by CPU jobs (the lead's note); d6 and d8 ran in the same window as each other (1,954 vs 1,948 ms). Per path, d6/d8's explore questions cost the same as x1's (non-generation time 898 vs 906 ms: the two extra BM25 queries, ~125 ms, are paid back by not CE-scoring foreign emails). No extra model calls.

Flips vs x1 (S300-4 + S300-5; all other paths byte-identical: commit 246 / 246, untouched handovers 206 / 206 texts):

| path | d6 hits | d6 misses | d8 hits | d8 misses |
|---|---|---|---|---|
| explore, list changed | 24: 0 / −1 | 70: **+4 / 0** | 24: 0 / −1 | 70: **+4 / 0** |
| handover, seeding changed g5's top 3 | – | – | 22: **+4 / −1** | 38: 0 / −3 |
| other (commit-path noise) | 0 / 0 | 0 / −1 | 0 / 0 | 0 / −1 |

## 6. Conclusions

- **Best variant: d8** (x1 + lexical explore list + YES-seeded g5 handover search). Δ vs x1: development replays +0.6 [0.0, 1.2] (1,500 questions), screening +0.5 [−0.7, 1.6] (600). **Not a candidate** (bar +1.5). Δ vs gates on S300-4 + S300-5: −0.2 (gates' +0.7 head start over x1 on these two sets).
- **Mechanisms, all 2,100 run questions:** explore list (d6 part) misses +17 / −1, hits +2 / −2; YES-seeding of g5 hits +9 / −3, misses +6 / −4. Both are real, one-sided-ish, and small: ≈ +0.2 weighted (explore list, misses) + ≈ +0.35 (seeding, hits).
- **The ceiling is small, and that is the main result.** Hits are not retrieval-limited: 12 / 1,600 of x1's wrong hits lack an AB email in the final context (all on the g5 handover; d8 targets them). Misses: perfect retrieval + gold-only reading would be worth ≤ +2.4 weighted, the explore list ≤ +0.5, realistic changes ≈ +0.1–0.3.
- **Dense / hybrid retrieval does not help here** and is impractical: nomic dense is a weaker first stage than BM25 in these mailboxes (misses @30 720 vs 928; hits @1 1,568 vs 1,892), adds ≤ 2–3% pool recall on top of BM25 + CE, and a per-question CPU query embedding interleaved with e2b costs ~1 s and slows e2b 3–6× (§2).
- **Thread / Re:-chain expansion, sender/recipient filters and date cues add nothing** (+0 / +2 AB in pools; no Date header in the corpus).
- **Mailbox-context and global-list changes:** gates' header-reranked mailbox top 5 is already the best switched W0; the only large W0 lever is a CE/dense swap into the global list (CE puts AB into W0 for a third of unswitched misses) at the price of rewriting ~90% of unswitched hit prompts — r5 / p3 / x2's ground, not new.

Files: `variants/d-dense.js` (d-qemb, d-qemb-all, d-gemb-all diagnostics), `variants/d-agent.js` (d1–d8, d*r replays), `tools/d-feat.js`, `d-lib.js`, `d-ce.js`, `d-lab.js`, `d-where.js`, `d-g5.js`, `d-plan.js`, `d-flips.js`, `d-stub.js`, `d-stub3.js`, `d-stub6.js`, `d-stub8.js`. Scratch data: `<scratch>/d-feat.jsonl`, `d-qemb.jsonl`, `d-gemb.jsonl`, `d-ce-std.json`, `lab-all-v3.txt`. J1 spend ≈ $0.004.
