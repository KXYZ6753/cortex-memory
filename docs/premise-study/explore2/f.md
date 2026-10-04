# f: failure anatomy of `gates` (FULL-0, n = 600)

Offline only (no GPU, no grading). Data: latest `gates@1+cold` answers on FULL-0 joined to J1 verdicts as explore/analyze.js does; both gates contexts rebuilt from the frozen pool lists (`lists.global`, `lists.user` + `byHeaderRank`). 0/600 mismatches against the stored `contextPaths`. "Answer-bearing" (AB) means gold path, a twin, or `EvidenceCache.answerBearing` (same rule as analyze.js). Weight per question: miss 0.045 pts (n = 150), hit 0.207 pts (n = 450).
Tools: `benchmarks/premise2/explore2/tools/f-anatomy.js` (per-question rows, BM25 top 50 for never-found cases) and `f-summary.js` (tables).

## Headline

- gates gets 86.8 weighted. The 13.2 lost points split into: **reading errors 9.7**, never found 2.4 (+0.2 abstained with no gold in view), wrong context 0.8. On hits, reading errors are almost the whole loss.
- About half of the reading-error points can't be fixed by the pipeline. 18 of 63 reading errors (**3.4 pts**) are correct-looking answers that the judge marked wrong, and 8 (**1.2 pts**) have an ambiguous question or a doubtful gold. The oracle (gold email alone) also fails on 33 of the 63. Realistic hit-side headroom is about 90.4 → 92, which matches oracles' 92.2.
- **The abstain-then-retry step almost never runs.** Of the 78 questions where the final context had no answer-bearing email, the model abstained on only 6. The retry fired 8 times out of 600 and got 0 of them right. The model nearly always answers confidently from the wrong email.
- **The gate itself is close to optimal.** Its best case is +0.4 pts, and no cheap signal I tried finds the misrouted questions (§3).
- **Answers that blend in a second email are the strongest failure signal I found:** 51 answers contain "Additionally / also mentions / mentioned in the email from / email [n]", and only 56.9% of them are correct (hits 80.0% vs 91.4% for the rest; misses 23.8% vs 74.6%).
- No single lever from this analysis is likely to reach +1.5 on its own (§6). Promotion probably needs two levers stacked.

## 1. Buckets

| bucket | n | miss | hit | weighted pts |
|---|---|---|---|---|
| correct | 463 | 56 | 407 | 86.8 |
| reading error (AB email in the final context, wrong answer) | 63 | 21 | 42 | 9.7 |
| wrong context (AB only in the context not used, no retry) | 15 | 14 | 1 | 0.8 |
| abstained, gold in view | 0 | 0 | 0 | 0.0 |
| abstained, gold not in view | 5 | 5 | 0 | 0.2 |
| never found (AB in neither context) | 54 | 54 | 0 | 2.4 |

**Reading errors by position of the first AB email in the final context** (the last column covers every question with AB at that position)

| pos | reading errors (miss/hit) | weighted pts | all questions with AB at pos: n, acc |
|---|---|---|---|
| 1 | 45 (9/36) | 7.9 | 463, 90.3% (hit 91.5, miss 75.7) |
| 2 | 6 (3/3) | 0.8 | 25, 76.0% |
| 3 | 6 (4/2) | 0.6 | 16, 62.5% |
| 4 | 6 (5/1) | 0.4 | 14, 57.1% |
| 5 | 0 | 0 | 4, 100% |

On hits, 22 questions have the AB email at positions 2–4, and they score about 73% against 91.5% at position 1.

**By context source**

| final context | reading errors (miss/hit) | weighted pts | all questions in cell: n, acc |
|---|---|---|---|
| global, not switched, no retry | 40 (0/40) | 8.3 | 476, 80.7% |
| mailbox, switched, no retry | 23 (21/2) | 1.4 | 116, 68.1% |
| mailbox, not switched, retry fired | 0 | 0 | 3, 0% |
| global, switched, retry fired | 0 | 0 | 5, 0% |

Counts per cell (correct / reading / wrong ctx / abstained, not in view / never found): not switched: 384/40/14/0/38; switched: 79/23/1/0/13; retry cells: 0/0/0/5/3.

**Never found + abstained with no gold in view (n = 59, all miss)**
- The gold email is in the asker's mailbox in 59/59. Oracles answers 48/59 correctly from the gold alone, so the ceiling is about 2.2 pts.
- Gold rank in the mailbox's BM25 top 50: 6–10: 21; 11–20: 16; 21–50: 10; not in the top 50: 12. Header-reranking the top 50 puts 23 in the top 10.
- Gold rank in the global BM25 top 50: 6–10: 12; 11–20: 16; 21–50: 11; not in the top 50: 20.

## 2. Reading errors: cause, from reading all 63 (miss/hit, weighted pts)

| cause | n | miss/hit | pts |
|---|---|---|---|
| A. Wrong email among similar ones (twin newsletters, advisory #13 vs #14, a second offer or URL), or another email's details merged in | 16 | 10/6 | 1.70 |
| B. Partial answer: one part of the question left out, or vague | 7 | 1/6 | 1.29 |
| C. Right email, misread: inverted relation, buried detail, counting, or info that is only in the header/subject | 10 | 4/6 | 1.42 |
| D. Judge strictness on a correct-looking answer (gold typo, paraphrase, a harmless extra detail or source note) | 18 | 2/16 | 3.40 |
| E. Thread or header confusion (who sent or cc'd whom, forwarded-by) | 4 | 1/3 | 0.67 |
| F. Question ambiguous, or gold is an inference not stated in the email | 8 | 3/5 | 1.17 |

At least 6 of the 18 D cases were marked wrong only because of an appended second sentence ("This was mentioned in the email from X", an extra name, a second date). That overlaps with A and points to lever 1.

Examples:
1. **A (miss, switched, pos 4).** Q: date of the FERC public meeting? Gold: October 11. Answer: "Thursday, November 1, 2001…". It read a different FERC notice; oracles gets it right.
2. **A (hit, pos 1).** Q: who did Gregg Penman's request…? The answer is correct, then adds "Tom Patrick also requested…", taken from another email. Judge: "extra contradictory detail".
3. **D (hit).** Q: trade dates of the UFE misallocation? Gold: April 27–June 27, 2000. The answer gives exactly those dates, then quotes the "June 28" correction sentence, and the judge rejects it. Similar: "BBBOnLine" vs gold's typo "BBBOnLinec"; "will continue until" vs gold "will cease once".
4. **C (hit).** Q: topic of the conference call in Jeremy Dawson's email? Answer: "The email does not specify the topic." The topic is in the Subject line ("Conference call with Shell to Discuss Venture options…").
5. **E (hit).** Q: domain of the person who forwarded the Indian Bread demo email? Gold: unm.edu. Answer: "forwarded by Debra Perlingiere… enron.com". It took the outer forwarder instead of the quoted original sender.

## 3. Gate quality

Rows: did the gate switch. Columns: is an AB email in the global top 5.

| | AB in global top 5 | AB not in global top 5 |
|---|---|---|
| not switched (global first) | n=420, acc 90.5%; AB also in mailbox 5: 417; pbs 90.5, oracles 92.1 | n=59, acc 6.8%; AB in mailbox 5: 15; oracles 81.4 |
| switched (mailbox first) | n=30, acc 90.0%; pbs 73.3, oracles 93.3 | n=91, acc 57.1%; AB in mailbox 5: 73; pbs 1.1, oracles 82.4 |

- **Switching is the right call.** The 91 switched questions with no AB in the global top 5 go from about 1% (pbs) to 57%, and switching costs nothing on the 30 where the global top 5 also had the answer.
- **Not switching misses only 15 questions** (AB in the mailbox top 5 but not in the global top 5). The T2 mailbox context (hdru) gets 60% of them, so the ceiling is about +0.4 pts.
- **Switching more often hurts.** When both contexts contain the answer and the gate did not switch (n = 417), the global context reads better: pb 87.3% vs hdru 84.4% (both T2).
- **No cheap signal catches the 15.** I tested 7 alternatives (mailbox top 1 not in global top 5, mailbox top 1 ≠ global top 1, ≤1 or ≤2 own-mailbox emails in global top 5, global top 2 from another mailbox, overlap ≤1 or ≤2). The best catches 7 of the 15 but also fires on 215 questions that are fine as they are. Drop gate tuning.

## 4. Where gates loses to simpler variants (paired on FULL-0)

| other | other right, gates wrong | gates right, other wrong | gates − other (weighted) |
|---|---|---|---|
| pb | 16 (all hit; 14 not switched, so same context and only the prompt differs) | 88 | +6.5 |
| pbs | 1 (switched) | 57 | +3.3 |
| gatea | 20 | 38 | +3.4 |
| gates6 | 2 | 4 | +0.1 |
| gatesi | 12 | 21 | +1.2 |
| gatesf | 10 | 22 | +2.2 |
| gatesm | 6 | 15 | +1.4 |
| hdru | 23 (8 are gates' wrong-context cases) | 46 | +5.9 |

pbs, which uses the same prompt and the same global context, beats gates on only 1 question. The 16 pb wins are on identical contexts with only the prompt changed (T2 vs sandwich), and they sit within the known nondeterminism (2–6 flips per 100) and prompt variance. gates loses nothing systematic to the simpler variants.

## 5. What predicts failure (questions with AB in the final context, n = 522)

- **Answer blends another email** ("Additionally", "also mentions", "mentioned in the email from", "email [n]"): 51 answers, 56.9% correct. Hits: 80.0% (n = 30) vs 91.4%. Misses: 23.8% (n = 21) vs 74.6%. This is the strongest predictor.
- **Answer length:** 120–180 chars 93.0%; 180–250 85.7%; over 250 80.7%; under 120 88.2%. Answers with two or more sentences score 76.6% against 79.8% for one sentence (all 600).
- **Emails from other mailboxes in context:** 0 → 81.4%, 1 → 86.4%, 2 → 98.2%, 3 or more → 92.1%. Even within not-switched global contexts, 0 other-mailbox emails gives 85.3% vs 92.1%. All-own-mailbox contexts are full of similar same-person emails, which feeds cause A.
- **Duplicate bodies in context:** 0 → 88.5% (n = 512); 1 or more → 60% (n = 10). Rare.
- **Position of the AB email:** see §1. Position 1 gives 90%, positions 2–4 give 57–76%.
- **Context length (chars) and gold-email length don't predict failure** (quartiles 84–93%, not monotonic). Number of AB emails and number of twins: flat.

## 6. Levers, ranked by estimated weighted upside on FULL-0

1. **Single-source answers.** Strip or prevent the blended second sentence ("Additionally…", "This was mentioned in…", "also…"). This targets cause A and the extra-detail half of D: about 30 hits at 80% and 21 misses at 24% against about 91% and 75% for the rest. The cheapest twist is deterministic post-processing that drops trailing attribution or "Additionally" sentences unless the question has several parts: zero GPU, but it needs grading. Prompt rules failed in phase 1 (gatesm, gatesf), so don't add another rule. **Est. +0.6 to +1.0.**
2. **Make the retry actually run** with a calibrated "is the answer here?" trigger. Today the model abstains on 6 of 78 questions with no AB in the final context, and the retry fired 8 times with 0 correct. The targets are the 15 wrong-context questions (other context about 60%, +0.4) and the 21 never-found questions whose gold is at mailbox ranks 6–10 (+0.5 with a third context). Every falsely triggered hit costs 0.21, so the trigger needs to fire wrongly on less than about 2% of hits. **Est. +0.3 to +0.9.**
3. **Mailbox recall for never-found misses.** Gold is outside both top 5s in 59 cases; 37 are in the mailbox top 20 and 12 are not in the mailbox top 50. Oracles' ceiling here is 2.2 pts, but it is miss-only and needs a precise trigger or better mailbox ranking (dense or cross-encoder over the mailbox top 20–50). **Est. +0.3 to +0.6.**
4. **Order the context so the answering email comes first.** On hits, 22 questions with AB at positions 2–4 score about 73% against 91.5% at position 1, so the ceiling is +0.8. A CPU cross-encoder over the 5 chosen emails, used only to reorder them, is untested, but estar and hdr were negative. **Est. +0.2 to +0.4.**
5. **Collapse duplicate or near-duplicate bodies** in the context and fill the freed slot from the next candidate: 10 questions at 60%. **Est. +0.1 to +0.3.**

Not worth pursuing: gate tuning (ceiling +0.4, no signal), 6 emails (gates6 +0.1), more prompt rules. Judge strictness costs 3.4 pts and ambiguous questions 1.2; that is a measurement floor, not a pipeline lever. If the lead wants it, a J1 audit of the 18 D cases would quantify it.
