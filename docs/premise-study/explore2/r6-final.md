# Round 6 summary (Wed 7 Oct ~20:00 ET to Thu 8 Oct 18:00 ET)

Kerem's request: "keep exploring and finding new improvements ... especially high yield ones". TEST is closed; nothing here touched TEST, and nothing goes to TEST without Kerem. The journal (`docs/premise-study/explore-journal.md`, "Round 6") holds every rule, which was always fixed before its data, and every number. This note collects the results.

All contrasts are det vs det (`variants/i-det.js`, mode "all"), J1-graded, design-weighted (0.068 · miss + 0.932 · hit), with a question-stratified paired bootstrap (B = 10,000, `tools/rng.js`). "Hit points" are accuracy points on the hit stratum.

## Headline

1. **No round-6 change is a confirmed improvement.** The best candidate, lead-yas (gates plus a sure-YES email read alone), was +0.79 [0.05, 1.52] over 3,300 development questions, but only **+0.19 [−0.50, 0.89]** on 2,408 fresh questions (H6-D + H6-C). By the rule fixed before the run, that is *consistent*, not *confirmed*.
2. **Fresh-hit headroom is about 2 points, and about 1 of it is reachable.** On H6-D (600 fresh hits), reading only the gold email scores 91.0, against gates 89.0, lead-yas 89.67 and q1 88.17. Everything else is e2b reading the right email wrongly.
3. **Scale control (s6, e4b on FULL-0 + FULL-1, 1,200 development questions).** With the sandwich prompt, e4b reads the gold email on hits no better than e2b: **+0.1 [−1.8, 2.0] hit points**. With the plain T2 prompt e4b reads 3.8 points better, so the sandwich prompt substitutes for scale in reading. gates adds **+5.7** to e2b but only **+3.1** to e4b (difference −2.6 [−5.3, 0.1]), and **e2b + gates vs e4b P-B is +2.0 [−0.1, 4.1]** (mailbox-cluster [0.2, 4.0]): equal on hits, +30 on misses, at 0.75× the wall time and about 0.6× the GPU energy per correct answer (93.9 vs 157.0 J). This is direct evidence for the paper's question, with the caveat that gates was selected on FULL-0 (FULL-1 alone points the same way). The shared reading ceiling holds up to e4b only: 31b's plain P-B reads FULL-0's hits at 93.6, above both models' gold-only reads (unpaired, one set).
4. **Precision is not the floor** (q8). Q8_0 e2b minus the study's QAT Q4_0 on gold-only reading is −0.7 hit points [−1.9, +0.5] over 1,300 hits.
5. **Every hit-side method tried in round 6 is null on fresh hits:** an aux encoder selector (v6), contrastive decoding (n6), prompt shape (p6) and error-class surgery (a6). See the table below.
6. **The best stacked system on development is lite-yas** (lite + sure-YES read): +0.63 over lite and +1.91 [0.83, 3.00] over det gates on 2,700 development questions, at lite's cost (1,688 vs 1,738 ms). It reaches q1's accuracy for less energy. On fresh hits its gain over lite shrinks to +0.19, the same flips as lead-yas (§3).

## 1. Lines and outcomes

| line | what | development | fresh (H6) | status |
|---|---|---|---|---|
| lead-yas | gates + sure first-YES email read alone | +0.79 [0.05, 1.52] (3,300 q) | +0.19 [−0.50, 0.89] (2,408 q) | consistent, not confirmed; closed |
| lite-yas | lite-det-ub + the same read (live: `variants/lead-liteyas.js`) | +0.63 [−0.17, 1.45] vs lite (2,700 q) | +0.19 [−0.50, 0.89] vs lite (2,408 q) | consistent, not confirmed; see §3 |
| q1-yas | q-det-q1 + the same read (offline) | +0.23 vs q1 | H6-D +0.62 | not pursued (g5 already fixes most) |
| q8 | Q8_0 vs QAT Q4_0, gold-only | −0.7 [−1.9, 0.5] hit pts (1,300 hits) | – | null |
| v6 (aux) | RoBERTa QA / DeBERTa NLI selector among e2b's answers | – | R1 +0.08 [−0.62, 0.77] (1,300 fresh det hits) | negative |
| n6 | contrastive decoding (document, classic CAD, neutral question) vs a re-roll placebo | document +0.38 [−0.62, 1.38]; best tuned CAD +0.62 [−0.38, 1.62]; placebo pooled +0.64 (2,350 hits) | – | null: no better than re-decoding unsure answers |
| a6 | error-class surgery on hits; best: gates + two-email reread on two-part questions + truncation re-ask (`a6-g-pkg`) | +0.43 [+0.04, +0.81] hit pts (2,350 hits) | +0.08 [−0.29, 0.46] hit pts (2,400 hits); reread +9/−10, truncation re-ask +3/−0 | consistent, not confirmed; only the truncation fix is real (about +0.1–0.2) |
| p6 | prompt shape (o4, question next to emails) against two placebos | gold-only o4 −0.20, qadj −0.27 (1,500 hits); vs rule-swap placebo +0.13 / +0.07; end to end o4 −0.17 (2,100 q) | – | null |
| s6 | e4b scale control (diagnostic) | gold-only e4b − e2b +0.1 hit pts (sandwich), +3.8 (T2); gates gain e2b +5.7 vs e4b +3.1; e2b gates − e4b P-B +2.0 | – | diagnostic; see headline 3 |

## 2. Where the remaining accuracy is

- **Hits (93.2% of the weight).** On fresh hits gates reads at 89.0 and gold-only at 91.0 (H6-D). Of the 2-point gap, about 25 questions (YES on the wrong email) are reachable without an oracle, about +1 hit point at best. A "read every YES email" rule could reach part of that, which is below what H6-C can resolve (±0.8), so it was not pursued.
- **Misses (6.8% of the weight).** q1 answers 49.3 / 42.7 of misses on FULL-2 / FULL-3, against gates 27.3 / 18.7. On FULL-3, q1 never finds the gold email in 62 of 150 misses. The round-5 retrieval lab (d) bounded this: perfect retrieval plus gold-only reading is worth at most +2.4 weighted, and a perfect explore list about +0.5. Fresh miss questions are exhausted (8 left), so no miss-side change can be confirmed on new data.

## 3. lite-yas on fresh hits (secondary, rule fixed Thu 00:20 ET)

- **lite-yas − lite-det-ub**, pooled H6-D + H6-C (2,408 questions): **+0.19 [−0.50, 0.89]**, hit flips +46/−41. *Consistent*, not *confirmed*. The flips equal lead-yas − gates's, because lite keeps gates' answer A on every sure-YES commit.
- **lite − i-det-gates on 2,400 fresh hits:** 88.67 vs 89.00, −0.33 hit points (+32/−40; about [−1.0, +0.4]). On H6-C alone −0.17; H6-D's −0.83 was mostly set noise. The loss sits on the explore paths (nofound +8/−12, found +1/−5, recover-unsure +2/−5).
- **lite-yas on fresh hits:** 88.88, −0.12 vs gates.
- **Cost on H6:** lite 1,563 ms and 3.85 real calls; gates 770 ms and 1.00.
- **Reading:** on fresh hits the hybrids are within ±1 hit point of gates. Their advantage is the miss stratum only, as in round 5.

## 4. Worker reports

All six workers reported (q8, v6, a6, p6, n6, s6); details are in the table above, in the journal and in each worker's note (`explore2/<prefix>.md`). No worker reached its development bar. The pattern across them: every hit-side change re-rolls the same 7–9% of fragile hits, and the net gain of any re-roll of unsure answers is about +0.5 hit points on development, which shrinks toward 0 on fresh hits (lead-yas +0.79 → +0.19; a6 +0.43 → +0.08; n6's placebo +1.15 → 0.00).

## 5. Decisions for Kerem

1. **Aux scope (v6).** v6 used an outside encoder; it was negative, so the scope question is moot for accuracy, but the paper may mention it as a tried-and-failed selector.
2. **Scale finding (s6).** Whether the e4b control goes into the paper: the sandwich prompt closes the e2b → e4b gold-only reading gap, gates helps e4b about half as much as e2b, and e2b + gates ≥ e4b P-B at about 0.6× the energy. All on development sets, with gates selected on FULL-0.
3. **q1's wall cap on hit-heavy mixes.** q1 runs at 3,314 ms per question on H6-D (all hits), above the 3,243 ms cap; on the design-weighted development mix it is 2,363 ms.

## Cost

J1 grading in round 6: PENDING; exploration total about $1.22 of the $3.50 exploration budget ($5 overall).
