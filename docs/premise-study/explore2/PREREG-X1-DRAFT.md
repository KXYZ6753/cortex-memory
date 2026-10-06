# DRAFT — premise2 pre-registration addendum 4: the phase-2 agent (`x1`) on TEST

**Status: draft for Kerem's decision, not binding.** `gates` (addendum 3, `benchmarks/premise2/PREREG-EXPLORE.md`) stays the registered primary. This draft becomes binding only after four steps:
1. Kerem decides that a second TEST arm runs.
2. The file is moved to `benchmarks/premise2/PREREG-EXPLORE2.md`.
3. The placeholders (code hash, round-4 outcome) are filled in.
4. It is committed before any TEST episode of the arm.

Addendum 3 is unchanged; its confirmation of `gates` runs first and is reported regardless of this arm.

## 1. The frozen arm: `x1` (unless round 4 promotes a successor; see §2)

**Code:** `benchmarks/premise2/explore2/variants/x-agent.js` (`fusedAgent`) and its imports in `explore2/variants/` (g-agent.js, k-agent.js, a-agent.js, w-map.js, n-conf.js, p-perfect.js), `explore2/tools/p-common.js`, and the frozen modules they import. Code hash over `benchmarks/premise2/explore2/`: `<fill at freeze>`.

One question goes through these steps. All model calls are e2b with the main run's options, unless stated otherwise.

1. **Contexts, as in `gates`:**
   - W0 and W1 are the global BM25 top 5 and the header-reranked mailbox top 5.
   - The gate on the global top 1 decides which comes first.
   - The mailbox BM25 top 30 is kept for step 4.
2. **Commit check.** For each W0 email in rank order, a YES/NO prompt asks whether the email contains the information needed to answer the question (3 output tokens, with logprobs). The check stops at the first YES. The prompt never shares the answer prompt's prefix.
3. **Committed (a YES was found).**
   - Answer with `gates`' exact prompt over W0 (sandwich T2).
   - The answer is final when all of these hold: it is not an abstention, it has no hedge phrase, it is not a technical failure, and its mean token logprob is ≥ −0.1.
   - Otherwise the answer is doubted, and the question goes to the **g5 agent**. g5 is a native tool-calling loop over `search_mailbox` (BM25 within the asker's mailbox; top 3 in full plus 7 previews), `read` and `answer`, with an empty turn re-asked once. Its final answer uses the sandwich prompt over the emails it read. g5's answer is final.
4. **No YES (explore).**
   - The cross-encoder (MiniLM, CPU) orders W1 ∪ mailbox top 30, minus W0, into a list of 15 lines (sender, subject, snippet).
   - The model picks one line by number, and the picked email is YES/NO-checked.
   - After the first pick, the model writes one FROM/TO/ABOUT search plan, which runs as a fielded FTS5 query in the asker's mailbox; its results go to the top of the list.
   - The agent makes at most 3 opens and stops at the first YES.
   - The final context depends on the outcome:
     - a YES email found: that email plus the W0 top 4;
     - else, if something was picked: the W0 top 4 plus the first pick;
     - else: W0.
   - Answer with the sandwich prompt; on an exact `NOT IN EMAILS`, ask once more on W1.

**Exploration numbers** (J1, design-weighted; Δ vs `gates` with a paired stratified 95% CI):

| set | role | x1 | Δ vs gates |
|---|---|---|---|
| S300-2 | screening | 86.1 | +1.1 [−1.9, 4.3] |
| S300-1 | screening | 87.7 | +3.8 [0.9, 6.9] |
| S300-3 | confirmation | 86.0 | +2.3 [0.2, 4.3] |
| FULL-0 (600) | biased toward gates (phase 1 selected gates on it) | | +0.6 [−1.2, 2.6] |
| FULL-1 (600) | clean confirmation | 86.0 | +1.3 [−0.4, 2.9] |

Pooled over the 2,100 questions this is about +1.6; excluding FULL-0, about +2.0.

**Cost:**
- Wall time: mean 1.70–2.00 s per question by set (FULL-1 1,772 ms, about 2.7× e2b P-B; cap 3,243 ms). p95 3.2–3.9 s, max 5.4 s.
- Calls: 5.0–5.6 model calls per question, at most 14.
- Paths over 2,100 questions: commit 48%, commit → g5 33%, explore 19%.

**Determinism:** a re-run is byte-identical (600/600 answer texts, t.md). The call sequence matters through Ollama's prompt cache, so the TEST run must use this exact code path, with no interleaved other variants.

## 2. Round-4 successor (placeholder)

Round 4 (Tue 6 Oct) tests stacks of x1 with j2 and m2 (y1/y2) and handover-path reading (h).

A successor replaces x1 in §1 only if all three of these hold:
1. Pooled Δ vs x1 ≥ +1.0 over S300-2 + S300-1.
2. Wall time within the cost cap.
3. Δ vs x1 not negative on both S300-3 and FULL-1.

Otherwise x1 is the arm. Outcome (Tue 6 Oct, 19:30 ET): **no successor; x1 is the arm.** y1 (x1 + m2 + j2) met rule 1 (+1.07 pooled) and rule 2 (2,280 ms), but failed rule 3: S300-3 −2.1 [−5.1, 0.9], FULL-1 +0.2 [−1.2, 2.4], pooled confirmation −0.5 [−1.6, 1.6]. y2 missed rule 1 (+0.97); h7/h8 +0.3/+0.4. Details: `docs/premise-study/explore-journal.md` (Round 4).

## 3. Population

The same 600 TEST questions as addendum 3 (P-B items 0..599, `agent-items.json`, in order).

## 4. Hypotheses (Holm, α = .05, over the three tests)

- **Y1** e2b(x1) − e2b(P-B): superiority.
- **Y2-NI** e2b(x1) − 31b(P-B): non-inferiority at a 5-point margin.
- **Y3** e2b(x1) − e2b(gates): superiority. This tests "an e2b agent with a structured interface beats the best one-shot pipeline". Exploration expects +1 to +2, so this test is underpowered at n = 600 and a null is the likely outcome. Report it with its CI either way.

The estimator, bootstrap (mailbox-cluster, B = 10,000, seed 20260922) and Holm adjustment are as in addendum 3 §4.

`gates`' TEST answers come from addendum 3's confirmation run, as the third arm.

## 5. Grading, missing data, energy

As in addendum 3 §5–§7, with the verdict key prefix `X-explore2-x1|small|<questionKey>`. The energy logger is mandatory for this arm, because the agent's call count is its main cost. Report the following:
- joules per answer and per correct answer, against `gates`, e2b P-B and 31b P-B;
- the path mix (commit / g5 / explore);
- calls per question.

## 6. Disclosures

- Phase 2 tried about 70 configurations across one-shot, hybrid and agent families, on 3 screening sets of 300. The confirmation sets were S300-3 and FULL-1, and FULL-0 had been seen in phase 1. Selection optimism remains, and this TEST run is the guard against it.
- x1 was chosen in round 2 and confirmed on S300-3 and FULL-1 before round 3. Rounds 3–4 did not change it (unless §2 says otherwise).
- Exploration grading is J1-only, which runs about 4 points below adjudicated scores.
- The TEST runner needs a new file, `explore2/confirm2.js`. It reuses `explore/confirm.js`'s pattern: it refuses to run unless this file is committed and unmodified, and it records the explore2 code hash. It does not exist yet.

## 7. Order

1. Run addendum 3's `gates` confirmation; it needs LibreHardwareMonitor running as admin on port 8085, and the Mac's tier-A verdict files or the registered fallback.
2. Fill §1/§2 placeholders, move this file, commit it.
3. Write and commit `explore2/confirm2.js` (TEST guard, energy logger, same store layout as addendum 3).
4. Run 600 → grade → analyze; report whatever it shows.

## Deviation log
