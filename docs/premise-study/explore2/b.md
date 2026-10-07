# b: in-domain few-shot demonstrations (round 5)

Prefix `b`. Code: `explore2/variants/b-common.js` (bank loading, demo choice, the ctx wrapper `withDemos`), `explore2/variants/b-demos.js` (variants), offline tools `explore2/tools/b-*.js`. Bank file: `.data/premise2/explore/b-bank.json` (built by `tools/b-bank.js` from DEMO-1 + DEMO-2; no model).

Hypothesis (lead): e2b reads hits at 88.5–90.5 vs 92.2 gold-only; demonstrations of this dataset's own question / email / answer style should teach what a complete, specific answer looks like and how to read Enron emails.

Prior art in this project: o5 (o.md) = **one synthetic** worked example (two invented emails) as a chat turn before gates' prompt: S300-2 −0.4 (hits +8/−9). In-domain, several, or similarity-chosen demos were never tried.

## 1. Offline: gold answers vs wrong hit answers (`tools/b-gold.js`; S300-1/2/3 + FULL-1, 1,050 graded hits)

| | x1 | gates |
|---|---|---|
| hit accuracy | 89.4 (939/1050) | 88.5 (929/1050) |
| by type: other (697) | 90.4 | 89.2 |
| who (98) | **79.6** | **77.6** |
| url-contact (123) | 88.6 | 87.8 |
| when (72) | 94.4 | 94.4 |
| number (60) | 90.0 | 91.7 |
| J1 partsAsked > 1 (≈200) | 84.7 | 84.1 |
| answer chars, median right / wrong | 167 / 175 | 166 / 189 |
| gold chars, median | 110 | 110 |
| sentences, median answer / gold | 2 / 1 | 2 / 1 |
| wrong: no part right / some parts right | 85 / 22 | 90 / 25 |
| gold has a number not in the question: answer lacks it (right / wrong answers) | 6% / 67% | 6% / 61% |

Readings:
- e2b's answers are **longer** than the gold (median 2 sentences, 167 chars vs 1 sentence, 110 chars), and wrong answers are not shorter than right ones. "Incomplete" is not a length problem: of x1's 111 wrong hit answers only 22 have some but not all parts right; 85 have no part right (wrong fact, wrong person, wrong email, hedge).
- The weakest type is **who** (78–80% vs ~90% elsewhere): relation inversions (forwarder vs original sender, asker vs asked), first names vs full names, "you" for the recipient.
- url-contact errors: full number vs extension ("713-853-9890" for "x3-9890"; "850-283-6347" for DSN "523-6347").
- What demos could teach: (a) the gold's form (one declarative sentence restating the question with the specific entity / number / date filled in, every asked part present); (b) dataset conventions (extensions, header fields, forwarded chains). (a) carries a risk: o1's concision rule (−4.7) dropped needed parts; demos show complete answers by construction, so the bet is that imitation works where a rule did not.

## 2. Demo bank (`tools/b-bank.js`)

700 DEMO questions (500 hits), 26 mailboxes; gold email median 1,761 chars (461 ≤ 2,500); types other 493, who 66, url-contact 62, number 42, when 37. Per entry: question, gold answer, gold path (+ twins / near-duplicates), type, gates' first context (gold inside for 526).

Honesty rules (b-common.js `selectDemos`): a demo is never from the asker's mailbox (TEST questions come from mailboxes that are not in the bank) and never shares the gold email, a twin or a near-duplicate with the question. Demos: gold email ≤ 2,500 chars, gold answer ≤ 400 chars.

Leakage check (`tools/b-leak.js`, S300-2): a chosen demo's gold answer contains a specific token (number / capitalised word not in the question) of the question's own gold in 5.3% of questions with similarity-chosen demos vs 3.7% with the fixed demos; the shared tokens are generic ("2001", "Thursday", "Company"). No demo email shares the question's subject line. Similarity choice does not hand the model its answer.

## 3. Mechanism

`withDemos(ctx, record, opts)` wraps ctx: every call whose prompt is gates' sandwich prompt gets k demos in front (chat turns: user = the sandwich prompt over the demo's email(s), assistant = the demo's gold answer; or one inline block); all other calls (YES/NO probes, picks, plans, g5's tool turns) pass through. So gates and x1 run unchanged (imports), and the composition is one line for other workers: `const { ctx: c } = await withDemos(ctx, record, opts); await X.x1.run(c, record)`. Context budget: demos dropped (least similar first) if demos + prompt > 43.5k chars (num_ctx 16,384).

Cost (stored answers, regression over 3,332 one-call answers): prefill ≈ 0.11 ms / prompt token, decode ≈ 5.5 ms / output token. 4 single-email demos ≈ 8–11k chars ≈ 2.5–3k tokens ≈ +300 ms per answer call (no prefix-cache reuse when demos vary per question).

Decision rule (lead note 21:25): a variant is judged by its paired Δ vs its own parent (gates for b-g*, x1 for b-x*) on S300-4 + S300-5, bar +1.5; the Δ vs the other system is reported too; wall times are compared within the same time window only.

## 4. Results

### 4.1 Gold-only reading harness, S300-2 (J1; the gold email alone; 100 miss / 200 hit questions)

| id | weighted | miss | hit | Δ vs b-o0 [CI] | hit flips | miss flips | wall ms | answer chars (median) | sentences (mean) |
|---|---|---|---|---|---|---|---|---|---|
| b-o0 (no demos = oracles' prompt) | 89.3 | 80.0 | 90.0 | – | – | – | 405 | 152 | 1.53 |
| b-o4s (4 similar demos, chat) | 89.1 | 83.0 | 89.5 | −0.3 [−3.6, 3.2] | +7/−8 | +9/−6 | 635 | 122 | 1.25 |
| b-o4f (4 fixed hand-picked demos, chat) | 89.9 | 81.0 | 90.5 | +0.5 [−2.2, 3.2] | +6/−5 | +8/−7 | 362 | 121 | 1.21 |
| b-o8s (8 similar demos, chat) | 88.5 | 82.0 | 89.0 | −0.8 [−3.9, 2.5] | +8/−10 | +11/−9 | 866 | 119 | 1.14 |
| b-o4L (4 similar demos with gold answers ≥ 140 chars) | 91.1 | 86.0 | 91.5 | +1.8 [−1.6, 5.7] | +9/−6 | +10/−4 | 582 | 134 | 1.25 |
| b-o4i (4 similar demos as one inline example block, single prompt) | 89.3 | 80.0 | 90.0 | +0.0 [−3.9, 4.0] | +8/−8 | +9/−9 | 546 | 144 | 1.38 |

Prefill cost (S300-2 gold-only, means): prompt tokens 893 (b-o0) → 3,303 (4 similar demos; +229 ms, ≈ 0.095 ms per added token), 5,690 (8 similar; +460 ms), 2,789 (4 fixed demos; **−43 ms**: the fixed prefix is served from Ollama's prompt cache, and answers are ~7 tokens shorter). Output tokens 40 → 32–34.

Across the three demo configurations the flips are not consistent: on hits, a majority (≥ 2 of 3) of the demo variants fixes 7 questions b-o0 gets wrong and breaks 8 it gets right; all three agree on a fix 4 times. Hedged hit answers ("does not specify") drop from 4 to 0–1 (2% of hits: not a lever). One-sentence answers rise from 47% to 77–88% of hits. The fixed demos are cheaper than no demos (362 vs 405 ms): their prefix is identical across questions (Ollama's prompt cache) and answers are shorter.

(gates on the same set: hit 89.0; the gold-only ceiling here is only +1 hit point above gates.)

- The demos **do change the answer form** as intended: 84% of answer texts change, answers get shorter (median 152 → 122 chars) and more often one sentence, closer to the gold style; hedges disappear ("The article does not state a specific title" → "Steven Kean is the Chief of Staff at Enron"; "seeking assistance with something" → the specific topic; "Gerald Nemec forwarded … to Steve" → "Steve forwarded …").
- But the shorter form also **drops needed parts** as often ("The attachment is John Protzel's latest presentation" without the purpose; a dropped deadline date), which is o1's failure (concision rule, −4.7) in a milder form. Net: hits +7/−8.
- By type (all 300): url-contact 33 → 38 of 40, who 15 → 16 of 22, other 184 → 182 of 207, when 18 → 17 of 21. Too small to act on.
- Determinism: u's `oracles` run on S300-2 reproduces b-o0's texts exactly (same prompt).

Replication on S300-1 (baseline: u's `oracles` run, the same prompt as b-o0; 92.2 weighted, hits 92.5):

| id | weighted | miss | hit | Δ vs oracles [CI] | hit flips | miss flips | wall ms | answer chars | sentences |
|---|---|---|---|---|---|---|---|---|---|
| oracles | 92.2 | 88.0 | 92.5 | – | – | – | 360 | 151 | 1.56 |
| b-o4f (4 fixed demos) | 89.3 | 86.0 | 89.5 | **−2.9 [−6.1, 0.1]** | +4/−10 | +5/−7 | 345 | 117 | 1.13 |
| b-o4L (4 similar demos, gold answers ≥ 140 chars) | 90.6 | 92.0 | 90.5 | −1.6 [−4.5, 1.1] | +5/−9 | +5/−1 | 582 | 135 | 1.20 |

Losses are again dropped context (Dawn Doucet "from Houston" cut, "the EGM presentation and the analyst meeting" replaced by the off-site meeting) and new misreadings (a third virus subject line, a mistyped second phone number). Demos chosen for long, multi-detail gold answers (b-o4L) shorten answers less (135 vs 117 chars) and lose less, but still lose.

**Gold-only pooled (S300-1 + S300-2, 600 questions):** fixed demos b-o4f −1.2 [−3.4, 0.9] (hits +10/−15); long-gold demos b-o4L +0.1 [−2.5, 2.6] (hits +14/−15; S300-2 +1.8, S300-1 −1.6, the sign flips between sets). The hypothesis that in-domain demos teach e2b to read more completely is refuted: they teach the gold's *form* (one short sentence), and that form costs content.

### 4.2 End-to-end inside gates (one-shot), S300-2

| id | weighted | Δ vs gates [CI] | miss | hit | hit flips | miss flips | same text | wall ms* | calls |
|---|---|---|---|---|---|---|---|---|---|
| gates (stored) | 85.1 | – | 31.0 | 89.0 | – | – | – | 763 | 1.04 |
| b-g4s (4 similar demos) | 85.0 | −0.1 [−4.4, 4.6] | 30.0 | 89.0 | +11/−11 | +3/−4 | 11% | 1,045 | 1.00 |
| b-g4f (4 fixed demos) | 83.6 | −1.5 [−5.1, 2.2] | 30.0 | 87.5 | +8/−11 | +3/−4 | 11% | 956 | 1.00 |

*wall times are from a busier window than gates' stored run (the lead measured gates at 967 ms in the same evening).

S300-1 and pooled (600 questions):

| id | S300-1 Δ vs gates | pooled Δ vs gates [CI] | pooled miss / hit (gates 32.5 / 88.3) | pooled hit flips | pooled miss flips |
|---|---|---|---|---|---|
| b-g4s | −0.0 [−4.4, 4.0] (hits +10/−9, misses +3/−10) | **−0.0 [−2.7, 3.0]** | 28.5 / 88.5 | +21/−20 | +6/−14 |
| b-g4f | −0.4 [−4.4, 3.4] (hits +8/−8, misses +4/−10) | **−0.9 [−3.4, 1.7]** | 29.0 / 87.5 | +16/−19 | +7/−14 |

Demos in a realistic 5-email context (gates' own context for the demo question, gold inside, distractors clipped at 2,500 chars), S300-2:

| id | weighted | Δ vs gates [CI] | miss | hit | hit flips | miss flips | wall ms* | answer chars |
|---|---|---|---|---|---|---|---|---|
| b-g2c (2 similar demos, 5-email contexts) | 84.6 | −0.5 [−4.5, 3.7] | 31.0 | 88.5 | +9/−10 | +2/−2 | 1,320 | 158 (gates 170) |

Showing the distractors shortens answers less, but reading under distraction does not improve either (the distraction headroom on this set is ~1 hit point: gold-only 90.0 vs gates 89.0).

A side effect: the demos (which always answer) nearly remove abstentions: gates' first answer abstains on 6 / 11 questions (S300-1 / S300-2), the demo variants on 1 / 1. That costs little here (gates' abstention retry was right once in 17), but it means a demo prompt must include an abstaining demo if a pipeline relies on NOT IN EMAILS as a signal.

Same picture as gold-only: ~89% of answer texts change, answers get shorter (median 170 → 125–138 chars, 1.66 → 1.25 sentences), hedges vanish, and the verdict flips are symmetric (≈ 10% of hits flip, half each way). Typical losses are new relation errors the demos do not prevent ("Bill Read is trying to set up an off-site meeting" for "Jay is trying to … with Bill Read"; "Tom Daschle is quoted" for William J. Bennett; a dropped "Natalie" in a quoted message), typical gains are hedges or vague answers made specific.

### 4.3 End-to-end inside x1 (agent), S300-2

b-x4f = x1 with the 4 fixed demos in front of every sandwich answer prompt (the commit answer, whose mean logprob is also x1's handover gate; the explore final answer; g5's final answer). Probes, picks, plans and g5's tool turns unchanged (wrapper; x1 imported, not copied).

| id | weighted | Δ vs x1 [CI] | Δ vs gates | miss | hit | hit flips vs x1 | miss flips vs x1 | wall ms | calls |
|---|---|---|---|---|---|---|---|---|---|
| x1 (stored) | 86.1 | – | +1.1 | 47.0 | 89.0 | – | – | 1,820 | 5.59 |
| b-x4f | 85.7 | −0.4 [−4.3, 3.7] | +0.7 [−3.8, 4.7] | 48.0 | 88.5 | +8/−9 | +7/−6 | 2,005* | 5.44 |

Flips vs x1 by b-x4f's path: commit (sure) hits +4/−3, misses +2/−4; commit → g5 handover hits +3/−5; found misses +5/−1; nofound +1/−2. The demos make the commit answer more confident (mean token logprob −0.105 → −0.090), so fewer questions are handed to g5 (104 → 90; 41 handovers became sure commits, 27 the other way). Path accuracies barely move (sure-commit hits 101/109 → 113/120; handover hits 63/72 → 50/61). Only 10% of final texts are identical to x1's.

### 4.4 Targeted use (demos only on unsure answers): prior evidence says this is n's generic mechanism

`tools/b-sim.js` splits a variant's flips vs gates by gates' own first-answer confidence (n-lp0's logprob trace of gates' prompt; texts equal to gates' in 296/300 and 595/600). Run on the two existing "other prompt" variants as a preview: o5 (one synthetic demo, S300-2) and o4 (rules last, S300-1 + S300-2):

| variant | confident hits (mean lp ≥ −0.1) flips | unsure hits (< −0.1) flips | simulated "gates, variant if unsure" Δ vs gates |
|---|---|---|---|
| o5 (1 synthetic demo) | +2/−5 | +6/−4 | +1.0 [−1.7, 3.6] (S300-2) |
| o4 (rules last) | +3/−3 | +12/−8 | +1.0 [−0.6, 2.6] (S300-1 + 2) |

This is n.md's finding: any other prompt is a fair coin on unsure hits (70–80% right) and only loses on confident ones, so gating a prompt change by confidence turns a slightly negative change into a slightly positive one. A demo variant would only add something new if its unsure-hit flips are clearly better than this coin. `b-gu4f` (gates; unsure → re-read with the 4 fixed demos) is defined and can be simulated from b-g4f + n-lp0 on S300-1/2 without a run.

Simulated on S300-2 from the real demo runs:

| demo variant | confident hits flips | unsure hits flips | "gates, demos if unsure" Δ vs gates |
|---|---|---|---|
| b-g4f | +4/−6 | +4/−5 | −0.5 [−3.0, 2.0] |
| b-g4s | +4/−7 | +7/−4 | +1.3 [−2.0, 4.6] |

Pooled S300-1 + S300-2 (600; unsure on 276): b-g4f −0.4 [−2.2, 1.5] (unsure hits +10/−11, misses +5/−9); b-g4s +0.8 [−1.0, 2.8] (hits +14/−10, misses +4/−9); o4 for comparison +1.0 [−0.6, 2.6]. The demo re-read is the same coin as any other prompt on unsure hits; nothing demo-specific. Not run.

### 4.5 Mechanism of the flips (all 10 demo-vs-parent comparisons, hit flips; offline)

Each flipped hit classified by comparing the losing answer with the winning one (gold-specific token = a number / capitalised word of the gold that is not in the question):

| class | demo gains (75) | demo losses (90) |
|---|---|---|
| losing answer shorter (< 0.8×) or shorter and missing a gold token | 6 | **48** |
| losing answer hedges ("does not specify") | **8** | 2 |
| losing answer lacks a gold token, not shorter | 7 | 7 |
| other (different fact / relation, judge) | 54 | 33 |

Half of the demo losses come from the shorter gold-style form; the demos' specific gains (hedges fixed) are few. The rest is the usual prompt-change coin.

## 5. Conclusions

- **In-domain few-shot demonstrations do not improve e2b's reading.** 13 demo-vs-parent comparisons on the development sets (7 gold-only, 5 inside gates, 1 inside x1); not one is outside its CI, and the hit flips are symmetric or negative:
  - gold-only, pooled S300-1 + S300-2 (600): fixed demos b-o4f −1.2 [−3.4, 0.9] (hits +10/−15); long-gold demos b-o4L +0.1 [−2.5, 2.6] (hits +14/−15; +1.8 on S300-2, −1.6 on S300-1);
  - gates, pooled S300-1 + S300-2 (600): b-g4s −0.0 [−2.7, 3.0] (hits +21/−20, misses +6/−14), b-g4f −0.9 [−3.4, 1.7] (hits +16/−19); 5-email-context demos b-g2c (S300-2) −0.5 [−4.5, 3.7];
  - x1, S300-2: b-x4f −0.4 [−4.3, 3.7] vs x1 (hits +8/−9, misses +7/−6), +0.7 vs gates.
- **What demos do:** they set the answer *form* reliably. Answers move toward the gold style (one sentence instead of two, 20–25% shorter, no hedges, almost no abstentions), and ~90% of answer texts change. For J1 the form change is not neutral: it fixes some hedged/vague answers (8 of 75 gains) and drops needed context more often (48 of 90 losses are a shorter answer), the trade-off that sank o1's concision rule (−4.7), milder here.
- **Selection and format do not matter** within the tested range: BM25-similar (other mailboxes only) ≈ fixed hand-picked ≈ inline block ≈ chat turns; k 4 ≈ 8; single gold email ≈ 5-email context; long multi-detail gold answers shorten answers less but are not better.
- **Targeted use** (demos only on gates' unsure answers) simulates to −0.4 / +0.8 on 600 questions: the generic "another prompt on unsure hits is a coin flip" effect (n.md; o4 gives +1.0 the same way). Nothing demo-specific.
- **Side effects worth knowing for anyone composing demos:** demos suppress abstention (gates' first answer abstains 17 → 2 times over 600), and they raise the commit answer's confidence in x1 (mean token logprob −0.105 → −0.090, handovers to g5 104 → 90 per 300), so they change x1's routing.
- **Cost** (S300-2, generation ms per question, same-run token counts): gates 3,220 prompt tokens / 623 ms → b-g4s 5,536 / 848 (+225 ms), b-g4f 5,021 / 789 (+166 ms), b-g2c 8,139 / 1,178 (+555 ms); x1 7,931 / 1,506 → b-x4f 10,161 / 1,677 (+171 ms, fewer handovers offset part of it). Gold-only: 4 similar demos +229 ms, 8 +460 ms, 4 fixed −43 ms (prompt cache + shorter answers). Everything is far inside the 3,243 ms cap; wall times of the demo runs (956–2,005 ms) are from a busier window than the stored parents'.
- **Decision sets:** no variant came near the bar on the development sets (best by the parent rule: b-g4s −0.0 vs gates, b-x4f −0.4 vs x1), so none was run on S300-4 / S300-5; that GPU time is better left to other workers. b-g4s and b-x4f are finished variants if the lead wants a decision-set number for the record.
- **Not run (and why):** nomic-embed demo selection (b-o4e) and same-type selection (b-o4t) are defined but not run: similar and fixed demos already behave alike, so a third selection rule is not expected to differ. Error-mined demos (e2b's own DEMO failures) would need generation and grading on DEMO and were not attempted.

Tools: `b-gold.js` (gold vs answers), `b-bank.js` (bank), `b-leak.js` (demo leakage), `b-check.js` (stub wrapper check, no GPU), `b-cmp.js` (paired comparison with flips by path), `b-flipdump.js` (flipped answers side by side), `b-sim.js` (targeted simulation). J1 spend ≈ $0.02.
