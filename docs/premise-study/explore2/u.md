# Worker u: methods from the recent literature (round 5)

Prefix `u`. Code: `benchmarks/premise2/explore2/variants/u-lit.js`, offline tools `explore2/tools/u-*.js`.
Topic: decoding-level and generator-as-scorer methods (2023–2026) that raise e2b's RAG reading accuracy at inference time, within 3,243 ms. Target: hit reading (gold-only 92.2 vs 88.5–90.5 for every system).

## 0. What gold-only reading still gets wrong (FULL-0, stored `oracles`, `tools/u-oracle.js`)

35 / 450 hits wrong. Read one by one: reference resolution across the email (the body's "you" / "G-money" / "the previous administration" / "Jim" resolved against the header or the world: 7), wrong relation or wrong one of two facts (8), incomplete list or part (6), reads the forwarder instead of the original sender (2), "the email does not specify" although it does (2), judge strictness / gold quirks (6: "Port Aranasas", "cease" vs "continue until", "Enron" for "The Big Ron"), other (4). The errors that matter are *linking* errors: the fact is in the email, e2b answers with a nearby phrase instead of resolving the reference.

## 1. Literature scan and feasibility (ranked)

API facts (Ollama 0.34.2 through `ctx.chatRaw` = `/api/chat`; server has `OLLAMA_NUM_PARALLEL=1`, so one prompt-cache slot): see §2 for the probe.

| rank | method | what it needs | fit for e2b / this task | verdict |
|---|---|---|---|---|
| 1 | **Prompt repetition** (Leviathan, Kalman & Matias, Dec 2025, arXiv 2512.14982; PARTREP, Jul 2026, tested on Gemma 4 E4B) | prompt only: `<QUERY>` → `<QUERY> Let me repeat that: <QUERY>` | causal attention: email tokens never see the closing question/rules or later emails; the second copy sees everything. Non-reasoning models: 47 wins / 0 losses of 70; biggest gains on retrieval-like lookups. Cost = one more prefill (gold-only +~60 ms, gates +~300 ms), no extra output tokens. Targets exactly the linking errors above | **pick 1** |
| 2 | **Context-aware decoding** (Shi et al. 2023) / **AdaCAD** (Wang et al., NAACL 2025) | next-token distributions with and without the context at every step | Ollama returns output-token logprobs only (no prompt echo), top_logprobs ≤ 20; per-step calls with assistant prefill; with one cache slot, alternating context / no-context prompts re-prefills the context each step → only a speculative form fits (greedy with context, verify along the path with the question-only prompt, branch on disagreement). Mechanism mismatch: private emails, so no parametric conflict; AdaCAD reports static CAD hurts on no-conflict QA | pick 2 if the probe shows it fits; expected ≈ 0 |
| 3 | Entropy-based document-parallel ensemble decoding (Qiu et al., NAACL 2025) | per-email next-token distributions at every step | targets distraction by several documents, but 5 prompts × every step with one cache slot ≈ 5× CAD cost; gold-only shows distraction is only ~2 hit points | not built |
| 4 | Sufficient context (Joren et al., ICLR 2025) | autorater + selective abstention | raises precision by abstaining; J1 scores abstention as wrong. x1's YES/NO probe is already a per-email sufficiency check | not built |
| 5 | Chain-of-Note (Yu et al. 2023), CoVe, Self-RAG critique tokens | e2b writes notes / verifies; Self-RAG needs a trained critic | z-think1 / z-ext1 (−1.4 / −0.9): e2b's own reasoning and quote-verified extraction lose on identical contexts | not built |
| 6 | FILCO (Wang et al. 2023) / CRAG knowledge strips (Yan et al. 2024) | sentence filtering by a scorer (MiniLM CE allowed) | perfect filtering is bounded by gold-only (+1.8 hits); h8's YES-filtered context ≈ 0; filtering cuts the header/context needed for the linking errors | not built |
| 7 | Speculative RAG (Wang et al. 2024) | drafts from email subsets + verifier | = map-then-pick (w2 −4.6) + a chooser (e1: e2b's pairwise choose ≈ coin) | not built |
| 8 | Lost-in-the-middle mitigations (reorder, best-last, attention sorting) | order only; attention sorting needs attention weights | gold is already first in 89% of gates' hit contexts; sandwich already repeats the question | not built (order is c's area) |
| 9 | PMI / surface-form-competition scoring of candidate answers (Holtzman et al. 2021) | logprob of a forced continuation | no prompt echo: one call per token per condition; and candidate selection is capped (z, e: perfect chooser ≤ +1.2) | not built |
| 10 | Superposition prompting, PASTA, DoLa, Lookback Lens | KV-cache / attention / layer access | not reachable through Ollama | not possible |

## 2. Feasibility probe (`u-probe`, S100-0, 2 questions, gold-only prompts; Tue 21:15 ET)

- `top_logprobs` is capped at 20 ("top_logprobs must be between 0 and 20"). Logprobs exist for output tokens only (no prompt echo), in `/api/chat` and `/api/generate`.
- **`/api/chat` does not continue a trailing assistant message for gemma4.** The rendered template closes it: `<bos><|turn>user\nQ?<turn|>\n<|turn>model\nThe answer<turn|>\n<|turn>model\n`, and the model starts a fresh answer. Prefill-based methods (CAD, forced-continuation scoring) therefore need `/api/generate` with `raw: true` and the template rendered by hand (`renderUser` in u-lit.js); raw mode works and returns logprobs. Raw calls are made with `fetch` inside the variant (inside cli2's GPU lock); they are counted in `uRawCalls` and their time is in the question's wall time.
- **The prompt cache keeps both prompts** although `OLLAMA_NUM_PARALLEL=1`: alternating a 1,180-token context prompt and a 140-token question-only prompt, the context prompt's prefill takes 25–45 ms (vs 216 ms cold). A 1-token call on a cached prefix costs 35–65 ms wall. Full per-token CAD (two calls per token, ~45 tokens) would cost ≈ 4 s per answer: over the cap; the speculative form costs one call per ambiguous position plus one per branch.
- `format` (JSON-schema enum) constrains decoding, but the returned logprobs are the *unconstrained* distribution's, and the forced string is tokenised character by character at ~46 ms/token: not a usable forced-continuation scorer.

## 3. Prompt repetition on the gold-only harness

`u-orep` = `oracles` (gold email only, sandwich prompt) with the prompt sent as `<prompt without "Answer:">\n\nLet me repeat that:\n\n<prompt>` (Leviathan et al.'s verbose form). Same run as `oracles` (paired, one call each).

| set | oracles (miss / hit) | u-orep (miss / hit) | Δ weighted [95% CI] | flips hits | flips misses | wall ms |
|---|---|---|---|---|---|---|
| S300-2 | 89.3 (80.0 / 90.0) | **92.8 (90.0 / 93.0)** | **+3.5 [1.0, 6.5]** | +8 / −2 | +13 / −3 | 406 → 472 |

The flips are the linking errors of §0: relation inversions fixed ("Gerald Nemec forwarded … to Steve" → "Steve forwarded …"; "John encountered … along with Andy" → "Charles Yeung … with Andy"), header roles resolved ("the recipient … is Michael Eiben" → "Gerald Nemec"; primary recipient "Dan J Hyvl" → "Brenda F Herod"; "trogg522@aol.com"), j1's known misread fixed ("zero or one" → "missed 1 to 5"), a vague answer made specific ("circular e-mails, reinventing the wheel"). Losses: a copied typo answer re-worded, two partial lists. 21 wins vs 5 losses (sign test p ≈ 0.001).

Second set: S300-1 gold-only: oracles 92.2 (88.0 / 92.5) → u-orep 91.3 (89.0 / 91.5), Δ −0.9 [−3.7, 2.0]; hits +3/−5, misses +3/−2. The losses read as re-rolls (judge-strict wording: "you guys" for "Keith and Frank", "The Program" for "Prior Achievement Program"), the wins again as linking fixes (three issues listed instead of two, the street address instead of the email address). **Pooled S300-2 + S300-1: +1.3 [−0.2, 3.7]** (hits 91.3 → 92.3, +11/−7; misses 84.0 → 89.5, +16/−5). Same answer length and style (174 vs 168 chars, 42 vs 40 output tokens); prompt tokens 847 → 1,649; wall +80 ms.

## 4. Prompt repetition inside x1 (`u-xrep`), S300-2

`u-xrep` = x1 unchanged, every sandwich answer prompt (commit answer, g5's final answer, explore answer) repeated through a ctx proxy; YES/NO probes, picks, plans and tool turns untouched.

| id | weighted | Δ vs x1 [CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| x1 (stored) | 86.1 | – | 47.0 | 89.0 | 1,820 | 5.59 |
| u-xrep | 87.3 | +1.1 [−1.3, 5.3] | 50.0 | 90.0 | 2,695 | 5.89 |
| gates (stored) | 85.1 | −1.1 | 31.0 | 89.0 | 763 | 1.04 |

Flips vs x1 by x1 step: hits commit +2/−1, commit-g5 +4/−4, nofound +1/0; misses found +3/0, commit-g5 +1/−1, nofound +1/−1.
**Routing side effect:** repetition lowers the commit answer's mean token logprob a little (median −0.094 → −0.105), so with x1's τ = −0.1 more commits are handed to g5 (127 vs 104 of 234; 53% vs 44% unsure). That costs wall time (more g5 calls) and moves questions to the path where every change is a coin flip. `tools/u-tau.js` (J1 on the logged commit answers of handed-over questions, scratch cache) simulates lower τ exactly (the commit answer is computed before the handover):

| τ | x1 W / hit / handed | u-xrep W / hit / handed |
|---|---|---|
| −0.10 | 86.14 / 89.0 / 103 | 87.28 / 90.0 / 124 |
| −0.11 | 87.08 / 90.0 / 87 | 88.21 / 91.0 / 108 |
| −0.13 | 87.08 / 90.0 / 69 | 88.14 / 91.0 / 71 |
| −∞ (never hand over) | 86.68 / 89.5 / 2 | 87.14 / 90.0 / 1 |

At every τ repetition is +0.5 to +1.1 over x1 on S300-2: the effect is in the reading, not the routing. A rate-matched τ for the repeated answer (shift by the median logprob shift, −0.011 → τ ≈ −0.11) would keep x1's handover rate; it is not used until S300-1 shows the same shift.

## 5. Raw mode check (`u-probe2`, S100-0, 2 questions)

- Hand-rendered `<bos><|turn>user\n{prompt}<turn|>\n<|turn>model\n` (the template Ollama renders for a single user turn with `think: false`) through `/api/generate` `raw: true` gives the same prompt token count as `/api/chat` (1,178 = 1,178; 1,215 = 1,215) and the same greedy answer (1 identical; 1 identical up to the last clause, the usual cache-state re-roll: first-token logprob −0.555 vs −0.654).
- Prefill continuation works in raw mode (`The title-like` → ` phrase of the forwarded article …`), 87 ms for 12 tokens.
- 1-token calls on the question-only prompt with a growing prefix: 25–45 ms each; a context prompt after them re-uses its cache (13 ms prefill).
- Positions with ≥ 2 plausible tokens (p ≥ 0.1 p_max) on gold-only answers: 10 of 43 and 7 of 44 tokens. So speculative CAD costs ≈ one greedy call + ~8 × 30 ms + a context call per branch: fits the cap on short answers. Full per-token CAD (2 calls × ~45 tokens × ~35 ms ≈ 3.2 s) does not.

## 6. Speculative CAD on the gold-only harness, S300-2

`u-ocad` (AdaCAD weight a = JSD bits) and `u-ocad5` (fixed α = 0.5); β = 0.1, ≤ 4 branches, raw mode. `tools/u-cad.js`.

| id | weighted | Δ vs oracles [CI] | miss | hit | flips hits | flips misses | wall ms | raw calls | branches | answer changed |
|---|---|---|---|---|---|---|---|---|---|---|
| oracles | 89.3 | – | 80.0 | 90.0 | | | 406 | 1 | | |
| u-ocad (AdaCAD) | 90.5 | +1.2 [−1.5, 4.3] | 84.0 | 91.0 | +7/−5 | +8/−4 | 841 | 8.0 | 0.98 | 173 / 300 |
| **u-ocad5 (α 0.5)** | **93.3** | **+3.9 [1.6, 6.9]** | 83.0 | **94.0** | **+9/−1** | +8/−5 | 966 | 8.2 | 1.55 | 210 / 300 |
| u-orep (repetition) | 92.8 | +3.5 [1.0, 6.5] | 90.0 | 93.0 | +8/−2 | +13/−3 | 472 | 1 | | |

Raw-mode greedy text = chat-mode `oracles` text on 236–240 / 300 (the rest are the usual cache re-rolls). Sites (positions with ≥ 2 plausible tokens): ~6 per answer.

**Caution: S300-2's gold-only baseline looks unlucky.** oracles reads hits at 90.0 on S300-2 vs 92.5 on S300-1 and 92.2 on FULL-0, and CAD and repetition fix largely the *same* S300-2 questions ("Steve forwarded …", "missed 1 to 5", "Natalie …", trogg522@aol.com, "close to 9:00"). Any change that re-rolls low-margin answers regresses an unlucky baseline upward. Controls queued: Leviathan et al.'s padding placebo `u-opad` (periods to the repeated length: same re-roll, no content), and all three methods on S300-1, S300-3 and FULL-1 (1,500 questions pooled, where baseline luck averages out).

## 7. Prompt repetition end to end: does not replicate (S300-1)

| id | set | weighted | Δ vs parent [CI] | Δ vs other | miss | hit | flips hits / misses vs parent | wall ms | calls |
|---|---|---|---|---|---|---|---|---|---|
| u-grep (gates + rep) | S300-2 | 86.3 | +1.3 [−1.6, 4.5] vs gates | +0.2 vs x1 | 29.0 | 90.5 | +8/−5 / +1/−3 | 1,161 | 1.04 |
| u-grep | S300-1 | 82.5 | −1.3 [−5.1, 1.4] vs gates | −5.1 vs x1 | 35.0 | 86.0 | +5/−8 / +4/−3 | 1,131 | 1.02 |
| u-xrep (x1 + rep) | S300-2 | 87.3 | +1.1 [−1.3, 5.3] vs x1 | +2.2 vs gates | 50.0 | 90.0 | +7/−5 / +5/−2 | 2,695 | 5.89 |
| u-xrep | S300-1 | 84.3 | **−3.3 [−5.6, −0.9]** vs x1 | +0.4 vs gates | 48.0 | 87.0 | +1/−8 / +4/−5 | 2,339 | 5.67 |
| **u-grep pooled 600** | | 84.4 | **0.0 [−2.9, 2.3]** vs gates | | 32.0 | 88.3 | | 1,146 | 1.03 |
| **u-xrep pooled 600** | | 85.8 | **−1.1 [−3.1, 0.6]** vs x1 | | 49.0 | 88.5 | | 2,517 | 5.78 |

(x1 and gates are the stored runs. Walls of u-* were measured with other workers' CPU jobs running.)

- u-xrep's S300-1 losses are on sure commits (hits +1/−5): a phone number re-copied with a typo ("512.248-3884"), an extra phone number, the wrong source document for the force-majeure language, a different kind of confirmations. These are re-rolls of answers x1 had right, not linking fixes.
- The confidence shift replicates (median commit mean logprob −0.088 → −0.101; unsure 41% → 51%), but the τ sweep (`u-tau.js`) shows u-xrep 2.5–3.4 points below x1 at *every* τ on S300-1 (τ = −∞, i.e. the repeated commit answer always kept: 83.3 vs 86.6). So the rate-matched `u-xrep2` (τ −0.11) was not run: S300-1 simulation −3.4.
- **Conclusion: prompt repetition is a null-to-negative change for e2b here.** Its S300-2 gains (gold-only +3.5, end to end +1.1/+1.3) were the regression of an unlucky set; S300-1 reverses them. Cancelled the queued S300-4/5 screening runs of u-grep / u-xrep before they started.

## 8. Prompt repetition on the gold-only harness, all four development sets

| set | oracles W (miss / hit) | u-orep W (miss / hit) | Δ [CI] | flips hits | flips misses |
|---|---|---|---|---|---|
| S300-2 | 89.3 (80.0 / 90.0) | 92.8 (90.0 / 93.0) | +3.5 [1.0, 6.5] | +8/−2 | +13/−3 |
| S300-1 | 92.2 (88.0 / 92.5) | 91.3 (89.0 / 91.5) | −0.9 [−3.7, 2.0] | +3/−5 | +3/−2 |
| S300-3 | 91.4 (83.0 / 92.0) | 90.8 (88.0 / 91.0) | −0.6 [−3.7, 2.4] | +4/−6 | +6/−1 |
| FULL-1 | 91.2 (84.0 / 91.8) | 91.5 (88.0 / 91.8) | +0.3 [−1.2, 3.4] | +12/−12 | +11/−5 |
| **pooled 1,500** | | 91.6 (88.7 / 91.8) | **+0.5 [−0.3, 2.4]** | **+27/−25** | **+33/−11** |

Repetition does nothing for hit reading (+27/−25 over 1,050 hits). It does help the gold email's reading on *miss-stratum* questions (+33/−11 over 450, +4.9 points; these are the vaguer questions whose gold BM25 does not rank), but end to end those questions rarely have the gold in context, and their weight is 6.8%. S300-2's +3.5 was its unlucky baseline (hits 90.0 vs 91.8–92.5 elsewhere). Prompt repetition is closed.

## 9. Placebo and CAD on S300-1 (gold-only)

| set | id | weighted | Δ vs oracles [CI] | flips hits | flips misses | wall ms |
|---|---|---|---|---|---|---|
| S300-2 | u-opad (padding placebo) | 90.9 | **+1.6 [−1.1, 4.6]** | +6/−3 | +4/−1 | 397 |
| S300-2 | u-ocad5 (CAD α 0.5) | 93.3 | +3.9 [1.6, 6.9] | +9/−1 | +8/−5 | 966 |
| S300-1 | u-opad | 91.8 | −0.4 [−2.5, 1.3] | +2/−3 | +3/−2 | 389 |
| S300-1 | u-ocad5 | 91.9 | −0.3 [−3.9, 2.1] | +4/−5 | +3/−1 | 1,027 |
| S300-2 + S300-1 | u-opad | | | +8/−6 | +7/−3 | |
| S300-2 + S300-1 | u-ocad5 | | | +13/−6 | +11/−6 | |

- The placebo confirms that S300-2's gold-only baseline was unlucky: a content-free perturbation gains +1.6 there (and nothing on S300-1).
- CAD on S300-1: of the 88 hit answers it changed (where the raw greedy text equals oracles'), +1/−1; it changes the answer on 219/300 questions (1.64 branches, 5.6 sites, 8.3 raw calls, ~1.0 s). Net over two sets CAD is ~+5 hits above the placebo out of 400: within noise. S300-3 and FULL-1 (750 more hits) decide.

## 10. CAD end to end inside x1 (`u-xcad`), S300-2

`u-xcad` = x1 with every sandwich answer call (commit answer, g5's final answer, explore answer) decoded by speculative CAD (α 0.5, β 0.1, ≤ 4 branches, raw mode); x1's handover gate reads the greedy pass's token logprobs, so the routing is x1's own: **same x1 step on 300/300 questions**.

| id | weighted | Δ vs x1 [CI] | Δ vs gates | miss | hit | flips hits | flips misses | wall ms | calls (counted + raw) |
|---|---|---|---|---|---|---|---|---|---|
| x1 (stored) | 86.1 | – | +1.1 | 47.0 | 89.0 | | | 1,820 | 5.59 |
| u-xcad | 86.4 | +0.3 [−2.5, 2.5] | +1.3 | 51.0 | **89.0** | **+4/−4** | +8/−4 | 2,873 | 4.24 + 14.1 raw |

CAD changed the answer text on 1.15 of 1.35 answer calls per question (identical texts with x1: 56/300) but moved hit verdicts +4/−4, on the very set where its gold-only result was +9/−1. Flips by step: hits commit +1/−2, commit-g5 +2/−2, nofound +1/0; misses commit +2/0, found +4/−2, commit-g5 +1/−1, nofound +1/−1. It mostly rewrites wording (fewer answers restate the question: 197 → 159 on gold-only), and J1 is lenient on wording. Cost: ~2.8 branches and 14 raw 1-token/continuation calls per question, +1.05 s.

**CAD is closed.** Cancelled before they started: u-xcad / u-gcad on S300-1, FULL-1 gold-only, and all S300-4/5 screening runs (no variant earned a screening slot).

CAD in the one-shot (`u-gcad` = gates with CAD on its sandwich answer calls), S300-2: 84.9, Δ vs gates **−0.1 [−3.9, 2.8]** (Δ vs x1 −1.2), miss 36.0, hit 88.5; hits +7/−8, misses +6/−1; 1,521 ms (all generation in raw mode). Like repetition, CAD helps the miss stratum a little (misses +14/−5 over u-xcad and u-gcad: with a wrong context it stops restating the question) and does nothing for hits.

## 11. CAD reads the gold email better (gold-only, three sets, placebo-controlled)

| set | oracles hit | u-opad (placebo) hit, flips | u-ocad5 (CAD) hit, flips | u-orep hit, flips |
|---|---|---|---|---|
| S300-2 | 90.0 | 91.5, +6/−3 | 94.0, +9/−1 | 93.0, +8/−2 |
| S300-1 | 92.5 | 92.0, +2/−3 | 92.0, +4/−5 | 91.5, +3/−5 |
| S300-3 | 92.0 | 90.5, +3/−6 | **94.5, +9/−4** | 91.0, +4/−6 |
| **pooled 600 hits** | 91.5 | 91.3, **+11/−12** | **93.5, +22/−10** | 91.8, +15/−13 |
| pooled weighted Δ vs oracles [CI] | | −0.0 [−1.5, 1.0] | **+2.1 [0.6, 3.6]** | +0.7 [−1.1, 2.2] |

The placebo is flat over the three sets; CAD is +2.0 hit points over gold-only reading and +2.2 over the placebo. So CAD does improve e2b's reading of **one** email; it does not survive five-email contexts (u-xcad hits +4/−4, u-gcad +7/−8): contrasting "with the five emails" against "with none" boosts whatever any of the five emails supports, distractors included.

### Where x1 could use a one-email CAD read (`tools/u-yescad.js`, offline)

When x1 ends on a **sure commit** (YES email found in W0, confident answer over the five emails) and its first YES email is the gold, a single read of the YES email is exactly the gold-only prompt, so the stored gold-only answers simulate it:

| x1 step, YES email | n hits (S300-2+1+3) | x1 right | gold alone, plain | gold alone, CAD | CAD vs x1 |
|---|---|---|---|---|---|
| sure commit, YES = gold | 313 | 289 (92.3%) | 294 | **303 (96.8%)** | **+15/−1** (per set +3/−0, +3/−1, +9/−0) |
| unsure commit (→ g5), YES = gold | 184 | 164 | 167 | 166 | +10/−8 |

e's "confident commits have no headroom" holds for re-reading the same five emails, not for reading the answer-bearing email alone with CAD. Risks: sure-commit hits whose YES email does not hold the answer (11 over four sets, x1 right on 9 by reading the other emails) and non-AB YES misses (46, x1 right on 6).

**u-xyc** = x1 unchanged; on a sure commit, re-read the first YES email alone with CAD (α 0.5) and use that answer unless it abstains or hedges. **u-xyc2** additionally requires the single read's greedy pass to be confident (mean token logprob ≥ −0.1, n's/j2's τ, not tuned). Extra cost ≈ one CAD single-email decode (~1 s) on ~45% of questions. Out-of-sample checks queued: FULL-1 gold-only CAD (217 sure-commit gold hits untouched by the analysis above), S300-1 end to end (u-xyc, u-xyc2), then S300-4/5 for u-xyc. Also queued on S300-4/5: `u-gpad`, a gates padding placebo (not a candidate) that measures the re-roll Δ of a content-free prompt change on the decision sets.

## 12. Placebo on the decision sets (`u-gpad`, not a candidate)

gates with its sandwich prompt padded by periods to about twice its length (no content added): every answer is re-rolled, the information is unchanged. Paired against the lead's stored gates runs.

| set | gates | u-gpad | Δ vs gates [CI] | flips hits | flips misses | wall ms (gates / u-gpad) |
|---|---|---|---|---|---|---|
| S300-4 | 87.9 (32.0 / 92.0) | 86.8 (29.0 / 91.0) | −1.1 [−3.7, 1.7] | +3/−5 | +0/−3 | 783 / 1,076 |
| S300-5 | 83.2 (17.0 / 88.0) | 85.6 (19.0 / 90.5) | **+2.5 [−0.7, 5.7]** | +9/−4 | +3/−1 | 967 / 1,106 |
| pooled 600 | 85.5 | 86.2 | **+0.7 [−1.3, 2.8]** | +12/−9 | +3/−4 | |

A content-free change moves a single decision set by −1.1 to +2.5 and the pooled 600 by +0.7. Set against the lead's gates-vs-x1 note (gates +0.7 vs x1 on S300-4+5 from set noise), the +1.5 bar is about two placebo draws: a candidate's paired Δ should be read against this, and per-set Δs of ±2.5 are within re-roll noise.

## 13. Out-of-sample check on FULL-1 (gold-only CAD; sure-commit simulation)

- Gold-only CAD on FULL-1: 91.9 vs oracles 91.2, Δ +0.6 [−1.2, 3.6]; hits 92.2 vs 91.8 (+16/−14), misses +7/−2. The three-set gain (+22/−10 hits) shrinks to +2 net on 450 fresh hits. Pooled over all four development sets (1,500): hits +38/−24 (+1.3 points).
- x1 sure commits with YES = gold on FULL-1 (217 hits): x1 203, gold alone plain 206, gold alone CAD 208 → **CAD vs x1 +7/−2** (three-set analysis: +15/−1). Over four sets: **+22/−3 on 530 hits**, of which about +8 net comes from reading the YES email alone and the rest from CAD.
- Expected end-to-end Δ for u-xyc: ≈ +19 hits over 1,050 dev hits (+1.8 hit points, +1.7 weighted) minus the YES ≠ gold risk (11 sure-commit hits with a non-answer-bearing YES email over four sets) and re-roll noise: ≈ +1.0 to +1.3 weighted. Marginal against the +1.5 bar.
