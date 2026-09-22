# V1 pilot: reanalysis with the V2 tooling

The V1 pilot (`benchmarks/premiseBenchmark.js`, branch `poc-premise`) ran e2b (Q4_K_M) and 31b-it-qat on 100 EnronQA test questions.

This file recomputes V1's results from V1's own answers and verdicts (judge: gpt-oss:20b-cloud, V1 rubric), and adds V2's evidence checks. It makes no new model or judge calls. The V2 run re-grades V1's questions with the V2 pipeline (bridge cells), so judge corrections are reported there, not here.

Every number below is a pilot estimate on n=100, clustered by mailbox. It motivated V2's design, and it is not a result of the study.

## Accuracy per V1 cell (V1 judge)

| cell | n | accuracy | 95% Wilson |
|---|---|---|---|
| dist4hard-large | 100 | 92.0 | [85.0, 95.9] |
| dist4hard-small | 100 | 83.0 | [74.5, 89.1] |
| dist4rand-large | 100 | 95.0 | [88.8, 97.9] |
| dist4rand-small | 100 | 81.0 | [72.2, 87.5] |
| dist9hard-large | 100 | 93.0 | [86.3, 96.6] |
| dist9hard-small | 100 | 81.0 | [72.2, 87.5] |
| floor-large | 100 | 1.0 | [0.2, 5.5] |
| floor-small | 100 | 1.0 | [0.2, 5.5] |
| oracle-large | 100 | 94.0 | [87.5, 97.2] |
| oracle-small | 100 | 88.0 | [80.2, 93.0] |
| oraclepre-small | 100 | 84.0 | [75.6, 89.9] |

## Findings

1. **Oracle gap (31b − e2b).** Gap: 6.0 pts [-1.0, 13.6] (n=100; 10 vs 4 discordant; exact McNemar p=0.18). Threaded files: 8.3 pts (n=48); single-message files: 3.8 pts (n=52).
2. **Hard negatives often carried the answer.** Under V2's checks (twin, or an answer-bearing distractor), 37/100 dist4-hard sets and 40/100 dist9-hard sets contained the answer outside the gold (random sets: 4/100). The distraction loss (oracle − distractors) on all sets vs clean sets only:
   - dist4hard, e2b: all 5.0 pts (n=100), clean 7.9 pts (n=63)
   - dist4hard, 31b: all 2.0 pts (n=100), clean 1.6 pts (n=63)
   - dist9hard, e2b: all 7.0 pts (n=100), clean 13.3 pts (n=60)
   - dist9hard, 31b: all 1.0 pts (n=100), clean 1.7 pts (n=60)
   - dist4rand, e2b: all 7.0 pts (n=100), clean 7.3 pts (n=96)
   - dist4rand, 31b: all -1.0 pts (n=100), clean -2.1 pts (n=96)
3. **Retrieval was easy for V1's questions.** The gold email is BM25 rank 1 for 65/100 questions and in the top 5 for 85/100. V1's pool was the 26 mailboxes up to size rank 32 of 150, i.e. the smallest inboxes.
4. **The preprocessing loss is answer deletion.** Preprocessed − original (e2b): -4.0 pts [-10.6, 3.6] (n=100; 5 vs 9 discordant; exact McNemar p=0.424). V1's preprocessing removes answer content (for example URLs turned into `[link]`, or dropped `Sent:` lines) for 7 questions. On those, the difference is -71.4 pts (n=7); on the rest, 1.1 pts (n=93). V2's representations are lossless by construction and audited (R0/R1/R2: 0 losses over all 89,316 questions).
5. **The floor.** Correct answers without any email: e2b 1, 31b 1. V2 flags unanswerable golds and runs the floor at n=100 per model.
6. **Timing.** Warm e2b median 211 ms and decode 163.043 tok/s; warm 31b median 6378 ms and decode 3.614 tok/s. The warm ratio of totals (31b/e2b) is 30.525 over 99 pairs. V1's headline ratio included cold loads. On the 8 GB GPU the 31b runs mostly on CPU, so the ratio is hardware-specific.

## What V2 changes because of this

- Tuning and evaluation are separated by mailbox, and every inbox size is sampled.
- Distractors are answer-free by construction.
- Representations are lossless and audited.
- Grading uses two judges plus an evidence-grounded adjudicator.
- Timing excludes cold loads.
- Energy is measured per block.

See `benchmarks/premise2/PREREG.md`.
