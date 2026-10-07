# c: email rendering and reading format (round 5)

Prefix `c`. Code: `explore2/variants/c-render.js` (renderers, prompt builder, gold-only diagnostics), `explore2/variants/c-agent.js` (end-to-end wrappers on gates and x1). Offline tools `explore2/tools/c-*.js`.
Question: does presenting the emails differently (thread structure, header layout, highlighting, question hints) let e2b read hits better?

## 0. Prior evidence (read before designing)

- Main study (TEST, published in results.md): **R2 thread-attribution rendering was a clean null** for e2b on threaded emails (−0.6 [−3.3, 2.1]); R1 lossless cleanup null; RL (newest message only) −43; gold-informed sentence *selection* (dropping the rest) −18. So "label each message" has been tried once; a new twist is needed and loss of text is fatal.
- o.md (round 1): presentation changes on gates move hits ±1–2 at random (o4 rules-last +1.0 pooled, o1 concision −4.7, chat format, worked example, relevance hint, question after each email all flat/negative). Context size and gold length show no accuracy trend.
- j.md/h.md/z.md: the remaining wrong hits are mostly e2b reading limits shared by every reader (thinking, JSON extraction, re-asks all null).

## 1. Offline anatomy of hit errors (`c-anatomy.js`, `c-wrong.js`, `c-who.js`; dev sets S300-1/2/3, FULL-1, FULL-0 = 1,500 hits)

Accuracy on hits by gold-email structure (x1 / gates; oracles = gold only, FULL-0 only):

| gold email | n | x1 | gates | oracles |
|---|---|---|---|---|
| single message | 643 | 92.2 | 90.7 | 94.4 (214) |
| 2 messages | 512 | 88.9 | 88.9 | 89.1 (137) |
| 3+ messages | 345 | 86.4 | 86.4 | 91.9 (99) |

- 57% of hit gold emails are reply/forward chains, and they hold 104 of x1's 154 wrong hits. Raw SMTP header lines (5/1,500), `>` quoting (57), long recipient lists (40 with > 5) and disclaimers (156, no penalty) are rare or harmless; emails are short (median ~1.5k chars, 1 over 10k).
- **Who-questions on chains are the worst cell: x1 75.0% (28 wrong / 112), gates 74.1, oracles 75.8** vs 90.3 for who on single emails and ~90 for other types. 9.5% of hits are who-questions but they carry 20% of x1's wrong hits. Evidence in the file header (sender/recipient questions): x1 83.5%.
- Read one by one (38 wrong who-hits): relation inversions in Lotus/Outlook chains (the forwarder or the writer named instead of the person asked/mentioned; "primary recipient" taken from the wrong message; "your changes" not resolved to the recipient), plus judge strictness ("you and Whaley") and a few ambiguous golds. Perhaps a third look fixable by explicit per-message From/To.
- Answer-evidence location (best 3-line window by novel-answer-word coverage): top message 789 (x1 91.1), embedded message 477 (89.1), embedded header block 108 (88.0), file header 115 (83.5).

Key-line selection (`c-keys.js`; units = sentences/short lines of the gold email, ~17 per email; evidence unit = max novel-answer-word coverage): top-3 contains the evidence unit for 74% of hits with the MiniLM CE (1.8 ms/pair on CPU), 71% lexical; **but only 57% on x1's wrong hits** (both scorers). A highlight would point at the right sentence in about half of the cases where e2b errs and at the wrong one in a quarter of the cases where it is right.

## 2. Renderers (c-render.js)

- `segmentThread` / `renderThread`: own segmenter (anchored on embedded `To:` lines, Outlook `-----Original Message-----`, Lotus "Name / date", "X on date", `Forwarded by` lines, wrapped subjects); every embedded header block is replaced by one label line `[Message k of n, earlier message | From: X | Date: D | To: Y | Cc: Z | Subject: S]`; the newest message gets `[Message 1 of n (newest; the email itself) | From: Name <addr> | To: … | Subject: …]`. Lotus addresses become names ("Dan J Hyvl/HOU/ECT@ECT" → "Dan J Hyvl"), Outlook "Last, First" → "First Last", `[mailto:x]` kept as `<x>`. Body lines untouched; File: line dropped. segment.js (R2's segmenter) misses the Lotus "company line / From: Name date" layout; own segmenter finds 3,013 messages vs 2,945 on the 1,500 gold emails. Check (`c-check.js`): no novel answer word lost except label words (9 emails lose only "sender/recipients/original").
- `thread1` = thread labels only on chain emails (single-message emails stay R0, byte-identical prompts).
- `keyLines` + `cPrompt({keys})`: an excerpt block after the emails, before the final question: `[1, from <sender of that message>] "<unit>"`, k = 3, lexical (IDF-weighted question-word overlap) or CE scorer.
- `markPrompt`: the same key units wrapped in `**bold**` in place.
- `cPrompt({hint})`: one extra rule for who/when/number/url-contact questions (text.js questionType).
- `cPrompt(question, emails)` with no options = sandwichPrompt exactly.

- `renderChrono` (`chrono`): the same labelled messages in chronological order (oldest first), opened by "[A thread of n messages, oldest first; the last one is the email itself.]"; single-message emails stay R0. New twist vs R2: a reply chain reads as a conversation (question before answer).
- Segmenter v2 (21:05): Lotus forward lines wrapped after "on", IMCEANOTES mailto duplicates dropped, bare "TO:" memo lines in bodies no longer taken as headers; suspicious blocks (no sender or no date) 67 → 27 of ~1,500. c-gold/c-gold2/c-gold3 v1 (S300-1, queued before the fix) use segmenter v1; every later run uses v2.
- `c-agent.js renderingCtx(ctx, opts)`: wraps any variant's ctx; every sandwich answer prompt (gates; x1's commit answer, explore final and g5 final) is parsed back (must reproduce byte for byte) and rebuilt with cPrompt; probes, picks, plans and g5 tool turns are untouched (stub check `c-stub.js`: all differing prompts are sandwich answer prompts, on commit / handover / explore paths). Options: render, keys (k, CE or lexical), hint (1 = type hint, 2 = who relation rule), only (question types).

Excerpt quality in gates' 5-email first context (`c-ctxkeys.js`, 913 dev hits with the gold in the context): the CE top-3 units include ≥ 1 unit of the gold email 89.5% of the time but its evidence unit only 56.6% (gates right 58.6%, gates wrong 39.6%; lexical similar). So on gates' wrong hits the excerpt usually points elsewhere.

Decision rule (lead note, Tue 21:25 ET): judge an end-to-end variant by its paired Δ vs its own parent (gates or x1) on S300-4 + S300-5, bar +1.5; also report Δ vs the other system (gates has a +0.7 head start over x1 on those two sets from set noise).

## 3. Gold-only diagnostics (GPU)

`c-gold` (hits only; gold email alone; one call per distinct prompt; base = oracles' prompt): base, thread, thread1, keys (lexical), hint. `c-gold2`: base, keysce, markce, tkce (thread1 + CE excerpt). Extra answers graded by `c-grade.js` (J1, shared verdict store), evaluated by `c-gold-eval.js` (paired flips vs base, bootstrap CI, by chain / qtype).

### S300-1 (200 hits; three runs, each with its own base; segmenter v1)

Noise floor (`c-noise.js`): the identical base prompt answered in two different runs differs in text on 25–30% of hits and flips 2–4 verdicts per 200 (c-gold vs c-gold2: +2/−2; vs the u worker's `oracles` run: 0/−3). Every render effect below is of that size.

| render | hits | Δ vs base [bootstrap] | flips | chain (110) | single (90) | who (19) |
|---|---|---|---|---|---|---|
| base (c-gold) | 91.0 | – | – | 89.1 | 93.3 | 73.7 |
| thread (labels on every email; single emails get the compact From/To/Subject label, File: dropped) | 92.0 | +1.0 [−1.0, 2.5] | +5/−3 | −0.9 (+2/−3) | **+3.3 (+3/−0)** | +2/−0 |
| thread1 (labels on chain emails only) | 90.5 | −0.5 [−2.0, 1.5] | +2/−3 | −0.9 | 0 (identical) | +2/−0 |
| keys (lexical excerpt k=3) | 90.0 | −1.0 [−2.0, 1.5] | +5/−7 | 0.0 | −2.2 | +3/−2 |
| hint (question-type rule) | 91.5 | +0.5 [0.0, 2.0] | +2/−1 | 0.0 | +1.1 | +1/−1 |
| keysce (CE excerpt k=3; c-gold2, base 91.0) | 90.0 | −1.0 [−4.0, 1.0] | +6/−8 | 0.0 | −2.2 | +1/−1 |
| markce (CE key units **bold** in place) | 92.0 | +1.0 [−0.5, 1.5] | +5/−3 | 0.0 | +2.2 | +1/−2 |
| tkce (thread1 + CE excerpt) | 90.0 | −1.0 [−2.5, 1.0] | +5/−7 | 0.0 | −2.2 | +1/−1 |
| chrono (oldest-first thread; c-gold3, base 92.0) | 91.0 | −1.0 [−2.0, 1.0] | +2/−4 | −1.8 (+2/−4) | 0 (identical) | 0/−1 |
| chronohint | 91.0 | −1.0 [−1.0, 2.0] | +3/−5 | −1.8 | 0 | +1/−1 |

Reading: nothing moves gold-only reading beyond the run-to-run noise. The two chain renderings (labels in place, chronological) are flat to slightly negative **on chain emails**, i.e. where they act; this replicates the main study's R2 null with a better segmenter and with the oldest-first twist. The only positive cells are the compact header on single emails (+3/−0) and in-place bold marking (+5/−3), both small. Flips are mostly judge-level wording changes (e.g. a correct subset answer judged wrong), plus two who-question fixes by the thread labels ("Bob is getting a call together", "Lammers asked Fedi").

Decision after S300-1: the chain-only end-to-end runs on x1 (c-xT, c-xC) were cancelled before starting; the gates ones (c-gT, c-gC, S300-1) were kept as a cheap check that gold-only predicts end-to-end. Wider gold-only evidence is queued: c-gold v2 on S300-2 (200 hits) and c-goldx on FULL-1 (450 hits: base, thread, chrono, threadh2 = thread + who relation rule, markthread = thread + CE bold marks).

### S300-2 (200 hits; c-gold v2 = segmenter v2)

Base 91.0 (vs the u worker's `oracles` run: +3/−1, 137/200 identical texts).

| render | hits | Δ vs base [bootstrap] | flips | chain (127) | single (73) | who (15) |
|---|---|---|---|---|---|---|
| thread | 92.0 | +1.0 [0.5, 3.5] | +4/−2 | +3.1 (+4/−0) | −2.7 (0/−2) | +1/−0 |
| thread1 | 93.0 | +2.0 [0.5, 4.5] | +4/−0 | +3.1 (+4/−0) | 0 | +1/−0 |
| keys (lexical) | 91.5 | +0.5 [0.0, 2.5] | +6/−5 | +2.4 | −2.7 | 0/−2 |
| hint | 91.0 | 0.0 | +1/−1 | 0 | 0 | 0/−1 |

S300-2 reverses S300-1's chain/single pattern (S300-1: chains −0.9, singles +3.3; S300-2: chains +3.1, singles −2.7). Pooled over 400 hits: **thread +9/−5 (+1.0)**, thread1 +6/−3 (+0.75), keys +11/−12, hint +3/−2. The flips are partly real relation fixes ("leave a voice mail for you" → "for Jeffrey Shankman" once the recipient is named in the label; "Lammers asked Fedi"; "Bob is getting a call together") and partly wording re-rolls (a quoted message losing its first word, a date with/without "at"). Union over all S300-1 renders (`c-union.js`, 12 readings per question): 164 hits right under every presentation, 9 wrong under every one, 27 split — the split ones are a presentation lottery with no render winning systematically.

### FULL-1 (450 hits; c-goldx: base, thread, thread1, threadh2 = thread + who relation rule, markce)

Base 92.4 (vs the u worker's `oracles` run on FULL-1: +5/−2, 345/450 identical texts).

| render | hits | Δ vs base [bootstrap] | flips | chain (266) | single (184) | who (48) |
|---|---|---|---|---|---|---|
| thread | 90.7 | −1.8 [−1.8, −0.9] | +4/−12 | −1.5 | −2.2 | +2/−1 |
| thread1 | 91.6 | −0.9 [−1.6, −0.7] | +3/−7 | −1.5 | 0 | +2/−1 |
| threadh2 | 90.9 | −1.6 | +5/−12 | −1.1 | −2.2 | +3/−1 |
| markce | 90.9 | −1.6 | +6/−13 | −1.5 | −1.6 | +2/−0 |

FULL-1 is the largest and least noisy gold-only sample, and it is negative for every presentation. Flips read one by one: no parsing bug (checked the multi-message "initial email" case: labels correct, e2b picked another of the sender's three messages), mostly re-rolls and the occasional relation fix ("sent by pat.radford@enron.com" → "Becky Spencer"; "asks Doug" → "asks Dan Hyvl").

### Gold-only, pooled over S300-1 + S300-2 + FULL-1 (850 hits)

| render | flips vs base | Δ hits | who-questions (82) |
|---|---|---|---|
| thread (all emails relabelled) | +13/−17 | −0.5 | +5/−1 |
| thread1 (chains only) | +9/−10 | −0.1 | +5/−1 |
| markce (CE key units bold) | +11/−16 (S300-1 + FULL-1, 650) | −0.8 | +3/−2 |
| keys / keysce / tkce (excerpt block) | S300-1/2 only: −1.0 / −1.0 / −1.0, +0.5 | ≈ −0.5 | – |
| hint (type rule) | +3/−2 (400) | +0.25 | +1/−2 |
| chrono (oldest first) | +2/−4 (200) | −1.0 | 0/−1 |

**Conclusion of the gold-only harness: presentation does not raise e2b's reading of the gold email.** The only consistent cell is who-questions on threads (+5/−1 with labels), 10% of hits.

## 4. End-to-end (S300-1, gates; `t-ladder.js`, `c-flips.js`)

| id | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| gates (stored, Oct 4–5 run) | 83.9 | – | 34.0 | 87.5 | 756 | 1.02 |
| **c-gT** (gates + thread labels on chain emails) | 86.1 | **+2.3 [−0.6, 4.6]** | 33.0 | 90.0 | 878 | 1.02 |
| c-gC (gates + chronological thread) | 83.3 | −0.5 [−3.5, 1.5] | 33.0 | 87.0 | 873 | 1.03 |
| x1 (stored) | 87.7 | +3.8 | 49.0 | 90.5 | 1,999 | 5.41 |

c-gT vs gates: hits +8/−3 (who-chain +3/−0, other chain +3/−2, single +2/−1; 95/200 hit texts identical since 88% of gates' hit contexts hold a chain email), misses +1/−2. Read one by one, most flips are re-rolls the judge scores differently (near-identical texts: "…for the Columbia Energy Services deal" vs "…contract" flips a verdict; "the counterparty herself" right in one run, wrong in another), plus a few relation fixes on who-questions. Chronological order loses as in the gold-only test. Caveat: the gates reference is a stored run from days earlier; x1 is also +3.8 over it on this set, so S300-1 flatters any re-run.

Wall cost of the rendering itself: 0.16 ms per 5-email context (regex). The +120 ms vs the stored gates run is the machine load of tonight's shared window (c-gC, same window, 873 ms), not the method; prompt length changes little (thread labels are ~4% shorter than raw headers).

### S300-2 (c-fin1 = x1 + thread1 = c-xT; c-fin2 = gates + thread1 = c-gT; config in variants/c-final.json)

| id | weighted | Δ vs own parent [CI] | Δ vs other | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| x1 (stored; t-x1r replicate is verdict-identical) | 86.1 | – | +1.1 vs gates | 47.0 | 89.0 | 1,820 | 5.59 |
| **c-fin1** (x1 + thread labels) | **88.5** | **+2.3 [0.5, 5.5]** vs x1 | +3.4 [0.9, 5.9] vs gates | 47.0 | 91.5 | 1,865 | 5.65 |
| gates (stored) | 85.1 | – | – | 31.0 | 89.0 | 763 | 1.04 |
| c-fin2 (gates + thread labels) | 85.3 | +0.3 [−2.9, 2.7] vs gates | −0.8 vs x1 | 28.0 | 89.5 | 757 | 1.04 |

c-fin1 vs x1 by path (`c-flips.js`): hits +6/−1 (commit +2/0, handover +2/−1, nofound +2/0; who-chain +1/0), misses +3/−3. Prompt changes also move routing (commit ↔ handover on 29 hits: the labelled context changes the commit answer's confidence). The hit fixes are mostly **wrong-email reads in the 5-email context**: "Tradespark" → "Enron Corp." (the confidentiality notice of the right email), Theresa Staab's fax-number reason (x1 had quoted another email), the JDF kick-off date (Sept 13 → Sept 6), "voice mail for you" → "for Jeffrey Shankman", a hedge on Joseph Hirl's time zone removed. The loss: "three deals" vs gold "four deals".

Reading across the evidence: in the gold-only harness (one email) the labels do nothing (+9/−10 over 850 hits), but end-to-end, with five emails in the prompt, the same labels gave hits +8/−3 (gates, S300-1), +5/−4 (gates, S300-2), +6/−1 (x1, S300-2) — pooled +19/−8 on 600 paired hit answers. Mechanism consistent with the fixes: the labels help e2b tell *which message of which email* says what, i.e. they act on wrong-email/wrong-message reads (WE/HDR), which the gold-only harness cannot show. Weighted, gates-based pooled over S300-1 + S300-2 ≈ +1.3; x1-based S300-2 +2.3.

**Screening choice (fixed 00:30 ET, before the slots start):** c-fin3 = x1 + thread1 (= c-xT = c-fin1), c-fin4 = gates + thread1 (= c-gT = c-fin2) on S300-4 and S300-5. S300-3 (c-fin1, c-fin2) runs just before them as extra dev evidence.

### S300-3 (same configs; dev set run before screening)

| id | weighted | Δ vs own parent [CI] | Δ vs other | miss | hit | wall ms | calls | flips hits / misses |
|---|---|---|---|---|---|---|---|---|
| x1 | 86.0 | – | +2.3 vs gates | 38.0 | 89.5 | 1,702 | 5.25 | |
| c-fin1 (x1 + thread1) | 86.5 | +0.5 [−2.0, 3.7] | +2.8 [0.0, 6.3] vs gates | 38.0 | 90.0 | 1,767 | 5.34 | +6/−5 / +2/−2 |
| gates | 83.7 | – | – | 18.0 | 88.5 | 745 | 1.03 | |
| c-fin2 (gates + thread1) | 84.8 | +1.1 [−1.3, 3.8] | −1.2 vs x1 | 20.0 | 89.5 | 742 | 1.03 | +5/−3 / +2/0 |

c-fin1 by path: commit hits +4/−1, handover hits +2/−4 (the labels move 27 hits between commit and handover).

**Dev summary, thread labels end-to-end (Δ vs own parent):** x1-based S300-2 +2.3, S300-3 +0.5 (hits +12/−6, misses +5/−5); gates-based S300-1 +2.3, S300-2 +0.3, S300-3 +1.1 (hits +18/−10, misses +3/−5). All five paired runs are ≥ 0; hits pooled +30/−16 over 1,000 paired hit answers (≈ +1.4 hit points), against a null in the gold-only harness.

## 5. Screening on S300-4 + S300-5 (my two variants; configs fixed at 00:30 ET before the slots started)

c-fin3 = x1 + thread labels on chain emails (behaviour identical to `c-xT` / c-fin1); c-fin4 = gates + the same labels (identical to `c-gT` / c-fin2). Baselines: the lead's x1 and gates runs.

| id | set | weighted | Δ vs own parent [CI] | Δ vs other system | miss | hit | wall ms | calls | flips hits / misses |
|---|---|---|---|---|---|---|---|---|---|
| c-fin3 | S300-4 | 86.8 | −0.1 [−2.9, 3.7] vs x1 | −1.1 vs gates | 50.0 | 89.5 | 1,874 | 5.68 | +6/−6 / +5/−6 |
| c-fin3 | S300-5 | 84.5 | +1.7 [−1.2, 4.7] vs x1 | +1.3 vs gates | 36.0 | 88.0 | 1,950 | 6.03 | +7/−4 / +4/0 |
| **c-fin3** | **pooled 600** | 85.6 | **+0.8 [−1.1, 2.9] vs x1** | +0.1 [−1.9, 1.7] vs gates | 43.0 | 88.8 | 1,912 | 5.86 | +13/−10 / +9/−6 |
| c-fin4 | S300-4 | 84.9 | **−3.1 [−5.3, −0.9]** vs gates | −2.0 vs x1 | 28.0 | 89.0 | 762 | 1.02 | +1/−7 / +2/−6 |
| c-fin4 | S300-5 | 84.8 | +1.7 [−2.3, 4.6] vs gates | +2.0 vs x1 | 21.0 | 89.5 | 762 | 1.03 | +8/−5 / +4/0 |
| **c-fin4** | **pooled 600** | 84.8 | **−0.7 [−2.3, 1.3] vs gates** | +0.0 [−2.0, 2.6] vs x1 | 24.5 | 89.3 | 762 | 1.03 | +9/−12 / +6/−6 |

(Parents on the pooled 600: x1 84.8, 2,148 ms, 5.87 calls; gates 85.5, 875 ms. Walls are from different windows: the x1/gates runs on S300-5 were inflated by CPU jobs (lead note); the rendering itself costs 0.16 ms per context and calls are unchanged.)

Flips by path, c-fin3 vs x1 (`c-flips.js`, 600): hits commit +3/−4, handover (commit-g5) +6/−5, nofound +4/−1; misses commit +2/−2, handover +2/−3, found +2/−1, nofound +3/0. The labels move 56 hits between commit and handover (the commit answer's confidence changes): commit→handover 0/−2, handover→commit +2/−1. Who-questions on chains: +1/−2 (x1), +1/−3 (gates) — the who-signal of the dev sets does not replicate.

**Neither variant passes the +1.5 bar.** Pooled over every paired run (`c-pooled.js`):

| | sets | n | Δ vs own parent [CI] | hits | misses |
|---|---|---|---|---|---|
| x1 + labels | S300-2, S300-3 (dev) | 600 | +1.40 [−0.66, 3.09] | +12/−6 | +5/−5 |
| x1 + labels | S300-4, S300-5 (screening) | 600 | +0.80 [−1.07, 2.87] | +13/−10 | +9/−6 |
| x1 + labels | all four | 1,200 | +1.10 [−0.62, 2.36] | +25/−16 | +14/−11 |
| gates + labels | S300-1, S300-2, S300-3 (dev) | 900 | +1.20 [−0.16, 2.95] | +18/−10 | +3/−5 |
| gates + labels | all five | 1,500 | +0.44 [−0.87, 1.96] | +27/−22 | +9/−11 |
| x1 + labels | FULL-1 (c-xT, dev, run after screening) | 600 | **−0.7 [−3.8, 0.9]** | +13/−16 | +3/−4 |
| x1 + labels | all five (S300-2/3/4/5 + FULL-1) | 1,800 | **+0.47 [−0.92, 1.58]** | +38/−32 | +17/−15 |

FULL-1 c-xT by path vs x1: commit hits +1/−3, handover hits +7/−10, nofound +4/−3; 65 hits change route (commit ↔ handover), +2/−4. Wall 1,770 vs 1,772 ms, calls 5.32 vs 5.36.

The dev gain shrank on the fresh sets as every round-4 add-on did (gates-based: +1.2 → −0.7), and the last, largest dev set (FULL-1) is negative for x1 + labels. Per-run Δ for x1 + labels: +2.3, +0.5, −0.1, +1.7, −0.7; for gates + labels: +2.3, +0.3, +1.1, −3.1, +1.7. Pooled, labels are worth +0.5 [−0.9, 1.6] on x1 and +0.4 [−0.9, 2.0] on gates: **a null within ±1.5**.

### Composition with worker b's demonstrations

`c-agent.js withRenderAndDemos(base, ctx, record, renderOpts, demoOpts)`: renderingCtx outside, b's `withDemos` inside (b accepts any prompt starting with the sandwich head). Stub check: gates + thread1 + 2 fixed demos → 5 chat messages (2 demo turns + the labelled prompt), labels present in the final user turn. The demo emails stay R0 unless b renders them with `renderEmail(email, { render: "thread1" })`.

## 6. A presentation-adjacent lever not pursued: x1's probe on the gold

From x1's stored commit-check logs (`c-probes.js`, 1,500 dev hits): the gold was probed and answered YES first in 1,246 (x1 91% right), probed and answered **NO in 149 (10%; x1 82% right, 114 of them end on the explore "nofound" path)**, not probed in 105 (86%). Turning those NOs into YES without new false YES would be worth ≈ +0.9 hit points at most.
By structure (gold emails x1 probed): single message, evidence in the first 2.8k chars 5.6% NO; chain, evidence in the first 2.8k 9.7–13%; **evidence beyond 2.8k chars (the probe sees `clip(R0, 3000)`): 36 NO of 52 (≈ 70%)**. A question-focused window instead of the first 3,000 chars would fix most of those 52, but they are 3.5% of probed hits, so ≈ +0.2 hit points. Not run (routing, not reading; no screening variants left).

## 7. Conclusions

- **No major presentation effect exists for e2b here.** Over 850 gold-only hits (one email, no retrieval noise), thread labels, chronological threads, header normalisation, key-sentence excerpts (lexical or cross-encoder), in-place bold marking, question-type hints and a who-relation rule all sit within ±1 point of the plain email (several slightly negative on FULL-1). This replicates the main study's R2 null with a better segmenter and four new twists. The error cells that motivated the work are real (who-questions on reply chains 75% right vs ~90%), but they are e2b reading limits that survive every presentation tried; the "split" questions (13% of hits, right under some presentations and wrong under others) are a lottery no presentation wins systematically.
- **End-to-end, per-message labels are also a null.** They looked positive on the first dev sets (fixes of wrong-email / wrong-message reads in five-email contexts, which the gold-only harness cannot show), but shrank on the screening sets and turned negative on FULL-1: x1 + labels +0.47 [−0.92, 1.58] over 1,800 paired questions (screening +0.8 [−1.1, 2.9]); gates + labels +0.44 [−0.87, 1.96] over 1,500 (screening −0.7 [−2.3, 1.3]). Best id **c-fin3 = c-xT** (x1 + thread labels on chain emails): screening +0.8 vs x1, +0.1 vs gates, same calls, 0.16 ms of CPU. Not a candidate; not worth the lead's FULL-2 run.
- Why presentation cannot move e2b much here: the emails are short (median ~1.5k chars, 1 over 10k), raw header noise and quoting are rare, and the residual hit errors are relation inversions and wrong facts that e2b makes from the right sentence whatever the layout. The answer prompt's wording/layout mainly reshuffles a ~13% "split" set of questions (prompt lottery), which every round of this study has seen.
- Reusable pieces: `renderingCtx(ctx, opts)` (rebuild only answer prompts of any variant), `renderThread` / `segmentThread` (a Lotus/Outlook thread segmenter better than segment.js on this corpus), `withRenderAndDemos` (composition with b's demos), and the multi-render gold-only harness (`c-gold*` + `c-grade.js` + `c-gold-eval.js`), which tests several presentations per question in one GPU run.

## Files

- `benchmarks/premise2/explore2/variants/c-render.js`: `units`, `lexScores`, `keyLines`, `segmentThread`, `cleanName`, `renderThread`, `renderChrono`, `renderClean`, `renderEmail`, `markEmail`, `markPrompt`, `cPrompt`, `HINTS`, `HINTS2`, `ceScorerOf`; diagnostics `c-gold` (v1 S300-1, v2 S300-2), `c-gold2`, `c-gold3` (S300-1), `c-goldx` (FULL-1; config in c-final.json).
- `benchmarks/premise2/explore2/variants/c-agent.js`: `parseSandwich`, `renderingCtx`, `withRenderAndDemos`; variants `c-gT`, `c-xT` (labels), `c-gC`, `c-xC` (chronological), `c-gK`, `c-xK` (CE excerpt), `c-gW`, `c-xW` (who-only), config slots `c-fin1..4`.
- `benchmarks/premise2/explore2/variants/c-final.json`: slot configs as run (c-fin1/c-fin3 = x1 + thread1, c-fin2/c-fin4 = gates + thread1; c-goldx renders). Fixed before each slot's first run, never changed after.
- Tools `benchmarks/premise2/explore2/tools/`: `c-lib.js`, `c-inventory.js`, `c-peek.js`, `c-anatomy.js`, `c-wrong.js`, `c-who.js`, `c-show.js`, `c-check.js`, `c-stub.js`, `c-keys.js`, `c-ctxkeys.js`, `c-grade.js` (J1 for diagnostic renders, shared verdict store), `c-gold-eval.js`, `c-noise.js`, `c-union.js`, `c-flips.js`, `c-probes.js`, `c-pooled.js`.
- J1 spend for c: ≈ $0.04 (cli2 grade + c-grade).
