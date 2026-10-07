# TEST arm options after round 5 (decision memo for Kerem)

*Wed 7 Oct 2026. Not binding.* Under addendum 3, `gates` stays the registered primary, and its TEST confirmation runs first whatever is decided here. This memo sets out what a second, exploration-derived TEST arm could be, and what the evidence for each option is. Kerem decides.

## The options

| option | second TEST arm | what it tests |
|---|---|---|
| A | none | gates only (addendum 3) |
| B | `x1`, as drafted in `PREREG-X1-DRAFT.md` | the hybrid agent chosen in round 2 |
| C | `q1` = x1 + d8 + m2 (`variants/q-stack.js`), as a successor to the x1 draft | the round-5 stack, the only one in rounds 4–5 whose gain held on a fresh confirmation set |

In B or C, run the arm behind `det()` (mode "all", `variants/i-det.js` v2). det issues a fixed reset prompt before every model call. Each answer then depends only on its own question, not on what ran before, at a cost of about +150–210 ms per question. The x1 draft (§1) currently asks for "this exact code path, with no interleaved other variants" to control prompt-cache history. det removes that requirement, and a rerun of any subset reproduces exactly.

## What q1 adds to x1

q1 runs x1 unchanged and adds two retrieval mechanisms, both developed on development sets in round 5.
- **m2 recovery.** This runs when the first YES email is doubted, meaning its YES token logprob is below −0.1.
  - YES/NO probes go down the asker's mailbox, ordered by a snippet cross-encoder (top 6).
  - An accepted email E is answered first over [E, W0 top 4], in place of the g5 handover.
- **d8 seeding.** When the question is still handed over to g5, g5's first mailbox search is seeded with the first-YES email.
- **d6's lexical list** is used on the explore path.
- Answer prompts are unchanged.
- On the shared point (a doubted first YES with an unsure answer), m2 goes first.
- Stub check: q1 issues exactly the calls of x1, m2 or d8 wherever only one of them acts (`tools/q-check.js`, 0 failures).

## Evidence (J1, design-weighted; every contrast is det vs det)

| set | role | q1 − det x1 [95% CI] | q1 − det gates |
|---|---|---|---|
| S300-1 | development | +0.41 [0.0, 0.8] | – |
| S300-4 | decision (fresh) | +2.41 [0.4, 4.5] | – |
| S300-5 | decision (fresh) | +0.00 [−1.8, 1.9] | – |
| FULL-2 | clean confirmation | **+1.4 [0.6, 2.2]** | **+2.5 [0.4, 5.1]** |
| S300-4 + S300-5 + FULL-2 | pooled, 1,200 questions | **+1.29 [0.49, 2.47]**, sign-flip p = 0.004 | – |

- **Where the gain comes from:** mostly misses (miss accuracy 40.7 → 49.3 on FULL-2), plus a small hit gain (+0.9).
- **Discordant pairs, pooled over 1,200 questions:** misses +30/−9, hits +12/−4.
- **Behind det, concordant pairs are byte-identical**, so the interval reflects only the questions where q1 acts.
- **The pre-registered primary contrast on FULL-2 was q2** (q1 + thread labels): +0.9 [−1.5, 3.1], consistent, not confirmed. The labels did not replicate (q2 − q1 −0.5). q1 was named before the run as the secondary arm and as the lower-variance choice. Preferring it now is still a choice made after seeing FULL-2, and a TEST run is the guard against that.

## Cost

| | mean wall ms | p95 | model calls per question | GPU J per question | GPU J per correct answer |
|---|---|---|---|---|---|
| det gates (FULL-2) | 807 | 1,254 | 1.0 real | 81 | 96 |
| det x1 (FULL-2) | 1,944 | 3,870 | 5.5 real | 168 | 197 |
| det q1 (FULL-2) | 2,363 | 4,453 | 6.5 real | 189 | 218 |
| q1 without det (S300-1) | 2,261 | 4,212 | 6.7 | 189 | 214 |

- The cost cap is 3,243 ms mean; det q1 is inside it.
- Energy is GPU board power, design-weighted, from the FULL-2 run (`tools/i-energy.js`). CPU energy was not attributed for that run.

## Expected TEST outcome if C runs (n = 600)

- **q1 − gates:** about +2 to +2.5 from exploration, against a CI half-width of about ±2.5 at n = 600. Y3 (superiority over gates) has moderate power. Shrinkage from exploration to TEST has been the rule in this project: x1 went +2.5 → +1.7, and q2 +2.5 → +0.9.
- **q1 − x1:** about +1.3. This is not testable at n = 600 and should not be a hypothesis.
- **Y1 (vs e2b P-B) and Y2-NI (vs 31b P-B):** as in the x1 draft.

## If C is chosen, what has to happen

1. Copy `PREREG-X1-DRAFT.md`, replace §1 with q1's code (`q-stack.js` and its imports: x-agent, m-agent, d-agent, g-agent, i-det) and with the evidence above, and replace §2 with this round-5 record.
   - The verdict key prefix becomes `X-explore2-q1|small|…`.
   - The hypotheses stay Y1, Y2-NI and Y3 with Holm.
2. Write `explore2/confirm2.js`, the TEST guard with the energy logger, as already planned for x1.
3. Commit both before any TEST episode, after addendum 3's gates confirmation.

## Recommendation

**C, behind det.** Of the two exploration arms, q1 has the stronger fresh-set evidence. It is the only stack whose gain held on a clean confirmation set, and it is within the cost cap. Running it behind det makes the TEST arm reproducible question by question.

If only one extra arm is affordable, C replaces B rather than adding to it. With TEST n = 600, a q1 vs x1 difference cannot be resolved there anyway.

## Addendum: q1 without det on S300-1 (lead, Wed 11:10 ET)

This is the deployable form, run on a development set.
- **Accuracy:** 88.2 vs stored x1 87.7, +0.5 [0.1, 0.9]. Hits are identical (90.5); misses go 49 → 56.
- **Cost:** wall 2,261 ms mean, p95 4,212, max 6,684.
- **Energy** (logger plus CPU sampler):
  - 189 J per question GPU gross;
  - 181 J per question total (GPU marginal plus attributed CPU);
  - 205 J per correct answer.
  - This is comparable to worker i's S300-1 table, where x1 used 174 J per question and 199 J per correct answer.

## Addendum: FULL-3, the second replication (lead, Wed 12:25 ET)

The FULL-3 rule was fixed before the run. On FULL-3, q1 − det x1 is **+0.06** (stratified question bootstrap [−0.76, 0.85]; misses +12/−6, hits +1/−2). Against det gates, q1 is +2.0 [0.9, 3.7] and x1 is +2.0 [0.8, 3.7].

Pooled over all four fresh sets (1,800 questions), q1 − det x1 is **+0.87 [0.28, 1.88]**, p = 0.007. Over FULL-2 + FULL-3 alone it is +0.74 [0.23, 1.17].

**Updated reading.**
- q1's real gain over x1 is about +0.9 weighted, and it varies by set. Almost all of the robust part is on misses.
- On TEST (n = 600), q1 and x1 will be indistinguishable. Both should come out about +2 over gates.
- The recommendation is unchanged, but weaker.
  - **C (q1, behind det)** is the better-supported arm, because it was never below x1 on a fresh set.
  - **B (x1)** is equally defensible: it is cheaper (−18% wall, about −10% energy per correct answer) and has a longer record.
  - Either way, run the arm behind det.
