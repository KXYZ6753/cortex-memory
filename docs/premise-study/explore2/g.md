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
