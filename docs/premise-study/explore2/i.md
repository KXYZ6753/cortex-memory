# Worker i (round 5): determinism and energy

Started Tue 6 Oct 20:47 ET. Topics: (1) make e2b answers independent of cross-question prompt-cache history; (2) energy per question for the main systems.

## 1. Why answers depend on earlier questions (source + server log, no GPU)

Ollama 0.34.2 no longer runs its own runner for gemma4. It launches upstream **llama-server** (llama.cpp tag `b10969`, see `LLAMA_CPP_VERSION` at the v0.34.2 tag) with:

```
llama-server ... -c 16384 -np 1 --no-jinja --chat-template chatml --flash-attn auto -b 512 -ub 512 --context-shift --keep 4
```

and sends `cache_prompt: true` on every request (hard-coded in `llm/llama_server.go`; the Ollama API has no per-request switch). Server defaults that matter (from the startup log in `%LOCALAPPDATA%\Ollama\server-manual.log`, verbosity 4):
- one slot (`n_slots = 1`), slot-similarity threshold 0.1;
- a **host-RAM prompt cache** (`cache_ram` 8 GiB): ~330 earlier prompt states are kept and the best-matching one can be loaded into the slot for a new prompt;
- gemma4 e2b has sliding-window layers (`n_swa = 512`, SWA KV cache of 1,024 cells), so a prefix can only be reused through **context checkpoints** (max 32 per slot), which are created 512 and 4 tokens before the end of each prompt.

What happens for a new prompt P (`server-context.cpp` `get_available_slot`, `server-task.cpp` `server_prompt_cache::load`, prompt-processing block):
1. If the slot's current prompt shares > 10% of P as prefix, the slot is used as is. Otherwise the slot is saved to the RAM cache and the cache is searched for a prompt X with a larger shared prefix (needs `f_keep = lcp/len(X) ≥ 0.25` and better than the slot on both `f_keep` and `f_sim`); X's whole state (KV + its checkpoint list) is loaded if found.
2. The resume point is the most recent checkpoint at or below the shared prefix: `n_past = 0` (no usable checkpoint: full re-processing), `1` (a `[0,0]` checkpoint, BOS only) or a small position k inside a shared instruction prefix (a checkpoint created 512 tokens before the end of an earlier prompt of length 513 + k).
3. The rest of P is processed in 512-token batches whose boundaries start at `n_past` (plus breaks 512 and 4 tokens before the end).

So the same prompt is computed with different batch boundaries depending on which checkpoints earlier prompts (of this and other questions) left behind. CUDA matmul and flash-attention numerics depend on batch shape, so the logits differ in the last bits, which is enough to flip a greedy token now and then. Whether a `[0,0]` checkpoint exists at all depends on whether some earlier prompt had exactly 513 tokens, and once it exists it is carried along in the slot and in cached prompt states; this explains y.md's "drifted after question 13 and never re-converged".

Server-log tally since the Tue 16:36 restart (all workers, 29,392 prompts): resume at `n_past = 0` 4,912; `n_past = 1` 20,078; **`n_past` 2–99: 2,032** (checkpoints inside shared instruction prefixes, i.e. state left by other prompts); ≥ 100: 1,130 (mostly within-question reuse, e.g. agent turns).

## 2. The fix: `det()` (opt-in wrapper, `variants/i-det.js`)

`det(run, { mode })` puts a fixed one-token call (prompt `§`, `num_predict 1`) in front of model calls:
- `mode: "all"` (variant `i-det-x1`): before every `generate`/`chatRaw` call;
- `mode: "first"` (variant `i-detq-x1`): before the first call of each question only.

Why it works: the reset prompt shares only the chat-template prefix (4 tokens) with every real prompt, and after the first question its state is always reloaded from the RAM cache (same tokens, same checkpoints, no `[0,0]`). So the next real prompt finds a 14-token slot with no checkpoint at or below 4 tokens, base `f_keep` ≈ 0.29, and is re-processed from scratch with batch boundaries that depend only on its own length. Within a question, agent turns still reuse their own previous turn (that cached prompt shares ~100% of its tokens and is loaded back). A cached prompt from another question can only be loaded if it shares > 29% of its own length with the new prompt (instruction-heavy short prompts such as the plan prompt or the g5 first turn); with `mode: "all"` its checkpoint list then starts from the reset state too.

The wrapper also stores per call the server's cached-token count (`det.cached`, the resume point) and the reset's own count (`det.resetCached`), so two histories can be compared call by call.

(Verification below.)

## 3. Energy method

- **Logger:** the main study's `energy-logger.js`, unchanged, running for the whole session (`.data/premise2/explore/i-energy.jsonl`): GPU board power from `nvidia-smi` `power.draw.instant` every 100 ms (the RTX 5060 Ti refreshes the value about every 0.5 s), CPU package power from LibreHardwareMonitor (`AMD Ryzen 7 7700X > Powers > Package`) every 1 s.
- **Windows:** one block per question, `[at − wallMs, at]` from `answers.jsonl` (the runner's own timing of `variant.run`; model load and warm-up excluded), integrated with `integrateBlocks` / `summariseEnergy` from `energy-integrate.js`, unchanged (trapezoid with edge interpolation). The GPU lock serialises generation, so the GPU power inside my windows is my run's.
- **Idle baseline:** variant `i-idle` holds the GPU lock with e2b resident (fresh load + the runner's two warm-up calls) and makes no call for 30 s, as the main study's 30 s idle after load. Marginal energy = gross − idle W × seconds, per source.
- **CPU:** the package sensor also sees other workers' CPU jobs (cross-encoders, analysis scripts), so the raw CPU numbers are upper bounds. A second estimate attributes CPU energy from my own processes' CPU time: `tools/i-cpusampler.js` logs every second the machine busy % and the cumulative CPU seconds of every node / ollama / llama-server process; package W is regressed on busy %, and a run gets slope × (100 / 16 logical CPUs) × (its runner's + llama-server's + ollama's CPU seconds in its window). Both are approximate.
- **Sets:** the first 150 questions of S300-1 (development set; stored pb, gates, t-lk and x1 answers exist there for the full 300). The energy variants are plain re-runs under my own ids (`i-e-pb`, `i-e-gates`, `i-e-tlk`, `i-e-x1`), graded fresh with J1.

## 4. Smoke (S100-6, 6 questions, Tue 21:45 ET)

`run S100-6 i-det-x1,i-pert-det-x1 6`: i-det-x1 alone, then the same questions behind per-question perturbations (none ×2, a full x1 episode on the previous question ×2, a length-varied probe, gates).
- **6/6 identical** answer texts, routes, contexts and per-call resume points.
- Resume points (`prompt_eval_cached_count`): every reset after the first resumes at 5 tokens (its own cached state); real single-turn calls resume at 4 (the shared chat-template prefix `<bos><|turn>user\n`, from the reset's state); the g5 agent's first turn (system turn with tools, shares only 2 tokens) is fully re-processed (0); its second turn resumes at ~400 from its own first turn. No call resumed at a position left by another question.
- Cost: ~36 ms per reset; x1 makes 4.5–14 real calls on these miss questions, so mode "all" adds 170–510 ms per question here.

Note: the sets list misses first (S300-1: 100 misses, then 200 hits), so "first N" subsets are miss-heavy. The energy runs therefore use all 300 questions of S300-1; the perturbation checks use the first 150 (100 misses, 50 hits), which exercises the explore path heavily.

## 5. v1 → v2: the reset prompt must be long enough (Tue 22:15 ET)

The first S300-1 perturbation run (`i-pert-det-x1` v1, 150 questions) showed one anomaly in the server log and in `det.resetCached`: on question 64 the reset resumed at 4 tokens instead of 5, and that question's first real call resumed at 3 instead of 4. Cause (log around task 11883): a perturbation call (a user-turn prompt arriving after a g5 system-turn prompt, shared prefix 2 tokens) searched the RAM cache and **loaded the cached reset state** itself (`f_keep` = 4/10 = 0.4 ≥ 0.25, `f_sim` 0.002 > 0.001), which removes it from the cache; the next reset had to be recomputed from the slot. The same can happen without perturbations in mode "first" (x1's g5 handover: system-turn agent prompts, then a user-turn prompt, all without resets). It self-healed after one call here, but it is a path to history dependence.

v2 (`version: 2` of all det variants) uses a ~25-token reset prompt (`§ 0 1 2 3 4 5 6 7 8 9 §`):
- no other prompt can load it from the cache (4/25 < 0.25);
- its checkpoints all lie above the 4-token template, so every real call that is not continuing its own conversation is processed from position 0 (expected resume point 0 instead of 4), i.e. its numerics depend on nothing but its own prompt.

v1 runs are kept in the store under version `1+cold` for reference; all verification below is v2.

v1 in mode "first" confirms the mechanism directly (`i-pert-detq-x1@1`, first 150 of S300-1, `tools/i-detstats.js`): on **44/150 questions** the reset state had been consumed by an earlier call (after a g5 handover or a perturbation; 11 of the 44 had no perturbation at all, the previous question's own handover did it). Each recomputation leaves a checkpoint one token lower, so the question's first real call resumed at 3, 2 or 1 instead of 4, drifting further with every consumption (reset resume points: 5 ×106, 4 ×25, 3 ×11, 2 ×6, 1 ×1). That is the cross-question random walk of resume points that re-rolls answers in ordinary runs, made visible. In mode "all" v1 it happened once (only perturbation calls run without a reset in front).

## 6. How to use det()

```js
// in any variants/<prefix>-*.js module
import { det } from "./i-det.js"
import { VARIANTS as Y } from "./y-stack.js"
export const VARIANTS = {
    "lead-det-y1": { version: 1, describe: "y1 behind det()", run: det((ctx, record) => Y.y1.run(ctx, record)) },  // mode "all" (default)
}
```

- Wrap **both** arms of a comparison (e.g. `i-det-x1` vs a det-wrapped challenger). A det-wrapped variant is a re-roll of its unwrapped self (its prompts are computed from position 0 rather than from whatever checkpoint the history left), so compare det with det, never det with stored unwrapped answers.
- With det on both arms, paths where the two variants issue the same prompts give byte-identical answers, so a paired Δ contains only the mechanism's effect, and offline simulations from stored det answers are exact.
- Nothing global changes: no Ollama setting, no runner change; the wrapper only adds calls through `ctx.generate`. The reset call is counted in `calls` and its time in `wallMs` (honest cost); `det.resets` / `det.resetMs` let a report subtract it.
- Mode "all" is the safe default (every real call independent of everything except its own agent conversation). Mode "first" costs one reset per question; its verification is in §7.

## 7. Verification (v2, S300-1)

### i-det-x1 alone, 300 questions (Wed 00:17–00:27 ET)

| | weighted J1 | miss | hit | wall ms (p50 / p95) | calls (incl. resets) | resets/q | reset ms/q |
|---|---|---|---|---|---|---|---|
| x1 (stored, Mon) | 87.7 | 49.0 | 90.5 | 1,999 (1,971 / 3,919) | 5.41 | – | – |
| **i-det-x1 v2** | 87.3 (Δ −0.4 [−2.1, 1.1]) | 50.0 | 90.0 | 1,947 (2,070 / 3,529) | 10.77 | 5.38 | 180 |

- Resume points of the 1,615 real calls: **89% at 0** (fully processed from the start), 11% ≥ 100 (g5 agent turns continuing their own conversation), **none at 1–99**. Every reset after the first resumed at 26 (its own cached state).
- vs stored x1: 210/300 identical texts (a re-roll, as expected: different but fixed numerics), verdicts 2 better / 2 worse, so accuracy is unchanged.

### Different history: i-pert-det-x1 v2, first 150 questions (00:27–00:34 ET)

Per-question perturbation before the question, through the raw ctx (no reset): none 30, gates on the previous question 42, a full x1 episode on the previous question 35, a probe clipped to ~430–700 tokens 43.

| i-det-x1 alone vs perturbed | n | same text | same route | same context | same per-call resume points |
|---|---|---|---|---|---|
| commit | 55 | 55 | 55 | 55 | 55 |
| commit-g5 | 53 | 53 | 53 | 53 | 53 |
| nofound | 22 | 22 | 22 | 22 | 22 |
| found | 20 | 20 | 20 | 20 | 20 |
| **all** | **150** | **150** | **150** | **150** | **150** |

Verdicts: 150 graded pairs, 0 flips.

**But the control was null:** plain x1 behind the same perturbations (`i-pert-x1`, 00:34–00:40 ET) is also **150/150 identical** to the stored Monday x1 run. So these perturbations do not move x1 at all, and the 150/150 above does not prove anything by itself. Why: the perturbations replay prompts of the previous question (gates, a probe, the previous x1 episode) that leave the server where x1's own calls had left it. The per-call resume points of plain x1 show what does matter: the first questions are processed from 0 (no `[0,0]` checkpoint yet), then the run switches to resuming at 1 for the rest, with some calls at 2–99 (checkpoints inside shared prefixes: 21–27, 36–53, 60, 76 tokens). When that switch happens, and which batch shape the BOS row last came from in a full re-processing, depends on the call sequence. t.md's x1-vs-t-lk difference (commit texts 106/127 identical) and y.md's drift at question 13 are histories that differ in exactly this way (g5 handover calls present or absent).

Two discriminating tests are therefore queued:
1. **pert2** (`i-pert2-x1` control vs `i-pert2-det-x1`, first 100): before every question, including the first, a system-turn filler prompt of hash-chosen length (~300–2,800 tokens), plus g5 agent episodes and gates on earlier questions, i.e. calls the natural sequence never contains.
2. **The natural experiment x1 vs t-lk:** t-lk issues exactly x1's probe and commit-answer calls but no g5 handover. Unwrapped, their commit-path texts differ on 21/127 questions (S300-1). Wrapped (`i-det-x1` vs `i-det-tlk`), every path that t-lk shares with x1 should be byte-identical.

### Mode "first" v2 (`i-detq-x1`, first 150; alone 00:40–00:45, perturbed 00:45–00:52 ET)

| | n | wall ms | resets/q | reset ms/q | real calls resumed at 0 / 1 / 2–99 / ≥100 |
|---|---|---|---|---|---|
| i-det-x1 (all), same 150 | 150 | 2,144 | 6.25 | 206 | 90% / 0 / 0 / 10% |
| **i-detq-x1 (first)** | 150 | 1,986 | 1.00 | 35 | 84% / 2% / 4% / 10% |

- Alone vs perturbed (pert1): **150/150 identical** texts, routes, contexts and resume points. Under the same perturbations v1 had 44/150 questions start from a drifted reset state, so pert1 does exercise the reset's weak point; v2 removes it.
- The 1 / 2–99 resume points of mode "first" are within-question reuse (a later call of the same question resumes from a checkpoint its own earlier call left), which is deterministic given the question.
- det-first vs det-all: 147/150 identical texts (3 re-rolls where within-question reuse changes batch boundaries); both are deterministic, they are just two different fixed numerics.

### gates behind det (`i-det-gates` v2, 300, 00:52–00:56 ET)

**300/300 byte-identical to the stored gates run** (Sun/Mon), at 790 ms vs 756 ms (+1.02 reset calls, 36 ms/q). This fits the mechanism: gates' prompts are long sandwich prompts (≥ ~1,500 tokens) that share only ~20 tokens across questions and never have 513 + k tokens, so no small checkpoint ever exists and every plain gates call is already processed from position 0, which is exactly what det enforces. One-shot pipelines of this shape are deterministic without det; the history dependence comes from x1-style short probes (300–700 tokens, some just above 512, leaving checkpoints inside the shared instruction prefix) and multi-turn agent calls.

### Re-runs under identical histories (energy runs, Wed 00:55–01:18 ET)

`i-e-*` are the parents' code under my ids, each in its own fresh server: x1 **300/300**, t-lk **300/300**, gates **300/300** identical to their stored S300-1 runs (Mon/Sun), pb 299/300 (question 1 only). So an identical call sequence reproduces exactly, days apart; all differences come from history.

Overhead of det (paired on the same 300 questions, same night): `i-det-x1` − `i-e-x1` = **+151 ms/question (95% CI ±52)**, i.e. +8%; its 5.4 resets take 180 ms/q. Mode "first" costs one reset (35 ms/q, ~2%). `i-det-gates` 790 vs `i-e-gates` 758 ms (+32 ms, +4%).

### The natural experiment: x1 vs t-lk, unwrapped and behind det (S300-1, 300)

t-lk issues exactly x1's probe and commit-answer calls; it lacks the g5 handover and has a leaner explore. `i-det-tlk` v2 ran Wed 01:18–01:25 ET.

| x1 route (n) | unwrapped x1 vs t-lk: same text | det x1 vs det t-lk: same text | discordant verdicts unwrapped (x1 better / worse) | discordant verdicts det |
|---|---|---|---|---|
| commit (141) | 106 | **141** | 1 / 1 | **0 / 0** |
| nofound (38–39) | 23 | **38** | 2 / 1 | **0 / 0** |
| found (21) | 10 | 16 (5 differ by design: x1 found it at open 2–3) | 2 / 0 | 2 / 0 |
| commit-g5 (99–100) | 5 | 5 (by design: g5 answer vs kept commit answer) | 7 / 4 | 9 / 5 |
| commit-or-explore decision | 297/300 | **300/300** | | |

- Unwrapped, 5 verdict flips on paths where the two systems make the same decisions are pure history noise (the ±2 per 300 of the brief). Behind det these paths are byte-identical and every discordant pair sits on a path where the systems differ by design.
- On the nofound path x1 makes extra calls (plan, own search, opens) before the same final prompt as t-lk; behind det the final answers are still identical 38/38, because each prompt is computed from position 0 regardless of what came before in the question.
- Paired Δ x1 − t-lk: unwrapped +1.6 [−0.8, 4.0], det +1.2 [−1.0, 3.6]. The bootstrap interval reflects question sampling, so its width barely changes; what changes is that the point estimate no longer contains noise flips.
- Accuracy is unchanged by det: i-det-x1 87.3 vs x1 87.7, i-det-tlk 86.1 vs t-lk 86.1, i-det-gates = gates (byte-identical).

## 8. Energy (S300-1, all 300 questions, Wed 00:17–01:25 ET)

Design-weighted per question (per-stratum means, 0.068 × miss + 0.932 × hit). GPU = RTX 5060 Ti board power; idle baseline 8.2 W (three 30 s windows, model resident). CPU attributed = own processes only (runner node + llama-server + ollama: CPU seconds × 7.8 J per CPU-second, from package W = 45.5 + 1.255 × busy %, R² 0.81 over 14,946 paired seconds). Total = GPU marginal + CPU attributed. J per correct = total ÷ design-weighted J1 accuracy. ± = 95% CI over questions. Model load (~4 s once per run) excluded. Source: `tools/i-energy.js` → `.data/premise2/explore/i-energy-table.txt`, `i-energy-summary.json`.

| system | J1 weighted | wall ms/q | GPU J/q gross | GPU J/q marginal | CPU J/q attributed (approx.) | **total J/q** | **J per correct** | mean GPU W | GPU J/q miss / hit | CPU package J/q raw (upper bound) |
|---|---|---|---|---|---|---|---|---|---|---|
| P-B (`pb`) | 77.6 | 647 | 72 ±3 | 67 | 5 | **72 ±3** | **93** | 111 | 70 / 72 | 34 |
| gates | 83.9 | 759 | 80 ±4 | 74 | 7 | **81 ±4** | **96** | 106 | 82 / 80 | 40 |
| t-lk | 86.1 | 1,099 | 105 ±6 | 96 | 18 | **114 ±8** | **132** | 96 | 134 / 103 | 64 |
| x1 | 87.7 | 1,687 | 165 ±12 | 152 | 23 | **174 ±14** | **199** | 98 | 204 / 163 | 97 |
| gates + det | 83.9 | 789 | 79 ±4 | 73 | 8 | 81 ±4 | 97 | 101 | 83 / 79 | 43 |
| t-lk + det | 86.1 | 1,180 | 109 ±7 | 99 | 19 | 118 ±9 | 137 | 92 | 143 / 106 | 71 |
| x1 + det (`i-det-x1`) | 87.3 | 1,813 | 173 ±12 | 159 | 30 | 189 ±15 | 217 | 96 | 220 / 170 | 106 |

(Accuracy and wall time are from these runs; on S300-1 the four re-runs are byte-identical to the stored runs, so accuracy equals the stored J1 numbers.)

Readings:
- **Energy tracks wall time, a bit sublinearly.** The GPU draws 96–111 W while answering; agents draw less on average (x1 98 W, t-lk 96 W vs P-B 111 W) because they spend time on CPU work between calls (BM25, the MiniLM cross-encoder) and on short decode-bound probes. x1 takes 2.6× P-B's wall time and 2.3× its GPU energy.
- **Per correct answer:** gates costs +3% over P-B for +6.3 points; t-lk +42% for +8.5; x1 +114% for +10.1 points. The last 1.6 points from t-lk to x1 cost +51% energy (the g5 handover and the full explore).
- **Misses cost more for agents** (x1 204 vs 163 GPU J on hits; explore path), not for one-shots; the design weighting (6.8% misses) keeps that small.
- **CPU:** attributed CPU energy is small next to the GPU (5–30 J/q). The raw package numbers (34–106 J/q) mostly reflect the package's ~46 W floor and other workers' CPU jobs during my windows, so they are an upper bound only.
- **det costs** +8% energy on x1 (+15 J/q), +4% on t-lk, ~0 on gates.

Server-log check of the `i-det-x1` v2 run (00:17–00:27 ET): 1,867 prompt-cache loads, of which 1,651 are the reset reloading itself (f_keep = f_sim = 1) and 216 are other prompts. Most of those are a question's own earlier agent turn (f_keep 1.0). A few are cached prompts with f_keep 0.25–0.4, but because det computes every prompt from 0, a cached prompt's checkpoints all lie 4 or 512 tokens before its end, never inside a shared prefix, so the new prompt still starts from 0. None of the 1,615 real calls resumed between 1 and 99 tokens, and every g5 first turn (100/100) started at 0.

The remaining theoretical gap: a cached prompt of length 513 to 512 + L that shares L ≥ 128 tokens (≥ 25% of itself) with a later prompt would hand that prompt a resume point at a position set by the other prompt's length. x1 has no prompt pair like that (shared prefixes are ≤ ~70 tokens except within an agent conversation); a variant with a long fixed instruction block reused across questions could, so re-check `det.cached` (`tools/i-detstats.js`) when wrapping something new: real calls should resume at 0 or at a large own-conversation position.
