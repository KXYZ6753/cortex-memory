# Explore 2: retrieval engineer (prefix r)

Mission: get the answer-bearing (AB) email in front of e2b more often and higher up, cheaply.

## Offline setup (no GPU)

- Dev questions for tuning: FULL-0 + S300-1 + S100-0..9 (1,900 pool questions; 750 misses, 1,150 hits). S300-2 / S300-3 / FULL-1 never used offline.
- AB = gold path, its twins, or `EvidenceCache.answerBearing` (as analyze.js). Weighted = 0.068·miss + 0.932·hit.
- Tools: `explore2/tools/r-features.js` (BM25 global top 20 / mailbox top 30 with scores, header scores, body keys, AB flags), `r-ce.js` (MiniLM cross-encoder scores on mailbox top 30 ∪ global top 10, CPU, ~770 ms/question for ~35 pairs), `r-recall.js` (recall table), `r-depth.js`.

## Mailbox depth (dev misses, n = 750): rank of first AB email in the asker's mailbox BM25 list

| 1-5 | 6-10 | 11-20 | 21-30 | 31-50 | 51-100 | >100 |
|---|---|---|---|---|---|---|
| 350 | 170 | 89 | 37 | 32 | 33 | 39 |

Cumulative: top 5 47%, top 10 69%, top 20 81%, top 30 86%, top 50 90%. Going from 30 to 50 candidates buys 4% of misses (≈0.3 weighted pts at most); depth 30 chosen.

## Offline recall (dev, n = 1,900: 750 miss / 1,150 hit; weighted by miss share 6.8%)

AB recall of the context e2b reads first (@1/@3/@5), of the union of both contexts, and the gate (switch = global top 1 from another mailbox; "need" = global top 5 has no AB email). CE = MiniLM cross-encoder over mailbox BM25 top 30 ∪ global top 10.

| pipeline | w@1 | w@3 | w@5 | w union | miss @1/@5/union | hit @1/@5/union | sw prec | sw rec |
|---|---|---|---|---|---|---|---|---|
| pb | 84.5 | 91.7 | 93.2 | 93.2 | 0.0/0.0/0.0 | 90.7/100/100 | – | 0 |
| gates | 89.2 | 94.6 | 96.0 | 96.8 | 21.1/42.1/52.5 | 94.2/99.9/100 | 42.2 | 57.3 |
| gates + CE best-first order | 84.9 | 93.4 | 96.0 | 96.8 | 27.2/42.1/52.5 | 89.1/99.9/100 | 42.2 | 57.3 |
| mailbox ctx = CE top 5 of mailbox 30 | 89.6 | 94.7 | 95.7 | 97.4 | 27.2/40.9/61.3 | 94.2/99.7/100 | 42.2 | 57.3 |
| mailbox ctx = RRF(BM25, hdr, 2×CE) of 30 | 89.5 | 95.1 | 96.2 | 97.4 | 25.9/43.7/62.0 | 94.2/100/100 | 42.2 | 57.3 |
| + dedup (body key) | 89.5 | 95.1 | 96.2 | 97.4 | 25.9/43.9/62.4 | 94.2/100/100 | 42.2 | 57.3 |
| single CE list over the union (no gate) | 81.4 | 90.3 | 93.8 | 96.4 | 23.6/50.0/65.2 | 85.6/97.0/98.7 | 26.5 | 35.7 |
| CE gate (also switch if mailbox CE max > global CE max + 2) | 89.5 | 95.2 | 96.3 | 97.4 | 27.3/47.2/62.0 | 94.1/99.9/100 | 42.7 | 62.1 |
| fused + swap best mailbox-CE email FIRST in global ctx | 87.9 | 95.6 | 96.8 | 97.4 | 35.1/52.9/62.3 | 91.7/100/100 | 42.2 | 57.3 |
| fused + swap LAST (replaces global #5) | 89.5 | 95.1 | 96.8 | 97.4 | 25.9/52.9/62.3 | 94.2/100/100 | 42.2 | 57.3 |
| **r1**: CE mailbox ctx + swap last (margin 0) | 89.6 | 94.7 | 96.3 | 97.4 | 27.2/50.1/61.3 | 94.2/99.7/100 | 42.2 | 57.3 |
| **r3**: r1, swap margin −1, fresh retry ctx | 89.6 | 94.7 | 96.5 | 97.6 | 27.2/53.2/64.5 | 94.2/99.7/100 | 42.2 | 57.3 |
| swap 2 slots always | 89.6 | 94.7 | 96.2 | 97.2 | 27.2/59.6/61.7 | 94.2/98.9/99.7 | 42.2 | 57.3 |

Findings:
- **The cross-encoder must not reorder the global context.** BM25's #1 is answer-bearing more often than the CE's #1 on hits (94.2 vs 89.1 @1). Position matters for e2b (gates FULL-0+S300-1: AB at pos 1 → 90.5%, pos 2 77%, pos 3 75%, pos 4 50%; estar shows pos 5 ≈ pos 1), so the best email goes first or last, never in the middle, and a CE-chosen email should not displace BM25's #1.
- CE helps inside the mailbox: miss @1 21 → 27, union 52.5 → 61-62 (mailbox top 30 caps it at 86%).
- The biggest miss lever is the non-switched misses (43% of misses; gates answers them right only ~6% because e2b rarely abstains there, so the retry never fires). Putting the best unseen mailbox-CE email in the global context's last slot lifts miss @5 42 → 50-53 at no cost on hits (@1 unchanged; @5 99.7-100).
- Gate signal: a CE-margin trigger raises switch recall 57 → 62% at equal precision but changes little in @5; consistent with the failure analyst's gate ceiling (~+0.4).
- Dedup of identical bodies in a context barely changes recall (twins rarely co-occur in a top 5).
- Single CE-ranked list over mailbox ∪ global: worst on hits (85.6 @1). Rejected.
- Truncation idea checked on stored answers: when BM25 and CE agree on the top email with CE margin > 3 (≈ 32% of hits), gates already reads at 92.5% vs oracles 93.8% on the same questions: no room for showing fewer emails.
- Hit stratum has almost no retrieval headroom (@5 ≈ 100%; gates ≈ oracles in most cells), so expected end-to-end gains come from misses only: ≈ +8-11 pts on miss @5 → roughly +0.4-0.8 weighted. Promotion (+1.5) is unlikely from retrieval alone.
- Latency: CE ≈ 750 ms/question for ~35 pairs on CPU (q8), so r1-r3 ≈ 0.75 s (gates) + 0.8 s ≈ 1.6 s, within the 3,243 ms cap.

## Field-weighted BM25 (offline, dev 1,900): AB recall

| weights (subj, sender, recip, body) | global @1 miss/hit | global @5 miss/hit | mailbox @5 / @10 / @30 (misses) |
|---|---|---|---|
| 1,1,1,1 (main index) | 0.0 / 90.7 | 0.0 / 100 | 46.7 / 69.3 / 86.1 |
| 3,2,1,1 (bm25-fields) | 1.6 / 91.1 | 12.8 / 99.6 | 53.1 / 71.7 / 87.5 |
| 5,2,1,1 | 2.0 / 90.8 | 14.4 / 99.6 | 54.0 / 72.0 / 87.5 |
| 2,1,1,1 | 0.3 / 90.9 | 4.8 / 99.7 | 49.1 / 69.6 / 86.5 |
| 2,1,0.3,1 | 0.5 / 90.8 | 7.5 / 99.6 | 50.4 / 68.7 / 85.2 |

Subject up-weighting helps misses, but inside the gates pipeline it costs hits: with bm25-fields everywhere the gate fires less (8.4% vs 9.2%) and hit @1 drops 94.2 → 93.8, which outweighs the miss gain (weighted). Fields for the mailbox list only (global unchanged) adds ~+1 on miss @5 / +2 on miss union over the CE pipelines: too small for a GPU slot. Not run end-to-end; `rerankGate` has a `weights` option if wanted.

## End-to-end S300-2 (round 1)

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| gates | 85.1 | – | 31.0 | 89.0 | 763 |
| r2 (fused CE mailbox ctx + swap last) | 85.1 | +0.1 [−1.3, 1.2] | 39.0 | 88.5 | 1,386 |
| r1 (CE mailbox ctx + swap last) | 84.7 | −0.3 [−2.2, 1.3] | 40.0 | 88.0 | 1,465 |

Paired breakdown (r1 vs gates; `tools/r-diff.js`): identical prompts on 186 non-switched hits (0 flips). Swapped non-switched misses: **7 wins, 0 losses** (r2 the same). Switched misses (new CE mailbox context): 9 wins / 8 losses (r2 7/6): the better offline @1 of the CE mailbox context did not turn into accuracy. Switched hits (7): r1 lost 2, r2 lost 1. So the swap is the real gain and the CE mailbox context is a wash. r3 (queued) was cancelled; replaced by r4/r5 = gates' own contexts + only the swap (offline: miss @5 42.1 → 54.4 (r4, margin −1) / 57.2 (r5, always), hit @5 99.9 / 99.7).

## End-to-end S300-2 (round 2): gates' contexts + only the swap

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| **r5** (swap always when not switched) | **87.0** | **+1.9 [−0.3, 4.2]** | 39.0 | 90.5 | 1,230 | 1.0 |
| r4 (swap if CE > global CE max − 1) | 85.5 | +0.5 [0.2, 0.9] | 38.0 | 89.0 | 1,246 | 1.0 |
| gates | 85.1 | – | 31.0 | 89.0 | 763 | 1.0 |

Paired flips vs gates: r4: misses 7 wins / 0 losses (all swapped non-switched misses), **no other flip in 300** (identical prompts give identical verdicts here). r5: misses 8 / 0 (same mechanism), hits 5 wins / 2 losses, all 7 hit flips with the AB email at position 1 in both runs: answer-wording changes caused by a different 5th email, i.e. prompt-perturbation noise, not retrieval. Honest estimate of r5's real effect: the miss part, +8 pts on misses ≈ **+0.5 weighted**; the extra +1.4 from hits is probably noise. Formally r5 meets the promotion rule (Δ ≥ +1.5, 1,230 ms ≤ 3,243 ms); r4 is the cleaner but smaller change.

Never-found misses drop 55 → 46 (r4, r5).

Also checked offline (not run): the same swap inside the switched mailbox context (slot 5 = best unseen CE email if it beats the context's CE max): miss @5 57.2 → 58.8, hits unchanged: ≈ +0.1 weighted, and S300-2 showed that switched-context edits were a wash. Two swapped slots (always): miss @5 60.8 but hit @5 99.1 (−0.6): rejected.

## Replication on S300-1 (caveat: S300-1 was part of the offline dev set; r4's margin −1 was picked there, r5 has no tuned parameter)

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| r4 | 85.6 | +1.7 [0.7, 3.1] | 46.0 | 88.5 | 1,232 |
| r5 | 84.3 | +0.4 [−2.1, 3.2] | 47.0 | 87.0 | 1,233 |
| gates | 83.9 | – | 34.0 | 87.5 | 756 |

Flips vs gates: r4 misses 13 / 1, hits 2 / 0 (swapped only); r5 misses 14 / 1, hits 5 / 6 (all on swapped hits). Across both sets: the swap reliably converts ~10% of misses (S300-2 +7/+8, S300-1 +12/+13 net per 100 misses), while r5's hit flips go both ways (5/2, then 5/6): noise from changing the 5th email on every non-switched question. r4 touches far fewer hits (25 and 18 swapped of 200) and showed 2 / 0 hit flips over 400 hits.

Pooled over the two sets (600 q): r4 ≈ +1.1, r5 ≈ +1.15 weighted vs gates; real expected effect ≈ +0.7-1.0 (the miss part).

## Conclusion

- Recommended candidate: **r4** (gates + CE swap into slot 5 when the asker's best unseen mailbox email scores within 1 logit of the global best). Same reading as gates, one generation call, wall ≈ 1.24 s (gates 0.76 s + BM25 top 30 + ~35 CE pairs on CPU, skipped when switched).
- Promotion rule: r5 formally meets it on S300-2 (+1.9, 1,230 ms) but not on S300-1 (+0.4); r4 meets it on S300-1 (+1.7) but not on S300-2 (+0.5). Neither clears +1.5 on both; the lead's S300-3/FULL confirmation should decide, with r4 the safer pick.
- What did not work: CE reordering of any context (hurts @1), CE-built mailbox context (offline @1 gain, end-to-end wash), single CE list, field-weighted BM25 throughout (hurts hits via the gate), dedup (no effect), truncation when BM25 and CE agree (no gap to oracle).
