# n: new methods (round 2)

Worker: new-methods scientist, prefix n. Code: `benchmarks/premise2/explore2/variants/n-*.js`, offline tools `explore2/tools/n-*.js` (`n-lib.js` = shared loaders).

## Offline groundwork (S300-2, no GPU)

- **Union of prompt variants on gates' own first context** (`tools/n-union.js`): gates 85.1 (hit 89.0). gates ∪ o4 88.6, ∪ o5 89.0, ∪ pb 90.9, ∪ o4+o5+pb 93.0 (hit 97.0). The reading lottery is large: different prompts on the same five emails are right on different hits. A selector with any real signal could turn part of that into accuracy; answer voting (w-vote) failed because errors are correlated, so the selector has to come from somewhere else → e2b's own token probabilities.
- **Hedged answers** (`tools/n-hedge.js`, "does not specify / mention / provide …" that still answer): rare (S300-2 7/300, FULL-0 13/600) and ~10% correct; on FULL-0 11/13 are misses where the gold-only oracle is 92% right. A "soft abstain" signal, small upside (≈ +0.2–0.4).
- **Deterministic evidence sentences** (`tools/n-evrecall.js`): in gates' contexts (≈ 70 sentences per question), the answer sentence of the gold email (proxy: ≥ 50% of the gold answer's novel words) is in the top 3 by lexical overlap 54/137 (39%) and by MiniLM CE over the top 40 lexical 72/137 (53%), top 8 66%; CE ≈ 500 ms per question. An evidence block would put the wrong sentences first about half the time → deprioritised.
- **Question-type routing** (`tools/n-qtype.js`, `n-who.js`, FULL-0): hits by type: who 77.8% (n = 45; the gold-only oracle is also 77.8), when 86.4, other 91.4, url-contact 94.0, number 96.6. The who-failures are relation inversions (requester vs. sender, cc vs. to, "G-money") that the oracle gets wrong too: a model limit, not a format problem. Dropped.
- **Lexical grounding as a selector** (`tools/n-ground.js`): choosing among gates / o4 / o5 / pb answers by the share of the answer's novel words found in one context email: 85.7 at best (+8/−5 changed), noise. A selector needs a real confidence signal.

## Logprobs

This Ollama build returns token logprobs on /api/chat (`logprobs: true, top_logprobs: k`; confirmed by g-probe: `YES` −0.017, `NO` −5.06). Generating through `ctx.chatRaw` with `truncate: false` reproduces gates' contexts exactly (stub check, 300/300).
