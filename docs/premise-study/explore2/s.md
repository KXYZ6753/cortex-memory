# s: cloze and recognition reading for e2b (round 5)

Prefix `s` (the round-1 lead stack `variants/s-stack.js` also uses the letter; its ids are `s1`–`s5`, mine are `s-*`). Code: `explore2/variants/s-cloze.js`; offline tools `explore2/tools/s-*.js`.
Hypothesis: a 2B model reads the right email better when the task is closer to pretraining (cloze, continuation of a declarative stem) or to recognition (choose among candidate spans) than to free generation. Target: x1's residual hit errors, mostly a wrong fact or relation read from the right email (j.md WF) and incomplete answers (PART).

## 1. Method (gold-only harness, hits only, all forms behind a det reset)

`s-gold` (diagnostic, not selectable): for each hit question the gold email alone, six forms, each model call preceded by i-det's reset prompt (det mode "all", also in front of raw-mode calls), so every form is computed from cache position 0 and none depends on the calls before it. The stored answer is `base`; the forms are in `renders`, graded with J1 by `c-grade.js` (shared verdict store), evaluated by `tools/s-eval.js` (paired flips, bootstrap CI with `rng.js` mulberry32, B = 10,000).

| form | what e2b is asked | answer |
|---|---|---|
| base | oracles' sandwich prompt (gold email only) | the generated answer |
| pad | placebo: the base prompt padded with periods (u-opad) | generated |
| clz | cloze by continuation: e2b rewrites the question into a statement stem that stops where the answer starts (short call, no email, six generic few-shot pairs); the base prompt is sent in raw mode with the model turn prefilled by the stem | stem + continuation |
| clzb | explicit fill-in-the-blank: "Statement: <stem> ___." before and after the email, the question once at the top | the completed statement |
| mc | recognition: typed questions (who / when / number / url-contact, plus "entity" = name/title-type other questions) get ≤ 6 options extracted deterministically (header and thread-block names, name patterns, date/number/contact regexes, quoted strings, file names; ranked by question words within ±200 chars; clz's own span always included) plus a fixed last option "None of the above"; e2b answers with a letter; score = mean log-softmax of each letter over two orderings (hash shuffle and its reverse) | the clz prefill continued with the chosen span: stem + span + continuation (the clz answer when the pick is clz's own span or "None") |
| yn | recognition, pointwise: per option "Question / Proposed answer" before the email, YES/NO after (l's better form); score = logP(YES) − logP(NO); all options NO → clz | as mc |

Rewrite prompt (v3): a system instruction plus six generic question → stem pairs as chat turns (written by hand, not from any set). v1/v2 sent the few-shot block as one completion-style user turn and e2b echoed the first example or the question (S100-0 smoke), so only v3 answers are used (`s-eval.js` filters on version `3+cold`). A stem with more than three content words not in the question (beyond verbs such as sent / scheduled / paid) is rejected as a possible answer leak; the fallback stem is "The answer is" (4 of 400 hits).

## 2. Gold-only results, S300-1 and S300-2 (200 hits each, J1)

`s-gold` v3 on both sets through `cli2` (S300-1 11:09–11:18 ET, S300-2 11:18–11:25), graded by `c-grade.js` (852 J1 calls, ≈ $0.014). Δ in hit points, paired, question bootstrap (mulberry32, B = 10,000).

| form | S300-1 hit | Δ vs base | Δ vs pad | S300-2 hit | Δ vs base | Δ vs pad | pooled 400: Δ vs base [CI] (flips) | pooled Δ vs pad [CI] |
|---|---|---|---|---|---|---|---|---|
| base | 91.5 | – | +0.5 | 90.0 | – | −3.0 | – | −1.3 [−3.3, 0.8] |
| pad (placebo) | 91.0 | −0.5 | – | 93.0 | +3.0 | – | +1.3 [−0.8, 3.3] (+11/−6) | – |
| clz | 87.0 | −4.5 | −4.0 | 87.5 | −2.5 | −5.5 | **−3.5 [−6.3, −0.8]** (+10/−24) | −4.8 [−7.8, −1.8] |
| clzb | 84.5 | −7.0 | −6.5 | 85.0 | −5.0 | −8.0 | **−6.0 [−9.5, −2.5]** (+14/−38) | −7.3 [−10.8, −3.5] |
| mc | 76.0 | −15.5 | −15.0 | 84.0 | −6.0 | −9.0 | **−10.8 [−14.5, −7.0]** (+10/−53) | −12.0 [−16.0, −8.3] |
| yn | 82.0 | −9.5 | −9.0 | 83.5 | −6.5 | −9.5 | **−8.0 [−11.5, −4.8]** (+9/−41) | −9.3 [−13.0, −5.8] |

The placebo behaves as in u.md: flat on S300-1 and +3.0 on S300-2, whose gold-only baseline is again the unlucky one (base 90.0 there, like u's oracles). Every reformulation is below base on both sets and 5–12 points below the placebo pooled.

### Refinements fixed after S300-1 (11:20 ET), before S300-2 was graded

Reading S300-1's clz flips: the losses concentrate on multi-part questions (92 of 400 hits), where one stem cannot hold two slots ("The name of the hotel … is, and the approximate location of the hotel is The Houstonian …"). The wins are relation fixes on who-questions ("… the person organizing a call is Bob", "… offered to autoschedule the deals for Stanley Cocke", "… is fedi") plus "Crosswalk.com". MC loses mostly by forced wrong picks. Four rules were fixed from S300-1 alone and replayed exactly from the stored renders (each form ran behind its own reset), with S300-2 as the held-out check:

| rule | what it does | S300-1 (in-sample) Δ vs base / vs pad | S300-2 (held out) Δ vs base / vs pad | pooled 400 vs base [CI] (flips) |
|---|---|---|---|---|
| clzS | clz on single-part questions with a real stem (`isMultiPart`), base elsewhere | −0.5 / 0.0 | −0.5 / −3.5 | −0.5 [−2.5, 1.5] (+8/−10) |
| clzW | clz on who-questions only | +1.0 / +1.5 | −0.5 / −3.5 | +0.3 [−0.8, 1.3] (+3/−2) |
| mcB | mc's span only when its pick has mean probability ≥ 0.8 over both orderings | −2.0 / −1.5 | 0.0 / −3.0 | −1.0 [−2.8, 0.8] (+5/−9) |
| ynB | yn's span only when logP(YES) − logP(NO) ≥ 2 | −2.0 / −1.5 | −2.0 / −5.0 | −2.0 [−4.0, −0.3] (+4/−12) |

None is positive beyond noise even in-sample; held out, all are ≤ 0 vs base and below the placebo.

### On the target error class (wrong fact / relation from the right email)

Base-wrong gold-only answers on both sets (37) hand-labelled with j's taxonomy (`tools/s-labels.json`): WF 14, PART 9, HEDGE 4, OVER 3, STRICT 3, HDR / GRAN / AMB / TRUNC 1 each. How many each form gets right (base 0 by construction):

| class (n) | pad | clz | clzb | mc | yn | clzS | clzW |
|---|---|---|---|---|---|---|---|
| WF (14) | 4 | 4 | 4 | 5 | 4 | 3 | 3 |
| PART (9) | 2 | 2 | 3 | 2 | 2 | 2 | 0 |
| HEDGE (4) | 1 | 1 | 2 | 0 | 0 | 0 | 0 |
| all 37 | 11 | 10 | 14 | 10 | 9 | 8 | 3 |

On j's own labels of x1's wrong hits on these two sets (`tools/s-jwf.json`, 41 questions, 10 WF), read here with the gold email alone: base 2/10 WF right, pad 3, clz 5, clzb 5, mc 4, yn 4. So the forms repair the target class at about the placebo's rate (WF: 4–5 of 14 vs the placebo's 4; +2 over the placebo on j's 10 x1-WF questions) and pay for it with far more breaks on right answers (clz −24, mc −53 per 400 hits).

### Why recognition does not help: the options, not the choice (`tools/s-mcdiag.js`)

MC/YN acted on 170 of 400 hits (typed questions with ≥ 2 extracted spans). Split by whether an option is a gold span (occurs in the reference answer, not in the question):

| | n | base right | clz right | mc pick is a gold span | mc right | yn right | mc chose "None of the above" | yn all-NO |
|---|---|---|---|---|---|---|---|---|
| gold among the options | 97 | 87 | 86 | **88 (91%)** | 84 | 83 | 0 | 12 |
| no gold option | 73 | 60 | 60 | 0 | 33 | 45 | 18 (25%) | 33 (45%) |

- **e2b recognises well when the answer is offered**: 91% of its letter picks (two orderings, debiased) are a gold span. But generation is already right on 90% of those questions, so there is no headroom there.
- **The errors live where no clean span exists**: answers that are clauses, relations or several items are not extractable as typed spans. There e2b almost never rejects every option (MC "None" 25%, YN all-NO 45%), and the forced span turns right answers wrong (mc 33 vs base 60 of 73).
- Candidate recall is the binding limit: a gold span is among the options on 57% of acted questions. Who-questions are worst, because first names like "Bob" and the lower-case "fedi" are not extracted. On the four dev sets' stored oracles answers (`s-cands.js`), only 40 of 1,050 hits are both wrong and of a typed kind, so even perfect recognition is capped near +3.8 hit points before any break.

### Cost (gold-only, per hit, including a ~36 ms reset before each call)

base 351 ms, pad 395, rewrite 218, clz 209 (prefilled, short output), clzb 339, mc 297 (two one-token calls) + final 158, yn 744 (one call per option) + final 172. A cloze re-read would cost ≈ 430 ms per acted question and fit the cap: the forms fail on accuracy, not on cost.

## 3. Gate decision: fail (stopped early, clear negative)

Gate: ≥ +2.0 hit points over base **and** over the placebo on at least two dev sets. No form reaches it on any set. All four raw forms are significantly negative pooled (clz −3.5, clzb −6.0, mc −10.8, yn −8.0 vs base; −4.8 to −12.0 vs the placebo), and the four rules fixed after S300-1 are ≤ +1.0 in-sample and ≤ 0 held out. Per the plan, no end-to-end variant was built and nothing ran on S300-3, FULL-1, S300-4/5 or FULL-2.

## 4. Conclusions

- **Cloze (continuation of a declarative stem) does not improve e2b's reading of the gold email.** Its one visible mechanism is real but narrow: a stem pins the relation, so a few relation inversions on who-questions are repaired ("… the person organizing a call is Bob", "Julie A Gomez's phone call was forwarded to Gerald Nemec by Steve"). It also forces a single slot onto multi-part questions (23% of hits) and re-rolls everything else. Restricted to single-part questions it is −0.5; restricted to who-questions it is +0.3 (+3/−2). Both are below the placebo. The explicit fill-in-the-blank form is worse (−6.0): e2b fills the blank with a phrase, drops context and sometimes the second part.
- **Recognition is accurate but has nothing to act on.** With the gold among the options e2b picks it 91% of the time, but those are the questions generation already gets right. Its remaining errors are mostly not "pick the right span of a type" problems, and e2b rarely answers "none of these". So forced-choice MC (−10.8) and pointwise YES/NO (−8.0) lose. Confidence gates (mcB, ynB) cut the damage but add nothing.
- This joins c (presentation), b (demonstrations), u (repetition, CAD), z (thinking), j/h (re-reads) and l (verification): the residual hit errors of a 2B reader are not moved by reformulating the task, and the content-free placebo is as good as or better than every reformulation tried here.

Incident: at about 11:19 ET a malformed regex left `s-cloze.js` unloadable for 1–2 minutes. `registry.js` imports every variant module, so any `cli2` command started by another worker in that window would have failed at start-up (and would simply need re-running). Nothing in the store was affected.

## Files

- `benchmarks/premise2/explore2/variants/s-cloze.js`: `s-gold` v3 (diagnostic), `rewriteMessages`, `cleanStem`, `blankPrompt`, `mcType`, `candidates` (typed span extraction), `spanIn`, `mcPrompt`, `ynPrompt`, `NONE`, `isMultiPart`.
- Tools `benchmarks/premise2/explore2/tools/`: `s-eval.js` (per-form table vs base and placebo, derived rules, class tables, cost; `FLIPS=clz` prints flips), `s-dump.js` (base-wrong answers for labelling), `s-mcdiag.js` (recognition split by gold-in-options), `s-cands.js` (offline span recall), `s-peek.js`, `s-jwf.js` + `s-jwf.json` (j's x1 labels mapped to keys), `s-labels.json` (hand labels, 37 base-wrong gold-only answers).
- Stored answers: `s-gold@3+cold` on S300-1 and S300-2 (all 300 rows each; misses are `skipped`, no call). Smoke and superseded rows (`s-gold@1` S100-0, `@2` 8 S300-1 hits from a cancelled run, `@3` S100-1 smoke) are kept in the store but unused.
- J1 spend: ≈ $0.014 (two `c-grade` runs); no `cli2 grade` needed.
