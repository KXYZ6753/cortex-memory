# Worker m: x1's misses (round 3)

Prefix `m`. Code: `explore2/variants/m-*.js`, tools `explore2/tools/m-*.js`. Angle: misses (gold not in P-B's global top 5); raise recall into x1's working set / explore step without changing hit prompts.

## 1. Anatomy of x1's misses (offline; `tools/m-anatomy.js`, `m-paths.js`)

AB = gold, twins, or answer-bearing by EvidenceCache (as everywhere). Outcome classes of x1's 350 misses (S300-2 100, S300-1 100, FULL-0 150):

| class | S300-2 | S300-1 | FULL-0 | per 100 (pooled) |
|---|---|---|---|---|
| correct | 47 | 49 | 69 | 47.1 |
| wrong, false YES stop (YES on a non-AB W0 email) | 22 | 30 | 35 | 24.9 |
| wrong, true YES (AB in W0, read wrong) | 5 | 3 | 10 | 5.1 |
| wrong, explore found AB (read wrong) | 7 | 0 | 3 | 2.9 |
| wrong, explore found a non-AB email (false YES in explore) | 1 | 5 | 12 | 5.1 |
| wrong, explore: AB listed/searched but not picked/YES | 8 | 7 | 10 | 7.1 |
| wrong, explore: AB never shown | 10 | 6 | 11 | 7.7 |

x1 by path (correct / n; gates on the same questions in brackets):

| path | S300-2 | S300-1 | FULL-0 |
|---|---|---|---|
| miss commit, false YES | 1/6 [1] | 2/16 [2] | 3/22 [3] |
| miss commit→g5, false YES | 4/21 [4] | 8/24 [9] | 7/23 [4] |
| miss commit (+g5), true YES | 21/26 [21] | 20/23 [18] | 33/43 [35] |
| miss found | 15/23 [2] | 15/20 [3] | 15/30 [5] |
| miss nofound | 6/24 [3] | 4/17 [2] | 11/32 [9] |

**False-YES stops (112 of 350 misses, 25 correct).** The YES email:
- is in the asker's mailbox (110/112), at W0 rank 1 in 63/112;
- is **not** a thread sibling or near-duplicate of the gold: same normalised subject 12/112, near-dup 6/112, gold quoted inside it (≥ 0.3 shingle containment) 11/112; same sender as the gold in 57/112 (≈ base rate in a mailbox);
- covers the question's content words as well as the gold does (0.54 vs 0.52) but not the answer's novel words (0.22 vs 0.76). It is a *topical* match without the answer: thread expansion or twin comparison has nothing to work with (≤ 12/112 cases).
- Gold location: mailbox BM25 top 10 in 11/27 (S300-2), 24/40 (S300-1), 30/45 (FULL-0); CE top 5 of mailbox 50 + global 10 in 8/27, 15/40, 26/45. S300-2's false stops are deeper (8/27 gold beyond mailbox rank 100).

**Never shown (27 of 350).** Gold mailbox BM25 rank mostly > 30 (S300-2: 9/10 beyond 20, 5 beyond 100): a question-BM25 problem, not a list-length problem.

## 2. Recall into a recovery / explore list (W0 excluded; `tools/m-recall.js`)

AB in list top 5 / 10 / 15, all misses:

| list | S300-2 | S300-1 | FULL-0 |
|---|---|---|---|
| x1's explore list (CE over W1 ∪ mailbox 30) | 30/43/44 | 36/45/50 | 42/55/56 |
| CE over mailbox 50 ∪ global 10 | 34/44/48 | 35/48/51 | 47/58/65 |
| **max(CE std, CE snippet), mailbox 50 ∪ global 10 (p3's score)** | 36/47/53 | 42/56/58 | 51/65/68 |
| owner-name-stripped mailbox BM25 | 29/41/46 | 47/56/57 | 46/58/62 |
| subject×3 / sender×2 mailbox BM25 | 34/43/45 | 44/52/55 | 45/58/63 |
| question names as sender/recipient filter | 4/10/12 | 12/20/20 | 19/23/24 |
| nomic dense mailbox 30 (S300-2 only) | 22/28/34 | | |
| RRF(CE50, stripped, subject-weighted) | 38/46/52 | 50/55/57 | 49/64/68 |

- The snippet-CE list (`snip50`) is the most consistent gain over x1's list (+4 / +11 / +10 at top 10). Dense and name filters are worse than BM25/CE; dropped.
- On the explore-path wrong misses (26 / 18 / 36) AB in top 10 goes 12→15, 7→13, 11→13: worth ≈ +1–2 miss points (the model picks a listed AB 60–80%).
- On false-YES wrong misses AB is in snip50's top 10 in 7/22, 20/30, 25/35 (x1's own list: 5, 15, 20): this is where the recoverable mass is, if the recovery can tell the gold from the false YES.
- Smaller/cheaper pools (top 5/10/15, all misses): snip over mailbox 30 + global 10: 31/39/47, 38/49/53, 49/63/66; **snip over the asker's mailbox top 50 only (`snip50m`): 41/49/54, 49/58/59, 51/62/64**, the best top 5 on every set (globals from other mailboxes mostly add distractors). CPU cost of the CE lists: ≈ 1.5 s/question for mailbox 50 + global 10 (std + snippet text; `tools/m-cetime.js`), so a recovery step can only run on a minority of questions within the 3,243 ms cap (x1 ≈ 1.9 s).

**Explore-path wrong misses** (`tools/m-explore.js`; S300-2 / S300-1 / FULL-0): AB never in the 15-line list 10/6/14 (nofound) + 1/3/10 (found a non-AB email); AB listed but not picked 4/3/6 (+0/2/2 found another email); AB picked but probed NO 4/4/1; AB found and read wrong 7/0/3. When AB is listed it is mostly at positions 1–5 (75/99), so a better list (snip50m) is the only explore-side lever, worth ≈ +1–2 miss points.

**Lead relay (worker z): recovery target for doubted-YES / handover misses.** `tools/m-handover.js` looks at committed x1 misses that are wrong and have no AB email in x1's final context. Counts are the n for each set, then how many of them have AB in the snip50m list top 3 / 5 / 10 (W0 excluded), then mailbox BM25 top 30:
- S300-2: handover 18 → 1/2/3, 6; sure commit 3 → 1/2/2, 1.
- S300-1: handover 15 → 8/9/10, 13; sure commit 13 → 7/9/10, 10.
- FULL-0: handover 15 → 8/8/10, 8; sure commit 14 → 10/10/12, 14.

So: (a) about half the target lies in the *sure* branch (confident wrong answers on a false YES), not only in the handover. (b) On S300-1 and FULL-0 the snippet-CE top 5 holds AB for 60–65% of the target. On S300-2 it holds it for only 4/21; there the gold sits deep (8/27 false stops beyond mailbox rank 100). (c) With perfect probing and reading, the ceiling is +4 / +18 / +12 miss points ≈ +0.3 / +1.2 / +0.8 weighted. Realistically about half of that, after the YES probe (70% on AB) and slot-5 reading (~75%).

## 3. GPU diagnostic `m-diag` (S300-1, S300-2; no answers)

For each question, `m-diag` runs:
- x1's W0 with **all five** emails probed (YES/NO with logprobs, x1's exact probe);
- probes of the top 10 of two recovery lists (W0 excluded): snip50 = max(CE std, CE snippet) over mailbox 50 + global 10, and rrf3 = RRF(CE, owner-stripped BM25, subject-weighted BM25);
- a single-email extract answer for each YES email;
- a pairwise "which email" probe (both orders) between the first W0 YES and the best recovery YES.

It takes 4.3 s/question. W0 YES decisions reproduce x1's first YES on 297/300 (S300-1).

The simulator is `tools/m-sim.js`. A rule fires on committed x1 questions and walks the recovery list until it accepts a YES. The accepted email E goes into the context. The table counts "miss gain" (AB recovered where x1 was wrong), changed prompts of x1-right misses, and changed hit prompts.

Probe statistics (`tools/m-probestats.js`, S300-1):
- **YES rate:** W0 probes say YES on 255/366 AB vs 127/1,134 non-AB; recovery-list probes on 133/321 AB vs 232/4,298 non-AB.
- **YES logprob is the discriminator:** median yesLp of a recovery YES is −0.05 on AB vs −0.22 on non-AB.
- **Extract abstention is useless:** it abstains on 10/230 non-AB YES emails.
- **Pairwise probe is weak:** with the first YES on AB, it votes for the recovery email 0/1/2 times out of 2 orders in 20/13/2 cases; with the first YES non-AB and the recovery email AB, 2/3/6.

S300-1 rules (selection; each line = fired / misses gained / x1-right misses changed / hit prompts changed (sure-branch hits)):

| trigger | list, N | accept | fired | gain | missOk chg | hit chg |
|---|---|---|---|---|---|---|
| all commits | snip50m 8 | any YES | 240 | 14 | 8 | 17 (10) |
| all commits | snip50m 5 | yesLp ≥ yesLp1 | 240 | 9 | 3 | 6 (4) |
| unsure or yesLp1 < −0.1 | snip50m 8 | any YES | 142 | 11 | 7 | 9 (2) |
| **yesLp1 < −0.1** | **snip50m 8** | **yesLp ≥ yesLp1** | **82** | **9** | **3** | **3 (2)** |
| yesLp1 < −0.1 | snip50m 5 | any YES | 82 | 9 | 4 | 5 (2) |
| all commits | snip50 (with globals) 5 | any YES | 240 | 10 | 14 | 25 (16) |
| all commits | rrf3 5 | any YES | 240 | 9 | 8 | 16 (10) |

Explore-side extra probes (snip50m top 2–5 after an unsuccessful explore): 2 AB found among 39 unresolved explores. Not worth the time.

**m1 / m2** (queued 04:15 UTC, chosen from S300-1 only): x1, plus, when the first W0 YES has token logprob < −0.1, YES/NO probes down snip50m top 6. The first YES with logprob ≥ the first YES's enters the context: m1 in slot 5 (W0 top 4 + E), m2 first (E + W0 top 4), with gates' sandwich prompt and abstain retry. Otherwise x1 is unchanged (sure → gates' answer, unsure → g5). The trigger fires on ≈ 27% of questions; expected cost ≈ +0.5 s.

**S300-2 diagnostic (held out from the m1/m2 choice).** The probe statistics replicate: median recovery-YES logprob is −0.07 on AB vs −0.19 on non-AB; extract abstention again does not discriminate (12/238). **The commit recovery finds almost nothing here.** Every snip50m rule gains 0–1 misses. The m1 rule (yesLp1 < −0.1, top 5–8, yesLp ≥ yesLp1) fires on 79 questions and gains 0. It changes 4–5 x1-right miss prompts, 8 x1-wrong miss prompts and 3 hit prompts. This matches the anatomy: S300-2's false stops have their gold deep (beyond mailbox rank 100 in 8/27), not in the CE top 5. So m1/m2 should come out ≈ x1 on S300-2 and roughly +0.4 weighted on S300-1 (9 AB recoveries × ~0.7).

**Explore-side extra probes replicate as hit-safe.** After an unsuccessful explore (nofound / nopick), probing the top 3 unopened snip50m emails finds an AB email on misses x1 got wrong 6 times (S300-2) and 2 times (S300-1), with 0 hit prompts changed on either set. → **m3** = m1 + 3 extra explore probes (queued 04:35 UTC on both sets).

## 4. GPU runs

### m1 / m2 on S300-2 (J1)

| | weighted | Δ vs x1 [CI] | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| m1 (slot 5) | 86.2 | +0.1 [0.0, 0.2] | +1.2 [−1.9, 4.3] | 48.0 | 89.0 | 2,233 | 6.9 |
| m2 (first) | 86.1 | −0.1 [−0.4, 0.0] | +1.0 [−2.0, 4.2] | 46.0 | 89.0 | 2,237 | 6.9 |
| x1 | 86.1 | – | +1.1 [−1.9, 4.3] | 47.0 | 89.0 | 1,820 | 5.6 |

`tools/m-flips.js`: every path that does not recover is byte-identical to x1 (285/285, including the g5 handover), so the comparison is exact. Recovery fired and accepted an email on 15 questions (3 hits, 12 misses). The email was AB on 2 misses: m1 +1/−0, m2 +0/−1. The S300-2 diagnostic predicted ≈ 0 gain.

### m1 / m2 on S300-1 (J1)

| | weighted | Δ vs x1 [CI] | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| m1 (slot 5) | 87.7 | +0.0 [−1.2, 0.8] | +3.8 [0.9, 6.9] | 56.0 | 90.0 | 2,193 | 6.7 |
| m2 (first) | 88.0 | **+0.3 [0.1, 0.7]** | +4.2 [1.2, 7.3] | 54.0 | 90.5 | 2,194 | 6.7 |
| x1 | 87.7 | – | +3.8 [0.9, 6.9] | 49.0 | 90.5 | 1,999 | 5.4 |

Recovery accepted an email on 21 questions (3 hits, 18 misses). It was AB on 11 of the 18 misses and on all 3 hits (twins). Flips vs x1: m1 misses +7/−0 (sure branch +3, unsure +4), hits 0/−1 (a sure-branch hit lost after a twin entered slot 5). m2 misses +5/−0, hits 0/0. All other paths are byte-identical to x1 (283/285 texts, verdicts 100%).
