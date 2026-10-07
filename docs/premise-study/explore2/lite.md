# Worker lite (round 5): a cheaper point on the accuracy–energy frontier

Prefix `lite`. Code: `explore2/variants/lite-stack.js` (lite-a, lite-u, lite-ub and their det forms). Offline tools: `explore2/tools/lite-cost.js` (where q1 spends time, by path), `lite-handover.js` (g5's value by first-YES doubt), `lite-sim.js` (exact replay of the lite stacks from stored det answers, with a GPU energy model), `lite-power.js` (the energy model's fit), `lite-check.js` (stub call-sequence check), `lite-table.js` (results vs the det baselines, flips by path). Started Wed 7 Oct 11:30 ET.

Task (lead): q1 = x1 + d8 + m2 is the best system (FULL-2 86.8 det, +1.4 [0.6, 2.2] vs det x1, 218 GPU J per correct answer). Its most expensive path is x1's g5 handover. Hypothesis: m2's recovery (and d6's explore list) bought most of q1's gain cheaply, so t-lk (no handover) + m2 (+ d6) may reach det-x1-level accuracy at 55–65% of q1's energy per correct answer.

## 1. Where q1 spends its time (S300-1, det; `tools/lite-cost.js`)

q-det-q1 minus i-det-tlk on the same question, by q1's path (ms; det x1's g5 part = det x1 − det t-lk):

| q1 path | n | Δwall | Δgen (GPU) | Δnon-gen (CPU) | Δcalls (incl. resets) | recovery probes | E found at probe # |
|---|---|---|---|---|---|---|---|
| sure commit | 94 | −18 | −10 | −8 | 0 | 0 | |
| sure commit, m2 probed, no E | 39 | +1,986 | +774 | +1,212 | +12 | 6 | |
| m2 recovery, A sure | 8 | +2,088 | +951 | +1,136 | +6 | 2.0 | 1,4,3,3,1,1,1,2 |
| m2 recovery, A unsure (replaces g5) | 11 | +2,025 | +930 | +1,094 | +5.8 | 1.9 | 3,2,1,2,6,1,2,1,1,1,1 |
| g5 handover (seeded) | 64 | +1,517 | +1,361 | +155 | +7.6 | 0 | (det x1's g5: +1,565 / +1,395 gen) |
| m2 probes (no E), then seeded g5 | 25 | +3,604 | +2,203 | +1,401 | +19.5 | 6 | |
| explore (d6 list, full x1 explore) | 59 | +764 | +631 | +133 | +6.9 | | |

- **m2 is not cheap.** Each firing costs about 2 s: 1.1–1.4 s of CPU for the recovery list (MiniLM cross-encoder over the asker's mailbox BM25 top 50, standard and snippet texts) plus 6 YES/NO probes (≈ 0.8 s with det's resets). It fires on 28% of questions (yes1 lp < −0.1), sure commits included (47 of 83 firings), where it rarely finds an E (8 of 47).
- **g5's handover costs about 1.5 s, almost all of it GPU** (1.36–1.40 s generation).
- So per firing m2 costs more wall time than the g5 handover it can replace, but less GPU time (≈ 0.8 vs 1.4 s); its CPU part runs while the GPU idles at about 33 W (§5).
- E is found within the first 3 recovery probes in 16 of 19 recoveries.

## 2. What the g5 handover is worth, by first-YES doubt (`tools/lite-handover.js`)

On x1's handover questions (commit, A unsure), x1's g5 answer vs t-lk's kept answer A (x1 better / worse):

| comparison | set | hit, yes1 doubted (lp < −0.1) | hit, yes1 confident | miss, yes1 doubted | miss, yes1 confident |
|---|---|---|---|---|---|
| x1 vs t-lk (unwrapped) | S300-1 | 20: +2/−0 | 47: +1/−1 | 19: +1/−1 | 13: +3/−2 |
| x1 vs t-lk (unwrapped) | S300-2 | 26: +1/−2 | 46: +2/−1 | 21: +4/−2 | 11: +0/−2 |
| x1 vs t-lk (unwrapped) | S300-3 | 28: +2/−1 | 37: +0/−1 | 16: +2/−1 | 6: +0/−0 |
| x1 vs t-lk (unwrapped) | FULL-1 | 55: +4/−4 | 118: +8/−2 | 34: +6/−2 | 14: +2/−2 |
| x1 vs t-lk (unwrapped) | pooled (1,500) | 129: +9/−7 | 248: +11/−5 | 90: +13/−6 | 44: +5/−6 |
| det x1 vs det t-lk | S300-1 | 18: +2/−0 | 48: +2/−2 | 18: +2/−2 | 16: +3/−1 |

- The handover is worth about +8 hits and +6 misses net per 1,500 dev questions, ≈ +0.8 weighted, with most of it a coin flip per question (+38/−24 overall).
- Per handover, the doubted-YES ones pay more (net +9 of 219, 4.1%) than the confident-YES ones (net +5 of 292, 1.7%), and d8's seed helps exactly on doubted ones (d.md / q.md: hits +6/−1, misses +3/−1). That motivates a selective handover: only where both signals doubt the commit (and m2 found no E).

## 3. Variants (`variants/lite-stack.js`; all imported, nothing copied)

| id | t-lk core | explore list | m2 recovery | g5 handover |
|---|---|---|---|---|
| **lite-a** | yes | d6 | as q1: first-YES lp < −0.1, A sure or unsure | none |
| **lite-u** | yes | d6 | only on doubted AND unsure commits (yes1 lp < −0.1 and A unsure) | none |
| **lite-ub** | yes | d6 | as lite-u | d8-seeded g5 only on doubted, unsure commits where m2 found no E |

Decision tree on a commit (yes1 = first W0 YES, A = gates' answer over W0, computed by t-lk):

| yes1 lp | A | lite-a | lite-u | lite-ub | q1 (for reference) |
|---|---|---|---|---|---|
| ≥ −0.1 | sure | A | A | A | A |
| ≥ −0.1 | unsure | A | A | A | seeded g5 |
| < −0.1 | sure | m2: E → [E, W0 top 4], else A | A | A | m2, else A |
| < −0.1 | unsure, E | [E, W0 top 4] | [E, W0 top 4] | [E, W0 top 4] | [E, W0 top 4] |
| < −0.1 | unsure, no E | A | A | seeded g5 | seeded g5 |
| no YES | – | lean explore (one pick + check), d6 list | same | same | full x1 explore, d6 list |

- Implementation: t-lk (`t-ladder.js` VARIANTS, `simpleX1` with no handover) runs unchanged on d6's ctx (`d-agent.js` `lexicalPoolCtx`; the list hook fires only on the explore path, where t-lk loads the CE). The wrapper then runs m2's recovery with `m-agent.js`'s `x1Contexts`, `recoveryLists`, `lpProbe` on the plain ctx with q1's arguments (mailbox-only snip50m, top 6, accept the first YES with lp ≥ yes1's) and answers [E, W0 top 4] with the sandwich prompt and abstain retry over W1, as q1 and m2 do. lite-ub then runs `g-agent.js`'s g5 on the same d6 ctx with a search hook that puts yes1 on top of g5's first own mailbox search (d8's rule: k 20, the asker's mailbox, a query other than the question, once).
- det forms `lite-det-a`, `lite-det-u`, `lite-det-ub`: `det(…, { mode: "all" })` from `i-det.js` v2, as `i-det-x1` v2, `q-det-q1`, `i-det-tlk` v2 and `i-det-gates` v2.

## 4. Stub check (`tools/lite-check.js`, no GPU; log `.data/premise2/explore/lite-check.log`)

q-check's scripted model (W0 probe YES/NO and token lp, A's mean lp, recovery probes, picks, plan, g5's two tool turns); real BM25, CE, d6 list, m2 list and g5 code; every call hashed with its exact prompt. 8 scenarios × 3 S300-2 questions × 3 variants, each against its parents (q1, t-lk, m2), plus every det form against its plain form:

| scenario | lite-a | lite-u | lite-ub |
|---|---|---|---|
| S1 sure commit | = q1 = t-lk | = q1 = t-lk | = q1 = t-lk |
| S2 unsure commit, yes1 sure | = t-lk; = q1 minus g5 | same | same |
| S3 doubted, A sure, no E | = q1 = m2 | = t-lk; = q1 minus recovery probes | as lite-u |
| S4 doubted, A sure, E | = q1 = m2 | = t-lk | = t-lk |
| S5 doubted, A unsure, E | = q1 = m2 | = q1 = m2 | = q1 = m2 |
| S6 doubted, A unsure, no E | = q1 minus g5 | = q1 minus g5 | **= q1** (same seeded g5 tool result) |
| S7 recovery YES below yes1, A unsure | = q1 minus g5 | = q1 minus g5 | = q1 |
| S8 explore | pick + probe = q1's first pick + probe; final prompt = q1's | same | same |

"= q1 minus g5": q1's exact sequence with its g5 calls (two tool turns and g5's final answer) removed. det forms: the same real calls, each preceded by exactly one reset. **183 checks, 0 failures.**

## 5. Exact offline replay on S300-1 (`tools/lite-sim.js`; no GPU)

Behind det every call sequence reproduces byte-identically, so on S300-1 (where `i-det-x1`, `q-det-q1`, `i-det-tlk` and `i-det-gates` all exist) a lite variant's answer is a stored det answer on 298 of 300 questions: q1's on its sure commits, recoveries and lean-compatible explores; det t-lk's A where the handover is dropped; q1's seeded g5 where lite-ub keeps it. 2 questions (q1 found its email at open 2–3 and det t-lk's first pick differs) are unknown and left out. Cost per question is assembled from the same records (q1's wall minus det x1's g5 part, etc.).

GPU energy model (`tools/lite-power.js`): GPU J/q = 110.9 W × generation s + 33.5 W × non-generation s, fitted on worker i's 7 measured S300-1 runs (design-weighted; fit within ±5% of each run except pb/gates, −8%).

| design (S300-1, det, n 298) | W | miss | hit | Δ vs det x1 | Δ vs det q1 | Δ vs det t-lk | wall ms (dw) | model GPU J/q | J per correct |
|---|---|---|---|---|---|---|---|---|---|
| det gates | 83.9 | | | | | | 790 (789) | 76 (meas. 79) | 90 (meas. 95) |
| det t-lk | 86.1 | | | | | | 1,283 (1,180) | 113 (meas. 109) | 132 (meas. 127) |
| t-lk + d6 only | 86.1 | 47.5 | 88.9 | −1.14 | −1.49 | +0.07 | 1,298 (1,188) | 113 | 131 |
| **lite-u** | 86.3 | 50.5 | 88.9 | −0.94 [−3.3, 1.3] | −1.28 | +0.27 [0.0, 0.6] | 1,540 (1,382) | 125 | **145** |
| lite-u, recN 3 | 86.3 | 50.5 | 88.9 | −0.94 | −1.28 | +0.27 | 1,506 (1,349) | 122 | 141 |
| **lite-a** | 86.5 | 52.5 | 88.9 | −0.80 [−3.2, 1.4] | −1.14 | +0.41 [0.1, 0.8] | 1,856 (1,703) | 146 | **169** |
| **lite-ub** | 87.2 | 49.5 | 89.9 | −0.07 [−1.9, 1.7] | −0.41 | +1.14 [0.0, 2.6] | 1,675 (1,522) | 140 | **160** |
| lite-a + selective g5 ("lite-b") | 87.3 | 51.5 | 89.9 | +0.07 | −0.27 | +1.28 | 1,991 (1,843) | 160 | 183 |
| det x1 | 87.3 | 50.0 | 90.0 | | | | 1,947 (1,813) | 179 (meas. 173) | 205 (meas. 199) |
| det q1 | 87.7 | 56.0 | 90.0 | | | | 2,440 (2,296) | 207 | 237 (FULL-2 meas. 218) |

(CIs: mailbox-cluster paired bootstrap, analyze.js. "dw" = design-weighted, as the energy tables.)

- **lite-a (the literal hypothesis) is dominated on S300-1:** −0.8 vs det x1 at 1,856 ms, i.e. det-x1 wall time minus 5%. m2 on sure commits costs about 320 ms/question for misses +2/0.
- **lite-u** is t-lk + 0.3 at +20% wall; 61% of q1's modelled J per correct.
- **lite-ub** matches det x1 here (−0.07) at −14% wall, −22% modelled GPU energy; 68% of q1's modelled J per correct. Its edge over lite-u is the selective g5 on 25 doubted, unsure, no-E commits (hits +2/0, misses +2/−3 vs A), which is S300-1-specific evidence (pooled dev: §2).

## 6. GPU runs

### S300-1 (`run S300-1 lite-det-ub,lite-det-u`, 12:22–12:38 ET; energy logger and CPU sampler running)

**The replay was exact:** for both variants, 298 of 298 predicted answers are byte-identical to the real run (`lite-sim.js --check=…`); the 2 unknowns were misses answered wrong. The estimated wall is within 1–2% (lite-det-ub 1,655 real vs 1,675 estimated; lite-det-u 1,515 vs 1,540).

| S300-1 (det) | W | miss | hit | Δ vs det x1 [95% CI] (disc. miss · hit) | Δ vs det q1 | Δ vs det t-lk | Δ vs det gates | wall ms (p95) | calls (real) | GPU J/q (dw, ±95%) | GPU W | GPU J per correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **lite-det-ub** | 87.2 | 49.0 | 90.0 | −0.07 [−1.9, 1.7] (+5/−6 · +2/−2) | −0.48 [−2.3, 1.4] | +1.14 [0.0, 2.5] (+6/−3 · +2/−0) | +3.35 [1.4, 5.5] | 1,663 (4,388) | 8.70 (4.35) | **133** ±12 | 88 | **153** |
| **lite-det-u** | 86.3 | 50.0 | 89.0 | −0.93 [−3.3, 1.3] (+7/−7 · +2/−4) | −1.34 [−3.8, 1.1] | +0.27 [0.0, 0.6] (+4/−0 · 0/0) | +2.49 [0.9, 4.5] | 1,523 (3,238) | 8.07 (4.04) | **119** ±7 | 87 | **138** |
| det x1 (i, Wed 00:17) | 87.3 | 50.0 | 90.0 | – | | | | 1,947 (3,529) | 10.77 (5.38) | 173 ±12 | 96 | 199 |
| q1 unwrapped (lead, Wed 10:57) | 88.2 | 56.0 | 90.5 | | | | | 2,261 (4,212) | 6.70 | 189 ±13 | 88 | 214 |
| det q1 (q, Wed 07:56; no energy log) | 87.7 | 56.0 | 90.0 | +0.41 | – | | | 2,440 (4,438) | 13.43 (6.71) | (≈ 197: model 207 less its ~5% overestimate) | | (≈ 225) |
| det t-lk (i, Wed 01:18) | 86.1 | 46.0 | 89.0 | | | – | | 1,283 | 6.9 (3.4) | 109 ±7 | 92 | 127 |
| det gates (i) | 83.9 | | | | | | – | 790 | 2.0 (1.0) | 79 ±4 | 101 | 95 |

Energy: `tools/i-energy.js --log r5-energy.jsonl --cpu r5-cpu.jsonl --set S300-1 --idle i-idle` (idle 6.6 W from 8 windows); design-weighted per-question GPU board energy (gross), as Table 3 of v5-final.md. The det x1, det t-lk and det gates rows are worker i's S300-1 measurements (i.md §8); q1's is the lead's unwrapped S300-1 run.

- **lite-det-ub** matches det x1 on S300-1 (−0.07) at **−23% GPU energy per correct answer** (153 vs 199) and −15% wall; it is **72% of q1's 214** GPU J per correct (unwrapped q1; det q1 adds ≈ 5%, so ≈ 68% of det q1).
- **lite-det-u** is t-lk + 0.27 for +9% energy per correct; between t-lk and lite-ub it buys little.

### S300-2 (det baselines and lite run in this window: `i-det-x1,lite-det-ub` 12:38–12:57, `i-det-tlk,lite-det-u` 12:57–13:12, `q-det-q1` 13:12–13:24 ET)

| S300-2 (det) | W | miss | hit | Δ vs det x1 [95% CI] (disc. miss · hit) | Δ vs det q1 | Δ vs det t-lk | Δ vs gates | wall ms (p95) | calls (real) | GPU J/q (dw ±95%) | GPU W | GPU J per correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **lite-det-ub** | 86.7 | 48.0 | 89.5 | −0.86 [−2.5, 0.3] (+5/−4 · 0/−2) | −0.07 [−0.2, 0.0] (0/−1 · 0/0) | +0.60 [−1.9, 3.0] (+4/−2 · +3/−2) | +1.62 [−1.3, 4.5] | 1,818 (4,690) | 9.67 (4.83) | **146** ±13 | 88 | **168** |
| **lite-det-u** | 86.2 | 48.0 | 89.0 | −1.33 [−3.5, 0.4] (+6/−5 · +1/−4) | −0.53 [−2.8, 2.1] | +0.14 [−0.1, 0.4] (+3/−1 · 0/0) | +1.16 [−0.2, 2.6] | 1,636 (3,362) | 8.75 (4.38) | **124** ±8 | 86 | **144** |
| i-det-x1 | 87.5 | 49.0 | 90.5 | – | | | | 1,949 (3,651) | 11.19 (5.60) | 173 ±12 | 98 | 198 |
| q-det-q1 | 86.7 | 49.0 | 89.5 | −0.80 | – | | | 2,445 (4,726) | 13.65 (6.82) | 199 ±14 | 88 | 229 |
| i-det-tlk | 86.1 | 45.0 | 89.0 | | | – | | 1,293 (2,587) | 7.09 (3.54) | 109 ±7 | 95 | 126 |
| gates (stored; = det gates, i.md §7) | 85.1 | | | | | | – | 763 | 1.04 | | | |

- On S300-2 q1 itself is −0.8 vs det x1 (its S300-1 gain was +0.4, fresh sets +1.3), and lite-det-ub equals det q1 (one miss apart) at **73% of q1's GPU energy per correct answer** (168 vs 229) and −26% wall.

### Pooled S300-1 + S300-2 (600 det-paired questions; `tools/q-stats.js`)

| contrast | discordant misses | discordant hits | Δ | mailbox-cluster 95% CI | stratified 95% CI | sign-flip p |
|---|---|---|---|---|---|---|
| lite-det-ub − det x1 | +10/−10 | +2/−4 | −0.47 | [−1.60, 0.58] | [−1.64, 0.66] | 0.50 |
| lite-det-ub − det q1 | +1/−9 | +2/−2 | −0.27 | [−1.14, 0.61] | [−1.20, 0.66] | 0.60 |
| lite-det-ub − det t-lk | +10/−5 | +5/−2 | +0.87 | [−0.56, 2.24] | [−0.33, 2.14] | 0.17 |
| lite-det-u − det x1 | +13/−12 | +3/−8 | −1.13 | [−2.75, 0.22] | [−2.69, 0.37] | 0.17 |
| lite-det-u − det q1 | +5/−12 | +4/−7 | −0.94 | [−2.70, 0.70] | [−2.48, 0.56] | 0.24 |
| lite-det-u − det t-lk | +7/−1 | 0/0 | +0.20 | [0.00, 0.47] | [0.03, 0.41] | 0.07 |

**lite-det-ub vs det q1, by path (S300-1 + S300-2):** every path on which lite-ub issues q1's calls is byte-identical to det q1: sure commits 260/260, recover-unsure 21/21, seeded g5 on doubted unsure no-E commits 61/61. All discordant pairs sit on the three mechanisms lite-ub drops:

| q1 mechanism dropped by lite-ub | hits n: +/− | misses n: +/− |
|---|---|---|
| g5 handover with a confident first YES (lite-ub keeps A) | 92: +2/−2 | 28: +1/−3 |
| x1's full explore (search, opens 2–3) → lean explore | 42: 0/0 | 83: 0/−4 |
| m2 recovery on sure commits (lite-ub keeps A) | 3: 0/0 | 10: 0/−2 |

So the price of lite-ub's savings is about 8 misses per 200 (≈ −0.27 weighted) and nothing on hits; the confident-YES handover, the most expensive of the three, is a coin flip on hits (+2/−2).

### S300-3 (`i-det-x1,lite-det-ub` 13:24–13:42, `i-det-tlk,lite-det-u` 13:42–13:57, `q-det-q1` 14:32–14:44 ET, after the lead's FULL-3/FULL-2 lite-det-ub runs)

| S300-3 (det) | W | miss | hit | Δ vs det x1 [95% CI] (disc. miss · hit) | Δ vs det t-lk | Δ vs gates | wall ms (p95) | calls (real) | GPU J/q (dw ±95%) | GPU W | GPU J per correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **lite-det-ub** | 85.7 | 41.0 | 89.0 | +0.20 [−1.3, 1.6] (+8/−5 · +1/−1) | +0.94 [−0.8, 2.6] (+7/0 · +2/−1) | +2.03 [−0.1, 4.3] | 1,746 (4,640) | 9.43 (4.72) | **139** ±13 | 89 | **162** |
| **lite-det-u** | 85.2 | 40.0 | 88.5 | −0.33 [−1.9, 1.3] (+7/−5 · +1/−2) | +0.41 [0.2, 0.7] (+6/0 · 0/0) | +1.50 [0.7, 2.5] | 1,568 (3,122) | 8.56 (4.28) | **120** ±7 | 88 | **140** |
| i-det-x1 | 85.5 | | | – | | | 1,836 (3,459) | 10.41 (5.21) | 161 ±12 | 99 | 188 |
| i-det-tlk | 84.8 | | | | – | | 1,259 (2,483) | 6.95 (3.48) | 103 ±5 | 96 | 122 |
| q-det-q1 | 86.5 | | | +1.0 | | | 2,344 | | 186 ±14 | 86 | 215 |

lite-det-ub − det q1 on S300-3: −0.81 [−2.0, 0.0] (misses 0/−5, hits 0/−1); lite-det-u − det q1: −1.34 [−3.1, 0.5].

### Pooled over the three dev sets (900 det-paired questions; `tools/q-stats.js`)

| contrast | discordant misses | discordant hits | Δ | mailbox-cluster 95% CI | stratified 95% CI | sign-flip p |
|---|---|---|---|---|---|---|
| **lite-det-ub − det x1** | +18/−15 | +3/−5 | **−0.24** | [−1.22, 0.70] | [−1.16, 0.64] | 0.64 |
| lite-det-ub − det t-lk | +17/−5 | +7/−3 | +0.89 | [−0.27, 1.90] | [−0.08, 1.89] | 0.07 |
| lite-det-u − det x1 | +20/−17 | +4/−10 | −0.86 | [−1.98, 0.15] | [−2.06, 0.29] | 0.16 |
| **lite-det-u − det t-lk** | +13/−1 | 0/0 | **+0.27** | [0.12, 0.43] | [0.11, 0.43] | 0.002 |
| lite-det-ub − lite-det-u | +4/−4 | +7/−3 | +0.62 | [−0.45, 1.60] | [−0.33, 1.62] | 0.26 |
| det x1 − det t-lk (reference) | +18/−9 | +10/−4 | +1.14 | [0.08, 2.31] | [0.00, 2.31] | 0.06 |
| **lite-det-ub − det q1** | +1/−14 | +2/−3 | **−0.45** | [−1.16, 0.20] | [−1.16, 0.24] | 0.22 |
| lite-det-u − det q1 | +5/−18 | +5/−10 | −1.07 | [−2.32, 0.14] | [−2.29, 0.10] | 0.08 |
| det q1 − det x1 (reference) | +22/−6 | +1/−2 | +0.21 | [−0.38, 0.76] | [−0.39, 0.76] | 0.46 |

**lite-det-ub vs det q1 over the three sets:** every path on which lite-ub issues q1's calls is byte-identical to det q1, **529/529** (sure commits 341 + 61, seeded g5 71 + 24, recover-unsure 3 + 29). The discordant pairs are only on the dropped mechanisms: confident-YES handover kept as A (hits 131: +2/−3, misses 33: +1/−3), lean explore (misses 138: 0/−7), no recovery on sure commits (misses 15: 0/−4).

## 7. The frontier (dev sets, det, GPU board energy)

Means of the per-set design-weighted values over S300-1, S300-2, S300-3 (det x1 and det t-lk on S300-1 are worker i's measurements; q1 has energy on S300-1 unwrapped and on S300-2 and S300-3 det):

| system | W (3 sets) | wall ms | real calls/q | GPU J/q | **GPU J per correct** | vs det x1 | vs q1 |
|---|---|---|---|---|---|---|---|
| det t-lk | 85.67 | 1,278 | 3.5 | 107 | **125** | −36% | 57% |
| lite-det-u | 85.90 | 1,576 | 4.2 | 121 | **141** | −28% | 64% |
| **lite-det-ub** | **86.53** | 1,742 | 4.6 | 139 | **161** | **−18%** | **73%** |
| det x1 | 86.77 | 1,911 | 5.4 | 169 | **195** | – | 89% |
| det q1 (energy: S300-1 unwrapped 189 J/q, S300-2 199, S300-3 186) | 86.97 | 2,409 | 6.7 | 191 | **220** | +13% | – |

- **lite-ub is det-x1 accuracy at −18% GPU energy per correct answer** (−0.24 [−1.22, 0.70] over 900 questions) and 73% of q1's (220). Against det q1 it is −0.45 [−1.16, 0.20]; q1 itself is +0.21 [−0.38, 0.76] vs det x1 on these dev sets (its fresh-set gain is +1.3, so lite-ub’s distance to q1 may be larger on fresh questions; the lead’s FULL-3 / FULL-2 lite-det-ub runs measure it).
- **lite-u is not on the convex frontier:** the straight line from det t-lk to lite-ub passes 135 J per correct at lite-u's accuracy, below lite-u's 141. Its +0.27 over t-lk is real (p = 0.002, all on misses: m2's recovery replacing kept unsure answers, +13/−1) but costs +13% energy. It hits the "55–65% of q1" target on energy only by giving back x1's accuracy (−0.86 vs det x1).
- **lite-a** (the literal hypothesis, not run: its S300-1 replay is exact by construction and the replay was confirmed 596/596 on lite-ub and lite-u): 86.5 on S300-1 (−0.80 vs det x1) at det-x1-like wall, ≈ 160 J per correct (model, which overestimates by ~5%); dominated by lite-ub (87.2, 153 measured).

## 8. Conclusions

1. **The hypothesis is half right.** m2's recovery is real (lite-u − det t-lk +0.27 [0.12, 0.43], misses +13/−1 over 900 questions), but it is not cheap: about 2 s per firing (1.1–1.4 s of CPU for the snippet cross-encoder list over the mailbox top 50, plus up to 6 probes). Added to t-lk on every doubted commit (lite-a), it costs nearly what the g5 handover costs in wall time, and on S300-1 lite-a is −0.8 vs det x1 at det-x1 wall time.
2. **What works is a selective handover.** lite-ub keeps g5 (seeded with the first YES, d8) only where both confidence signals doubt the commit and the recovery found nothing (95 of 900 questions, 11%), runs m2 only on doubted unsure commits (about 14%), and keeps gates' answer on unsure commits with a confident first YES (where g5 is nearly a coin flip: hits +2/−2 and misses +1/−3 vs det q1 here; hits +11/−5 and misses +5/−6 over 1,500 unwrapped dev questions, §2). Over 900 dev questions it is **−0.24 [−1.22, 0.70] vs det x1, at −18% GPU energy per correct answer (161 vs 195 J) and −9% wall**, and 73% of q1's energy per correct answer (−0.45 [−1.16, 0.20] vs det q1).
3. **Against q1 it loses only on misses, and only through the mechanisms it drops:** every path where lite-ub issues q1's calls is byte-identical to det q1 (529/529 over the three sets), and the discordant pairs are misses +1/−14, hits +2/−3 (confident-YES handover kept as A, lean explore, no recovery on sure commits). On fresh sets, where q1's miss mechanisms paid more (+1.3 vs det x1), lite-ub should give back more of that than here.
4. **det made this cheap to design:** the S300-1 replay from stored det answers predicted both real runs exactly (596/596 answers byte-identical, wall within 2%).
5. **Not a promotion candidate** (it does not beat x1); it is a Pareto point for the paper: x1-level accuracy at between t-lk's and x1's energy.

**Recommendation for FULL-3: `lite-det-ub` (v1)** (the lead is already running it). lite-det-u does not beat it: it is 0.62 lower in accuracy (ub − u +0.62 [−0.45, 1.60]; hits +7/−3) for −12% energy per correct answer, and it is off the convex frontier.

## Files

- `benchmarks/premise2/explore2/variants/lite-stack.js`: `liteStack`; variants `lite-a`, `lite-u`, `lite-ub` (plain) and `lite-det-a`, `lite-det-u`, `lite-det-ub` (det, mode all). Imports t-ladder (t-lk), m-agent (`x1Contexts`, `recoveryLists`, `lpProbe`), d-agent (`lexicalPoolCtx`), g-agent (g5), i-det (`det`).
- `benchmarks/premise2/explore2/tools/lite-check.js`: stub call-sequence check (log `.data/premise2/explore/lite-check.log`; 183 checks, 0 failures).
- `benchmarks/premise2/explore2/tools/lite-sim.js`: exact replay from stored det answers (S300-1), cost and energy model, `--check=<id>` real-vs-replay comparison, `--paths` flips by path.
- `benchmarks/premise2/explore2/tools/lite-cost.js`: q1's time by path (m2 vs g5).
- `benchmarks/premise2/explore2/tools/lite-handover.js`: g5's value by first-YES doubt.
- `benchmarks/premise2/explore2/tools/lite-power.js`: two-term GPU energy model fit.
- `benchmarks/premise2/explore2/tools/lite-table.js`: per-set/pooled results vs the det baselines, flips by path, walls and calls.
- Run logs: `.data/premise2/explore/lite-chain.log`, `lite-run-*.log`. Energy summaries were written to the scratchpad (re-create with `tools/i-energy.js --log .data/premise2/explore/r5-energy.jsonl --cpu .data/premise2/explore/r5-cpu.jsonl --set <set> --variants <ids> --idle i-idle`). J1 spend ≈ $0.0003.
