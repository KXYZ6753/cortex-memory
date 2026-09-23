# Operations: how to run things, and what cost time

The command reference is `benchmarks/premise2/README.md`, which includes the Windows checklists for the main run and the agent run. This page adds the context around it.

## Machines

- **Mac (development):**
  - builds data, retrieval and prompts, and does grading and reports;
  - Node 26, Ollama 0.32;
  - has `gemma3:1b-it-qat` and `nomic-embed-text` for smoke tests; Gemma 4 is not installed.
- **Windows eval box (generation):**
  - Windows 11 (build 26200), RTX 5060 Ti 8 GB (driver 610.62, 180 W limit), 40 GB RAM;
  - Node 24.21, **Ollama 0.34.2**, where auto-update must stay off; the agent run refuses a different version.
- **Measured rates on the eval box:**

  | model | prefill | decode | GPU share |
  |---|---|---|---|
  | 31b | ~380 tok/s | ~3.3 tok/s | 23.5% |
  | e2b | ~9,000 tok/s | ~177 tok/s | full |

  Per query: BM25 81 ms, nomic query embedding ~32 ms (p50), dense search 52 ms, MiniLM rerank ~760 ms.

## The pipeline, end to end

1. **Mac:**
   - `npm run premise2 -- embed` (dense index, ~2 h)
   - `npm run premise2 -- prepare` (~50 min; deterministic, verified byte-identical on a rerun)
2. **Transfer:** `.data/premise2/` plus `.data/models/Xenova` went over as one zip (1.04 GB). It unpacks into the repo folder on Windows. Check it with `npm run premise2 -- verify-data`.
3. **Windows:** `npm run premise2 -- run`
   - supervised: it restarts after crashes, resumes by content-addressed keys, and holds a wake lock;
   - it runs an energy logger process (LibreHardwareMonitor web server on port 8085, plus nvidia-smi);
   - it stops at `POC2_STOP_AT` in `.env`.
4. **Copy back** `.data/premise2/` to the Mac.
5. **Mac:**
   - `npm run premise2 -- grade` (OpenRouter; judge settings in `.env`)
   - `npm run premise2 -- report`
6. **Agent arm:**
   - Windows: `npm run premise2 -- agent`
   - Mac: copy back `.data/premise2/agent/`, then `npm run premise2 -- agent-grade` and `report`

## Judges and money

- **Ollama Cloud (the account's free tier):**
  - calls serialise (concurrency 1);
  - J1 `gpt-oss:20b-cloud` runs at ~0.37 calls/s, J2 `nemotron-3-nano:30b-cloud` at ~2.7 calls/s;
  - deepseek, mistral, glm, kimi, minimax and qwen return HTTP 402 on the free tier;
  - the correct tag is `mistral-large-3:675b-cloud`, not `:cloud`.
- **OpenRouter** (used for all TEST grading):
  - `openai/gpt-oss-20b` (reasoning effort low), `nvidia/nemotron-3-nano-30b-a3b` (reasoning off), `deepseek/deepseek-v4.1-flash`;
  - 33,710 calls in 23 min at concurrency 16 cost $4.57;
  - the key lives only in `.env` as `OPENROUTER_API_KEY`, which is never committed; the judge selection is in `.env` too (`POC2_J1_PROVIDER`, `POC2_J1_MODEL`, and so on).
- **Judge settings that matter on OpenRouter:**
  - `reasoning.exclude` (otherwise reasoning leaks into the JSON and is billed);
  - `provider.sort: "throughput"` (the slowest hosts are ~40× slower; it routes to pricier hosts, so budget ~2× the token estimate);
  - a plain-format retry when a verdict fails to parse.

## Lessons that cost time (do not repeat)

- **Windows shells:** no `&&`, no inline `VAR=value`; put settings in `.env`.
- **Ollama:**
  - `truncate:true` silently halves oversize prompts; always use `truncate:false`.
  - Changing `num_ctx` forces a reload and silently changes `num_batch`, so pin both.
  - `prompt_eval_cached_count` exists only from 0.34.
  - Resident calls report `load_duration` of 2–50 ms on the eval box, but ~120 ms on the Mac's 0.32. Reload detection needs a threshold of ~1 s, not 100 ms.
  - Under `OLLAMA_MAX_LOADED_MODELS=1`, any embedding call evicts the generator.
- **EnronQA:**
  - The splits share all emails; split by mailbox.
  - Many "hard negatives" are copies of the gold (twins), so check for answer-bearing text before calling anything a distractor.
- **Scoring:** never compare a J1-only (tier B) cell against an adjudicated (tier A) reference. Use the J1 basis for both (fixed 2026-09-23).
- **Verdict dedupe:** look verdicts up by verdict key (question, references, normalised answer, judge), not by the first cell's answer key. That bug would have left E\* unselectable.
- **Fingerprints:** hashing `PREREG.md` into the resume fingerprint means a deviation-log edit blocks a resume. The agent addendum hashes only the text above `## Deviation log`.
- **Provenance gap:** the main run's `declaredServerEnv` recorded `OLLAMA_NUM_PARALLEL` and `OLLAMA_MAX_LOADED_MODELS` as null, so the harness process did not see them. The per-block `/api/ps` snapshots are the evidence that one model was resident at a time.
- **Code hygiene:** the Write tool once turned an escaped `\u0001` into a real control byte. Scan new files with `grep -nP '[\x00-\x08\x0B\x0C\x0E-\x1F]'`.
