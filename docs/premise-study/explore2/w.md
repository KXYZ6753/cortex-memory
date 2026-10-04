# Wildcard methods (prefix w): multi-call inference-time methods

Worker: wildcard methods scientist, exploration phase 2. Code: `benchmarks/premise2/explore2/variants/w-*.js`, offline tools `explore2/tools/w-*.js`.

## 1. Offline complementarity on FULL-0 (no GPU; stored answers + J1 verdicts)

Tool: `tools/w-complement.js FULL-0 gates`. gates = 86.8 weighted (miss 37.3, hit 90.4); 137/600 wrong, only **5 abstentions** (so gates' abstain-retry almost never fires; 132 wrong answers are confident).

Union with gates ("gates wrong, other right" counts as right), weighted:

| other | own | union | Δ union | gates wrong & other right (miss/hit) | other wrong & gates right |
|---|---|---|---|---|---|
| estar | 82.3 | 92.2 | +5.4 | 0/26 | 87 |
| gatea | 83.4 | 90.3 | +3.5 | 4/16 | 38 |
| pb | 80.3 | 90.1 | +3.3 | 0/16 | 88 |
| hdrud10 | 82.5 | 89.9 | +3.1 | 13/12 | 41 |
| hdru | 80.9 | 89.5 | +2.7 | 13/10 | 46 |
| gatesi | 85.6 | 89.0 | +2.2 | 2/10 | 21 |
| pbs | 83.5 | 87.0 | +0.2 | 0/1 | 57 |
| gates6 | 86.7 | 86.9 | +0.1 | 2/0 | 4 |

Oracle of all 13 non-diagnostic variants: **95.3** (miss 58.7, hit 98.0). Large, but much of it is the
run-to-run lottery (estar/pb/gatea flip different questions than gates with no systematic signal).

Can a selector harvest it without a judge? `tools/w-vote.js`: token-F1 medoid over variants' answers
(gates kept unless another answer has clearly higher agreement):

| pool with gates | medoid | changed (+good/−bad) |
|---|---|---|
| pbs, hdru, gatea | 86.6 | 39 (+2/−3) |
| pbs, hdru, pb, estar, gatea | 84.0 | 165 (+3/−22) |
| gatea, gatesi, gatesf, gatesm | 86.2 | 63 (+1/−5) |
| 10 variants | 83.5 | 270 (+7/−23) |

**Conclusion: self-consistency / answer voting across contexts does not pay** — errors are correlated
(shared distractors), and agreement favours the majority distractor answer. Candidate (3) dropped.

Where gold sits for gates on FULL-0 (`tools/w-ranks.js`; ctx0 = the context gates answers from first):

| stratum, gates | ctx0 pos 0 | ctx0 pos 1–4 | 2nd ctx only | mailbox hdr 6–20 | mailbox 21–50 | none |
|---|---|---|---|---|---|---|
| hit ok (408) | 365 | 31 | 1 | 7 | 3 | – |
| hit wrong (43) | **35** | 7 | – | 1 | – | – |
| miss ok (56) | 26 | 24 | 1 | 4 | – | 1 |
| miss wrong (94) | 7 | 12 | 14 | 38 | 10 | 13 |

Hits: gold is the first email of gates' context in 89% of hit questions, yet 35 of those are wrong
(about half are also wrong for the gold-only oracle; ~20 hit failures are oracle-right = reading/distraction).
Gold-only (oracles) vs gates: gates wrong & oracles right 91 (61 of them misses never shown).

Hypothesis H1 (map-then-pick): reading one email at a time, e2b abstains on non-answering emails and
reads the gold email at oracle quality; picking the best-ranked non-abstaining single-email answer then
removes distraction on hits. Depends entirely on single-email abstention on non-gold emails → measured
with the diagnostic `wprobe` (S100-0).

### Answer-guided re-retrieval (candidate 2), offline

`tools/w-hyde.js`: gold rank in the asker's mailbox, BM25(question) vs BM25(question + gates' stored draft answer), FULL-0.
For questions gates got **wrong** (where it would matter): misses with gold at mailbox 6–20 move to 2–5 in 8 cases but
fall to 21–50 in 10 (23 stay); gold at 2–5 → 1 in 4, but 2–5 → 6–20 in 5; hits: 2 up, 3 down. For questions gates got
right the draft pulls gold to the top (16+11+4 → rank 1) — it confirms what was already read. A wrong draft is
written from a wrong email, so it pulls that email up. **Dropped** (no net recall gain where gates fails).

## 2. Single-email behaviour (wprobe, S100-0, 100 q, 789 single-email calls)

`wprobe` (diagnostic) = gates + a single-email sandwich call for each of gates' up-to-10 candidate emails
(first context, then the unseen part of the second). `tools/w-probe.js`. Mean single-email call 323 ms.

| email kind (gold/twin/evidence-bearing) | abstains alone | at pos 0 | pos 1–4 | pos 5–9 |
|---|---|---|---|---|
| answer-bearing | 11/120 (9%) | 0/58 | 9/52 | 2/10 |
| other | 400/669 (60%) | 16/42 (38%) | 209/348 | 175/279 |

So alone, e2b abstains on 60% of non-answering emails (vs ~8% of answer-lacking 5-email contexts, per f.md),
and almost never on an answer-bearing one. Abstention becomes a usable but weak relevance signal
(precision of "answers alone" for bearing ≈ 109/378 = 29%).

Caveat: S100-0 hits are easy (gold first in gates' context in 49/50), so S100-0 says little about hits.

### Simulating map-then-pick on FULL-0 (`tools/w-sim.js`, no GPU)

A single read of the gold email = the stored `oracles` answer (same prompt, gold only); a single read of a
non-gold first email abstains 38% (measured) and is otherwise counted wrong (pessimistic: near-dups may answer).

| policy | weighted | miss | hit |
|---|---|---|---|
| gates (J1) | 86.8 | 37.3 | 90.4 |
| w1: first email alone, gates if it abstains | 81.6 | 24.3 | 85.8 |
| w3: gates, re-read alone when its answer is lexically sourced from email 1 | 84.1 | 34.2 | 87.7 |

The decisive number: on hits with gold first and gates' answer sourced from it (381 q), reading gold alone
fixes 13 gates errors but breaks 11 gates successes — single-source reading is no better than gates' reading
when gold is first (the "blending" answers are mostly hard questions, not distraction). Answering from the
first email loses the cases where gold is at 2–5 (gates gets 31/38 of those right on hits).
**Map-then-pick by rank (w1, w2) predicted to lose; w2 still run on S300-2 as the direct test.**

Better use of the signal (H2): not to pick the answer, but to **reorder the 5-email context** — probe each
candidate alone with 5 output tokens (sees "NOT IN EMAILS"), put non-abstainers first (rank order kept),
answer once from the top 5. Offline on S100-0 (bearing proxy): misses with gold outside gates' context come
in 5/29 times; gold at 2–5 moves to first 4/12; hits unchanged (gold at pos 0 never abstains).
→ `w4` (gates' 10 candidates) and `w5` (+ next 5 header-ranked mailbox emails, 15 probes).

## 3. S300-2 runs (J1, weighted; gates 85.1 = miss 31.0 / hit 89.0, 763 ms)

| id | method | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|---|
| w2 | map-then-pick: single-email reads down gates' ≤10 emails, first non-abstaining answer, else gates | 80.5 | −4.6 [−8.5, −0.7] | 25.0 | 84.5 | 523 | 1.4 |
| w4 | abstention probes (5 tokens) on gates' ≤10 emails, non-abstainers first, answer top 5 | 84.7 | −0.3 [−2.8, 2.2] | 33.0 | 88.5 | 1752 | 8.7 |
| w6 | YES/NO relevance probes (3 tokens) on gates' ≤10 + hdr mailbox 6–10 (≤15), YES first, answer top 5 | 85.0 | −0.1 [−2.4, 2.4] | 37.0 | 88.5 | 2154 | 13.7 |
| w7 | w6 probing to header-ranked mailbox top 15 (≤20 probes), probe emails clipped to 3,000 chars | **85.7** | **+0.7 [−1.3, 2.7]** | 41.0 | 89.0 | 2551 | 18.7 |

w2 lost as the FULL-0 simulation predicted (−5.2 sim, −4.6 real): picking the first non-abstaining
single-email answer puts a non-gold first email in charge (9 hits lost to "never found").

YES/NO probes are a far sharper pointwise signal than single-email abstention (S300-2, w6, 3,810 probes):
answer-bearing emails YES 346/496 (70%), other emails YES 221/3,314 (6.7%) — vs abstention's 91%/40%.
Gold-at-first-position in the answering context: misses 19 → 38 (w6) vs gates, gold in context 33 → 50;
hits 188 → 194. Paired vs gates (`tools/w-pair.js`): identical contexts give identical verdicts (hit 156/156),
misses whose first email changed: w6-only right 10, gates-only right 3 (+7 net); hits whose first email changed:
+2/−3. So the method fixes retrieval order on misses (+6 miss pts ≈ +0.4 weighted) but **cannot touch hits**:
hit errors are reading errors with gold already first (FULL-0: gold-alone reading fixes 13 and breaks 11 of them).

w7 paired vs gates: misses whose first email changed (51): w7-only right 14, gates-only 3; hits: identical
contexts 153/153 identical verdicts, changed-first hits +2/−2. Gold in w7's context: misses 57 (gold first 41)
vs gates 33 (19); w7's misses are now limited by reading (read-but-wrong 20) more than retrieval (never found 37).

Cheaper gating does not work: probing only when gates switches (global top 1 from another mailbox) keeps
none of the gain (`tools/w-compose.js`: w7-on-switched-else-gates = 85.1, miss 32) — the gains come from
non-switched misses (global top 1 is the asker's but the wrong email).

## 4. Conclusions

- No eureka. Best: **w7 = 85.7, Δ vs gates +0.7 [−1.3, 2.7]** at 2,551 ms (cap 3,243), 18.7 calls → **not a promotion candidate** (needs ≥ +1.5).
- Hits are at e2b's reading ceiling for every multi-call method tried: with gold already first (89% of hits),
  re-reading it alone, re-ordering, or voting changes nothing systematic (FULL-0: +13/−11 for gold-alone reading).
  All weighted gains must come from misses, worth 0.068 each point: even +10 miss points = +0.7 weighted.
- What works, and could be combined with others' retrieval ideas: **pointwise YES/NO relevance probes with 3 output
  tokens** (~95 ms per email on the GPU) are a strong relevance signal from e2b itself (70% recall / 6.7% false-YES),
  far better than single-email abstention (60% abstain on non-bearing) or listwise selection (phase 1). As a
  re-ranker of a wider candidate pool it raises misses 31 → 41 without hurting hits.
- Dropped with evidence: self-consistency/voting across contexts (FULL-0 medoid ≤ gates), answer-guided BM25
  re-retrieval (wrong drafts pull their wrong source up), map-then-pick by rank (w2 −4.6), lexical re-read (w3, sim −2.7), abstention probes (w4 −0.3, dominated by w6/w7).
