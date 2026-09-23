# premise2 pre-registration addendum: the agent arm

An extension of the premise2 study (PREREG.md). This file is committed before the agent run starts. The text above the deviation log is hashed into the agent run's fingerprint (`agent/state.json`), so the run refuses to resume if that text changes. Deviations are appended to the log without changing the hash.

## 1. Question

With fixed BM25 top-5 contexts (cell P-B), the gold email is missing for 51 of the 600 TEST questions the 31b answered. Both e2b and the 31b lose about 4.7 accuracy points to those misses, and a fixed pipeline cannot recover them. This arm lets each model drive retrieval itself. It asks two things:

1. Does model-driven search close the retrieval gap?
2. Does scale buy search skill, when the main study found it buys little reading skill?

**Power, stated in advance.**
- Of the 51 misses, 25 still have an answer-bearing email (a twin) in the P-B top 5, and models score 76–84% on them.
- The other 26 are true misses, where models score 0–4%.
- Recall can therefore add at most about 26/600 ≈ 4.3 points.
- The 549 hits can only lose.

The main study's minimum detectable effects were about 2.5–3.5 points, so A1 and A3 are powered only if the agent loses little on hits.

## 2. Population and order

- **Questions:** the 600 TEST questions of P-B items 0..599, the prefix the 31b answered in the main run, across 120 mailboxes. P-B and P-oracle exist for every model on all of them.
- **Strata:**
  - `miss`: the gold is not in P-B's BM25 top 5 (51 questions).
  - `hit`: every other question (549).
- **Order** (`agent-items.json`, committed, seed 20260922, item hash recorded):
  1. First 200: all 51 misses, spread evenly (one every 3–4 slots) among 149 seeded-random hits.
  2. Then the remaining 400 hits, seeded-shuffled.

  Within each stratum the order is a fixed seeded permutation, so any completed prefix is a random sample of each stratum.

## 3. Arms

Every arm uses the same search index, snippets and email text. Only the model's own actions differ.

| cell | models | think | purpose |
|---|---|---|---|
| A-agent | e2b, 31b, e4b, 1b | false | the agent arm |
| A-rawfirst | e2b | false | control: the harness runs round 1 as SEARCH on the raw question, isolating who writes the query |
| A-null | e2b | false | control: answer-neutral rewording of the instructions, the agent's flip floor |
| A-think | e2b, e4b | true | exploratory: thinking mode |

- **Runtime:**
  - The main study's settings apply: temperature 0, top_p 1, seed 42, neutral penalties, `num_ctx` 16384, `num_batch` 512, and `truncate:false`.
  - `num_predict` is 160 per turn, the main run's frozen probe value, except 4096 for thinking arms, because thinking tokens count toward it.
  - Non-thinking arms stop on `\nSearch results`, `\nOpened emails` and `\nRounds left` (hallucinated tool output only).
  - Model digests and the Ollama version must equal the main run's; the run refuses otherwise.

## 4. Protocol (`agent.js`, `premise2-agent-v1`; its PROTOCOL_HASH is recorded)

The model receives one user message: the task, the three actions, a 5-round budget, the T2 answer rules and the question. There is no system role. Each assistant turn is one action line:
- `SEARCH: <keywords>` searches the global BM25 index (the same FTS5 index and query sanitiser as P-B) and returns the top 10 as snippet lines: `[id] Subject: … | From: … | <first 200 body characters, quoted-printable decoded on strong evidence as in R1, whitespace collapsed, cut at a word boundary>`.
  - Ids are sequential and stable within an episode.
  - An opened email is marked `(opened)`, and a repeated query is marked `(repeated search)`.
- `OPEN: <id>, <id>, <id>` returns up to 3 full emails (R0, verbatim).
  - An email over 12,000 characters carries an explicit `[truncated: N more characters not shown]` marker. No gold email in the population is over 7,000 characters.
  - Re-opening an id returns "already opened above"; unknown ids return an error line.
- `ANSWER: <text>` ends the episode.

The rules around those actions:
- **Parsing:**
  - The first action line wins. The parser is case-insensitive and tolerant of markdown, quotes, an `Action:` prefix and `E3` ids.
  - ANSWER text runs to the next action line.
  - A reply that is exactly `NOT IN EMAILS` counts as an answer.
- **History:** the model gets back only the canonical form of its action, never its prose; the raw output is logged.
- **Budget:**
  - At most 5 SEARCH/OPEN rounds, then a forced answer turn. Every tool reply states the rounds left.
  - A turn with no valid action consumes a round and gets a fixed correction. Two in a row go straight to the forced turn.
  - A reply without the prefix on the forced turn is taken whole as the answer. A tool call there counts as no answer.
- **Context guard:**
  - The conversation's conservative token bound (chars/2.2 plus template allowances, the main study's rule) plus one fixed output reserve of 4096 must stay under 15,500. The rule is the same for every arm and every model.
  - OPEN adds emails in the order requested while they fit, and names the rest as "not opened" with the reason.
  - Nothing is silently truncated.
- **Outcomes:**
  - answered, forced, forcedUnprefixed, noAnswer, agentOverflow. A context overflow should be impossible under the guard; if it happens, it scores INCORRECT and is never excluded.
  - Transient technical failures (`http_error`, `timeout`, `oom`, `malformed`) rerun the whole episode, up to 3 times, then score INCORRECT.
  - Only completed episodes are stored.

## 5. Queue and stop rule

- **Queue:**
  1. A determinism pilot: 10 DEV questions run twice on e2b; the share of identical transcripts is recorded.
  2. Then A-agent e2b → A-agent 31b → A-agent e4b → A-agent 1b → A-rawfirst e2b → A-null e2b → A-think e2b → A-think e4b.
- **Stop rule:**
  - An episode starts only if its projected duration ends before `POC2_STOP_AT`.
  - Whatever is cut resumes in a later session, and nothing finished is rerun.
  - Episodes are grouped in blocks of 50 with energy markers; each model gets one load, 2 warm-ups and a 30 s idle baseline.

## 6. Grading

- **Judges:** the same J1, J2 and adjudicator configuration as the main study's TEST grading (OpenRouter, see PREREG.md's deviation log), with the same rubric.
- **Tier:** every agent arm is tier A: J1 + J2 + adjudication on disagreements, consensus-INCORRECT non-abstains, and a seeded 10% of consensus-CORRECT answers.
- **Reuse:** J1 and J2 verdicts are keyed by question, references and normalised answer, so an agent answer identical to a main-study answer reuses its verdict.
- **Adjudicator evidence:** the emails as the model saw them, in order of first appearance.
  - Opened emails are shown in full (as capped); results never opened contribute their snippet line.
  - An agent that never searched has no evidence (no gold fallback).
- **Quotes** must verify against the shown text of the gold, its twins or answer-bearing emails.
- **Keys:** the adjudication key includes the sha of the evidence.
- **Storage:** agent verdicts are written to `agent/verdicts.jsonl`; the main verdicts are only read.

## 7. Hypotheses (Holm, α = .05, over A1–A3)

- **Estimator:** the design-weighted mean paired difference Σ_s (N_s/N)·Δ̄_s over the two strata, computed on the rows every arm of the contrast completed.
  - 95% percentile CI from a mailbox-cluster bootstrap (B = 10,000, seed 20260922). In each replicate, N_s is recomputed from the resampled mailboxes' full population membership.
  - Bootstrap p-values as in PREREG.md §7. Scores are the adjudicated final score.
  - A label is "robust" only if it holds under strict consensus and the span anchor too.
- **A1** (does the agent loop help the small model): e2b(A-agent) − e2b(P-B), two-sided.
- **A2** (does scale change the agency effect): [31b(A-agent) − 31b(P-B)] − [e2b(A-agent) − e2b(P-B)], two-sided.
- **A3** (can the small agent match the large baseline): e2b(A-agent) − 31b(P-B), non-inferiority at −5 points.

## 8. Exploratory (estimates and CIs only)

- The agency effect for e4b and 1b.
- Agent minus oracle for every model.
- The thinking effect (A-think − A-agent) for e2b and e4b.
- Who writes the query (A-agent − A-rawfirst).
- The null-wording flip rate.
- Accuracy in three groups: hits, misses with the answer still in the P-B top 5, and true misses.
- **Skill decomposition:**
  - query: whether the agent's searches surfaced the gold or an answer-bearing email, against the raw question's BM25 top 10; whether the first query is the question verbatim
  - selection: whether the model opened the gold, given it was shown
  - reading: accuracy when an answer-bearing email was opened, against P-oracle on the same questions
  - looping: rounds, forced answers, protocol-error and refusal rates
  - error causes: never found, shown but not opened, opened but wrong, abstained, no answer
- **Cost:** time per episode and per correct answer; computed tokens (prompt − cached + output); a FLOP proxy; and energy per correct answer (CPU package + GPU, a lower bound).

## 9. Missing data

Every episode counts. Nothing is excluded: no answer, protocol failure, overflow and technical failure after 3 attempts all score INCORRECT. Contrasts use the rows that every arm of the contrast completed, with design weights.

## Deviation log

(none)
