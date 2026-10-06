# Worker g: the agent interface (exploration phase 2, round 2)

Prefix `g`. Code: `benchmarks/premise2/explore2/variants/g-*.js`, tools `benchmarks/premise2/explore2/tools/g-*.js`.
Mission: close the agentic gap for e2b (frozen plain-text agent ≈37 in pool, 40.0 TEST; 31b frozen agent 75.8 TEST; gates 85.1 on S300-2) by changing the interface: Gemma 4 native function calling / JSON-schema constrained decoding, a tool set designed for a 2B model, cheap reading, few rounds, sandwich final answer.

## 1. Support probe (`g-probe`, S100-0, 5 questions)

- **Native tools work** (Ollama `/api/chat` `tools`, gemma4:e2b-it-qat): 5/5 first turns returned a well-formed `tool_calls` entry (search_mailbox with a sensible keyword query), 5/5 second turns (after a `role: tool` result) returned a well-formed `read` call. 200–400 ms per tool turn (15–22 output tokens).
- **JSON-schema `format` works**: 5/5 valid JSON objects matching the schema.
- **logprobs work** (`logprobs: true, top_logprobs: n`): per-token logprobs and alternatives returned.
- Observed reflex: after a search, e2b calls `read([1,2,3])` (opens the top results) rather than answering from previews. Good for reading; a risk when the full emails are already shown.

## 2. Designs (`variants/g-agent.js`)

Common: tools `search_mailbox(query)` (asker's mailbox BM25 top 20, header-reranked), `search_all(query)` (global BM25 top 10), `read(ids)` (≤3 at once), `answer(text)`. Every email gets a stable number. A search result shows the top emails in full (≤3,500 chars each in the agent turns) plus one-line previews (sender | subject | best-matching 200-char window). At most 3 model tool calls. The final answer is always a separate sandwich-prompt call over the emails the agent read (explicit reads first, then the other full-shown emails, ≤5), with gates' abstention retry on the other context. The agent's own answer text is not used.

- `g1` cold start (the model writes the first query), native tools. `g3` same with JSON-schema `format`.
- `g2` gates start: the first search (on the question) is made for the agent and its result is gates' first context in full + previews of the next 10 candidates (gates' second context, header-ranked mailbox list). If the agent answers at once, the final call is byte-identical to gates. `g4` same with `format`.
- v2 (before any full run): reading an email that is already shown in full is a no-op ("already shown above") and does not reorder the final context (v1 reordered it).
- `g5` cold start, mailbox search only, top 3 full + 7 previews, an empty turn is re-asked once.
- `g6` g2 with a hit-safe final (lead's FULL-0 lesson: any change to a hit prompt flips ~5% of hit answers): gates' first context top 4 + the agent's first preview read in slot 5.

## 3. Smoke (S300-2 first 30 = all misses; v1)

| | miss acc (gates on same 30: 40.0) | wall ms | calls | behaviour |
|---|---|---|---|---|
| g1 cold | 33.3 | 1,432 | 3.8 | first turn empty (no tool call, no text) on 15/30; 8/30 used search_all (other mailboxes); gold shown 8/30, in final 7/30 |
| g2 gates start | 46.7 (+2 / −0 vs gates) | 1,800 | 2.8 | reads on 20/30 (often ids 1–3 = already-full emails, fixed in v2), gold shown 18/30 (12 in full), read a previewed gold in 8 |

- The cold agent's own queries are worse than the raw question ("term of the contracts", "Gerald event relieved pressure") and search_all pulls other mailboxes; e2b frequently emits an empty turn on the first call with tools.
- After a read, e2b answers in plain text (not via `answer`); harmless since the harness treats text as "answer now".

## 4. Full S300-2 (v2, J1, 100 miss / 200 hit)

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| gates (ref) | 85.1 | – | 31.0 | 89.0 | 763 | 1.0 |
| **g2** agent, gates start, native tools | **85.0** | −0.1 [−1.3, 0.8] | 37.0 | 88.5 | 1,667 | 2.7 |
| **g1** agent, cold start, native tools | **83.6** | −1.5 [−4.5, 1.7] | 23.0 | 88.0 | 1,287 | 3.7 |
| a3 (round-1 agent) | 82.7 | −2.3 | 31.0 | 86.5 | 918 | 2.1 |
| pb | 81.4 | −3.6 | 5.0 | 87.0 | 653 | 1.0 |
| frozen e2b agent (FULL-0, plain text protocol) | ≈37 | | | | | |

**g1 (pure agent: e2b writes every query, decides read/answer).** Action sequences: search_mailbox>read>answer/text 94, search_all>... 35+, and **78/300 episodes (26%) = two empty turns in a row** (no tool call, no text): no email shown, so the harness fell back to gates' first context (disclosed; a fallback, not agent behaviour). Split: on the 222 episodes where the agent searched itself, hit 88.4 (gates on the same 146: 89.7), miss 21.1 (gates 31.6) → ≈ 83.8 weighted on that subset; the 78 fallbacks score exactly gates (87.0 / 29.2). So the genuine agent path is ≈ 84, not inflated by the fallback. Queries: 222, mean 6.5 words. Searches 0.74/question, read calls 0.59. Once the gold was shown (as a full result or a preview), it reached full text in 147/168 episodes (87.5%; frozen agent: opened 41% of shown gold) — mostly because search shows the top 2 in full; previewed-only gold was opened 11/21. Misses are worse than gates (own queries + search_all into other mailboxes: gold shown on only 25/100 misses).

**g2 (gates start).** e2b never searched (0.00 searches/question): it answers (120/300) or reads (179/300; mostly ids already in full, a no-op). Hits: it opens a preview on only 9/200 hits (all 200 have the answer in the full context), 191/200 hit answers byte-identical to gates, 1 hit lost, 0 gained. Misses: 7 gained, 1 lost. Where the misses are (answer-bearing email location, S300-2): in the full first context 33, in a preview 33, nowhere 34. With an answer-bearing preview: read it 9 (7 correct), read another preview 7 (1), read nothing 17 (4). So the remaining miss headroom is the 24 "bearing preview not read" cases (≈ +1 weighted at best) and the agent never searches for the 34 "nowhere" cases.

**g6** (g2's agent, hit-safe final: gates' first context top 4 + the first preview read in slot 5): 85.1, Δ vs gates +0.0; miss 38.0 (+7 / −0 vs gates), hit 88.5 (0 / −1), 1,637 ms, 2.7 calls. The agent turns are byte-identical to g2 (e2b deterministic), only the final differs: vs g2 +1 miss, 0 hit changes. The single lost hit is common to g2 and g6.

**g5** (pure agent: cold start, `search_mailbox`/`read`/`answer` only, top 3 in full + 7 previews, an empty turn re-asked once): **84.9**, Δ vs gates −0.2; **miss 42.0** (+19 / −8 vs gates: the best miss accuracy of any variant on S300-2 so far), hit 88.0 (+5 / −7), 1,484 ms, 3.8 calls. **No fallback: the agent wrote its own query in 300/300 episodes** (the empty-turn re-ask removed g1's 26% fallback). Behaviour: exactly one search per question (mean 6.5 words), then read 238/300 (search>read>answer 210, search>read>text 20, search>read>read 8), answer straight from the search 62. Gold shown 61/100 misses (46 in full/read), 196/200 hits (184 in full/read). When the gold appeared only as a preview it was opened 17/44 times (13/28 misses, 4/16 hits). Dropping `search_all` and re-asking on empty turns took the cold agent from 83.6 (g1) to 84.9; misses 23 → 42.

## 5. Second set S300-1 (gates there: 83.9, miss 34.0, hit 87.5)

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| g2 | 84.3 | +0.5 [0.1, 0.9] | 41.0 | 87.5 | 1,644 | 2.7 |
| g6 | 84.3 | +0.4 [0.1, 0.8] | 40.0 | 87.5 | 1,645 | 2.7 |

The gates-start agents replicate as "gates + a few misses": pooled over S300-2 + S300-1, g2 ≈ +0.2, g6 ≈ +0.2 vs gates; hit accuracy equal to gates on both sets.

## 6. Prompt reminder and JSON format (S300-2)

| variant | weighted | Δ vs gates [CI] | miss | hit | wall ms | calls | behaviour |
|---|---|---|---|---|---|---|---|
| g7 = g2 + question & decision rule restated after the first result | 84.9 | −0.2 [−1.5, 0.7] | 35.0 | 88.5 | 1,662 | 2.7 | answer 128 / read 167; opens a preview on more misses (29 vs 23) but mostly the wrong one (answer-bearing preview read 7, wrong preview 4+13) |
| g8 = g7 with JSON-schema `format` | 84.9 | −0.2 [−1.5, 0.7] | 35.0 | 88.5 | 1,614 | 2.4 | answers at once 197/300, reads 83; 0 format errors |

- Native tools vs JSON-schema `format`: same accuracy here (identical weighted, 0 parse failures in both); `format` makes e2b more decisive (answers directly more often), tools make it read more. The interface win is not tools-vs-JSON; both are reliable structured channels, unlike the free-text protocol.
- Restating the question did not improve preview selection: the bottleneck on misses with a bearing preview is choosing the right preview from a one-line excerpt.

## 7. Pure agent replication (S300-1)

| variant | weighted | Δ vs gates [95% CI] | miss | hit | wall ms | calls |
|---|---|---|---|---|---|---|
| **g5** | **86.0** | **+2.1 [−0.4, 4.9]** | 45.0 | 89.0 | 1,471 | 3.9 |
| g1 | 82.8 | −1.1 [−4.4, 2.7] | 32.0 | 86.5 | 1,312 | 3.7 |
| gates | 83.9 | – | 34.0 | 87.5 | 756 | 1.0 |

- g5 again searched itself on 300/300 (1 search each), miss +11 vs gates on both sets (S300-2 42 vs 31, S300-1 45 vs 34: systematic), hits ±1 (88.0 vs 89.0; 89.0 vs 87.5: noise, ~60/200 hit answer texts identical to gates, the rest re-worded from a different context). **Pooled S300-2 + S300-1: g5 ≈ +1.0 vs gates** (−0.2, +2.1).
- g1 (with `search_all` and no empty-turn re-ask): 120/300 first turns empty → 45+24 fallbacks; agent-searched episodes are below gates (hit 85.2 vs 87.1). g5's two fixes are what make the cold agent work.

## 8. Pooled S300-2 + S300-1 (600 questions; gates 84.5; paired bootstrap 95% CI, `/tmp`-style one-off script, same weights)

| variant | kind | weighted | Δ vs gates [95% CI] | miss | hit | gold shown → read in full |
|---|---|---|---|---|---|---|
| **g5** | pure agent (own query, own read/answer) | **85.4** | **+1.0 [−1.0, 2.5]** | 43.5 | 88.5 | 522 → 473 (91%) |
| g2 / g6 | agent, gates start | 84.7 | +0.2 [−0.5, 0.6/0.7] | 39.0 | 88.0 | 529 → 475 |
| g1 | agent, cold, + search_all, no re-ask | 83.2 | −1.3 [−4.1, 1.2] | 27.5 | 87.3 | 354 → 315 |

Frozen plain-text e2b agent: ≈37 (FULL-0), opened the gold in 41% of the episodes where it was shown. 31b frozen agent: 75.8 (TEST).

## 9. Confidence-gated agent (lead's suggestion via worker n), offline simulation

`variants/g-cgate.js` **g10**: gates' first answer with logprobs (worker n's gate: mean token logprob ≥ −0.1, no hedge, no abstention → keep gates' exact answer); on unsure questions (~49%) the g5 agent answers. Simulated exactly from stored answers (n-g5's `unsure` flag + g5's answers; e2b is deterministic, so the real variant should reproduce them; not yet run on GPU):

| set | g10 (sim) | gates | n-g5 (gate + r5) | g5 alone |
|---|---|---|---|---|
| S300-2 | **86.7** (+1.6) | 85.1 | 86.5 | 84.9 |
| S300-1 | **85.7** (+1.8) | 83.9 | 85.5 | 86.0 |
| pooled 600 | **86.2** (+1.7; miss 41.0, hit 89.5) | 84.5 | 86.0 | 85.4 |

On the unsure questions the agent beats gates on both strata (S300-2: miss 22 vs 12 of 66, hit 69 vs 67 of 81; S300-1: miss 25 vs 18 of 63, hit 68 vs 65 of 84). Expected wall ≈ 760 + 0.49 × 1,480 ≈ 1.5 s. With the gates-start agent g6 as the fallback instead: pooled 84.7 (no gain): the cold agent's own retrieval is what helps on unsure questions.

## 10. Conclusions

- **The agentic gap closes for e2b with an interface change.** The pure agent g5 (e2b writes its own query, decides what to read and when to answer, through native function calling) scores 84.9 on S300-2 and 86.0 on S300-1 (pooled 85.4 vs gates 84.5, +1.0 [−1.0, 2.5]), against ≈37 for the frozen plain-text e2b agent and 75.8 for the 31b frozen agent (TEST). It is at gates level, with clearly better misses (43.5 vs 32.5 pooled), at 1.48 s/question and 3.9 calls.
- What did it: (1) a structured action channel (native tools or JSON-schema: 0 parse failures, either works); (2) search results that show the top 3 emails **in full** with previews of the rest, so "reading the top results" costs nothing (gold shown → read in full 91%, vs 41% opened by the frozen agent); (3) the final answer is a separate sandwich-prompt call over what was read, never the agent's own text or snippets; (4) small-model hygiene: mailbox-only search (`search_all` sent g1 into other mailboxes) and one re-ask when e2b emits an empty tool turn (g1 had 26–40% empty first turns that fell back to gates).
- Gates-start agents (g2/g6/g7/g8) are safe but add little (+0.2 pooled): e2b never searches once it sees a full context, and from one-line previews it picks the bearing email only ~1/3 of the time.
- **Best overall:** g10 = gates with worker n's logprob gate, the g5 agent on unsure questions: simulated 86.7 / 85.7 (+1.6 / +1.8 vs gates; pooled +1.7), a promotion candidate pending a real run. `g9` (g5 with 5 emails in full + 10 previews per search), S300-2: 84.8, Δ vs gates −0.3 [−3.2, 3.1], miss 41.0, hit 88.0, 1,744 ms, 3.8 calls. It shows the gold more often (miss: shown 71, in full 53 vs g5 61 / 46) but reads no better: no gain over g5, and slower.
