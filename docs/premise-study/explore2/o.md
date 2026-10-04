# o: one-shot reading (phase 2)

Goal: raise e2b's reading accuracy on gates' retrieved emails (hits are 93% of the weight). Retrieval, gate and abstention retry are gates' (copied into `explore2/variants/o-reading.js` `gatedReading`, with a pluggable presenter); only the presentation changes. Offline check (`tools/o-check.js`): `oref` (gates through gatedReading) gives gates' exact first context on all 300 S300-2 questions.

## Failure analysis (FULL-0, stored answers, hit stratum n = 450; tools `o-failures.js`, `o-features.js`, `o-reasons.js`)

- gates 407/450 right (90.4), oracles 415 (92.2). Paired: both right 394, gates only 13, oracles only 21, both wrong 22. The gates-vs-oracle gap (net 8 questions) is close to e2b's run-to-run noise (2–6 verdict flips per 100): **distraction by the other four emails is a small effect**. On pos-0, no-same-subject contexts (n = 332) the swaps are 12 vs 10.
- Gates never abstains on a hit (0/450 final abstentions), so the abstain policy is not a hit lever.
- Gold email at position 0 in 387/450 (91.5% right); positions 1–3 (n = 50) 82%; gold absent from the first context 12.
- Contexts with another email of the same (normalised) subject: 85.7% (n = 84) vs 91.5%. Near-duplicate (≥ 0.8 5-gram containment) pairs in 136/450 contexts: 89.7% vs 90.8% — small.
- Context size (p50 9.1k chars, p90 16.8k) and gold length show no accuracy trend; quoted/forwarded gold emails 89.2% vs 91.5%.
- **Answer length / padding**: 1-sentence answers 93.5% (n = 170), 2 sentences 89.1% (n = 266), 3: 76.9% (n = 13). Answers whose 2nd+ sentence attributes a source ("This was mentioned in the email from …", "email dated …") or adds details: **85.5% (n = 62) vs 91.2%**; same pattern in oracles (89.6 vs 92.5). J1 reasons for the 43 wrong gates hits: ~6–7 are "adds unsupported / extra contradictory detail" (synfuel, March of Dimes source, Tom Patrick, DumbBells extra name, cc list, OEC/Brian, Aquila phone), ~8 missing a part, the rest wrong fact / wrong email / judge strictness (BBBOnLinec, Port Aranasas spelling).
- Earlier evidence: R1 cleaning and R2 thread rendering were null in the main study; best-last ordering flips sign between sets; extra selection rules (gatesf, gatesm) cost 1–2 points.

Conclusion: the most specific, evidence-backed lever is the answer format (stop padding), then the prompt shape (sandwich showed shape matters). Cleaning / dedup / order are expected to be small.

## Variants (S300-2)

| id | idea |
|---|---|
| o1 | sandwich with the length rule replaced by a concision rule: one sentence (two only for several things), no extra details, no source attribution |
| o2 | chat format: role + T2 rules as a system message; question, emails, question as the user message |

| o3 | near-duplicate removal (≥ 0.8 5-gram containment either way; keep the more complete copy; refill from the same ranking). Offline: changes 109/300 S300-2 first contexts (87 emails swapped in 72 of 200 hits), gold path never lost |
| o4 | rules moved after the emails (question, emails, rules, question) |
| o5 | one synthetic worked example (2-email thread, distractor + answer email, sandwich prompt, a complete one-sentence answer without source) as a prior chat turn |
| o6 | gates + deterministic cut of source-attribution sentences after the first ("This was mentioned in the email from …"). Offline on FULL-0 gates: changes 33 hit answers (87.9% right) — narrow on purpose, a broad "also/additionally" cut would hit correct second parts (oracles' affected answers 96% right) |

Offline checks that killed ideas before a run:
- Header reorder within the shown five (put the best header match first): on FULL-0 moves gold off position 0 in 84 (stable sort) / 40 (RRF) hit contexts and onto it in only 5 / 2. Dropped.
- Adaptive top-1-only context when the top email's header match is clear: on every covered subset the oracle (gold alone) is no better than gates with five emails (e.g. margin ≥ 1.5: 107 hits, gates 99 right, oracle 101). Distraction is not where the errors are. Dropped.

## Results (S300-2, J1, 100 miss / 200 hit; gates 85.1 = miss 31 / hit 89.0, 763 ms)

| id | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| **o12** o4 prompt + dedup on the mailbox context only | **85.9** | **+0.9 [−1.8, 3.9]** | 37 | 89.5 | 725 | 1.07 |
| o4 rules after the emails | 85.7 | +0.7 [−2.0, 3.5] | 34 | 89.5 | 729 | 1.07 |
| o6 gates + source-sentence cut | 85.1 | +0.0 [0.0, 0.0] | 31 | 89.0 | 750 | 1.04 |
| o5 one worked example (chat turn) | 84.7 | −0.4 [−4.1, 3.5] | 32 | 88.5 | 759 | 1.04 |
| o3 near-duplicate removal | 84.5 | −0.5 [−2.0, 0.8] | 37 | 88.0 | 764 | 1.04 |
| o11 gates + dedup on the mailbox context only | 85.2 | +0.1 [0.0, 0.5] | 33 | 89.0 | 753 | 1.04 |
| o9 "emails sorted by relevance, most relevant first" | 84.7 | −0.4 [−3.0, 2.0] | 32 | 88.5 | 763 | 1.04 |
| o7 question restated after every email | 84.2 | −0.9 [−3.7, 2.0] | 32 | 88.0 | 780 | 1.04 |
| o2 chat format | 83.3 | −1.7 [−5.0, 2.1] | 33 | 87.0 | 1042* | 1.04 |
| o1 concision rule | 80.4 | **−4.7 [−8.4, −1.0]** | 31 | 84.0 | 925* | 1.05 |

*wall times of o-runs are inflated vs gates' (shorter answers in o1 still took longer): other workers' CPU jobs share the machine.

Replication on S300-1 (allowed screening set; gates@1+cold 83.9 there):

| id | weighted | Δ vs gates [95% CI] | miss | hit | wall ms |
|---|---|---|---|---|---|
| o4 | 85.1 | +1.3 [−2.1, 4.6] | 32 | 89.0 | 717 |
| o12 | 84.7 | +0.8 [−2.7, 4.3] | 32 | 88.5 | 715 |

(For calibration: gatesi was +1.2 on S300-1 and −1.2 on FULL-0.)

## Conclusion

No presentation change reaches the promotion bar (Δ ≥ +1.5 vs gates). Best: **o4** (rules moved after the emails: question, emails, rules, question): +0.7 on S300-2, +1.3 on S300-1, ≈ +1.0 pooled, no extra cost (≈ 720 ms, 1.07 calls); **o12** (o4 + near-duplicate removal in the mailbox context) +0.9 / +0.8. Both are within noise; if the lead wants a cheap add-on to test on FULL-0, o4 is the cleanest candidate, but it is not a promotion candidate.

What the evidence says about reading: the gold-alone ceiling (oracles, 92.2 on FULL-0 hits) is only ~8 questions in 450 above gates, and that gap is about the size of run-to-run swaps; gold-alone does not beat five emails even where top-1 is clearly right. The remaining hit errors are mostly e2b's own reading (wrong fact, missing part, wrong person) plus J1 strictness, not distraction or presentation. Making answers shorter backfires (o1, −4.7), formats and hints (chat, worked example, relevance hint, question after each email) are flat or slightly negative. e2b is deterministic between cold runs here (o6 and o12 reproduced gates' / o4's texts byte for byte), so per-set differences are real prompt effects, but they do not generalise reliably across sets at this size.

Paired flips vs gates (questions right only in variant / only in gates), hit | miss: o1 +4/−14 | +3/−3; o2 +3/−7 | +3/−1; o3 +0/−2 | **+6/−0**; o4 +7/−6 | +4/−1; o5 +8/−9 | +3/−2; o6 0/0 | 0/0.

**Determinism note:** o6's raw generations (same prompt as gates) are byte-identical to gates' S300-2 answers on all 300 questions, so e2b was deterministic between these two cold runs. The cut changed 15 answers (11 hits) and flipped no verdict: J1 tolerates source sentences unless they are wrong. o6 is dead.

o12 vs o4 (same prompt, dedup only on the mailbox context): identical text on 199/200 hits, misses +3/−0 — again deterministic, so the mailbox dedup's miss gain replicates on top of a different prompt (o3: +6/−0). o12 vs gates: hits +7/−6, misses +7/−1.

o3: dedup in the mailbox context frees slots for new mailbox emails and helps misses (+6/−0); on hits it only costs (−2). → o11/o12 apply it to the mailbox context only.

o1: answers got much shorter (p50 102 vs 176 chars) and lost: of 14 questions o1 got wrong and gates right, most are an omitted part / reason / recipient ("lacks time detail", "Recipient omitted", "concern omitted") or a wrong entity. The second sentence carries needed content more often than it pads; padding is a symptom, not a cause. Killed. o2: no gain, killed.

Defined in `o-reading.js` but not run (dropped once their components showed nothing): o8 (o4 + source cut; the cut is inert, o6), o10 and o13 (o4 / o12 + the relevance sentence; o9 was −0.4). `oref` is a diagnostic that reproduces gates' contexts exactly (checked offline on all 300 S300-2 questions). Tools: `tools/o-failures.js` (answers × J1 verdicts dump), `o-features.js` (per-question context features), `o-reasons.js` (J1 reasons for wrong answers), `o-check.js` (stub-generator context/prompt check, no GPU). J1 spend for o-runs ≈ $0.02.
