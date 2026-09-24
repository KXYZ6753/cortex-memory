# premise2

V2 of the premise benchmark. The design and every decision rule are in [PREREG.md](PREREG.md).

## Exploratory agent word-overlap arm (September 24)

This separate arm is frozen in [PREREG-AGENT-OVERLAP.md](PREREG-AGENT-OVERLAP.md).
It changes only agent SEARCH ranking; existing BM25 agent and one-shot answers
are reused. Windows needs the completed `.data/premise2/` including
`agent/emails.sqlite` and the exact frozen BM25 `corpus.sqlite`. Keep the GPU
idle before launching. The preflight rejects a changed corpus, mismatched
ranking, over 1.5 GB RSS, or search p95 over 500 ms.

```powershell
git fetch origin
git switch codex/overnight-word-overlap
git pull --ff-only origin codex/overnight-word-overlap
npm install
npm run premise2 -- agent-overlap-index-check
npm run premise2 -- agent-overlap
```

The controller runs small 600, mid 600, large core 200, large 600, then tiny
600. It saves each episode and stops generation by 6 PM Eastern daylight time
on September 24. Restart the same `agent-overlap` command after interruption;
completed episodes are skipped. In a second PowerShell window:

```powershell
npm run premise2 -- agent-overlap-status
```

For incremental Mac grading, copy the Windows
`.data/premise2/agent-overlap-run/` snapshot to the same relative Mac folder.
Copy the **latest** Windows `agent/answers.jsonl`, `agent/verdicts.jsonl`, and
`agent/state.json` as well, since the earlier Mac snapshot may be stale. Keep
Mac `.data/premise2/agent-overlap-grading/` outside the replaced snapshot.
To finish the already completed one-shot comparison, also copy Windows
`.data/premise2/simple-run/` to the Mac. Then run:

```sh
npm run premise2 -- simple-grade
npm run premise2 -- simple-report
npm run premise2 -- agent-overlap-grade
npm run premise2 -- agent-overlap-report
```

The two reports appear in `benchmarks/results/premise2/`. OpenRouter grading
requires the explicit J1, J2, and adjudicator settings in `.env`. Saved verdicts
reuse identical answer/reference keys; adjudication also binds shown evidence.
Grade copied snapshots, not files being written on Windows. Partial rows are
descriptive until fully generated and graded.

## Exploratory overnight word-overlap extension (September 24)

This extension is separate from the frozen V2 and agent manifests. It adds only
`X-overlap-k5`; it does not rerun BM25, dense, hybrid, or completed agent answers.
It ranks the same 103,368-email corpus as BM25 by distinct question-word overlap
in subject, sender, recipients, and body. It then chooses five emails in score/path
order under the shared prompt cap, reserving room for five; remaining zero-score
emails follow path order. The report labels the comparison exploratory.

1. On the Mac checkout of this branch, run `npm run premise2 -- simple-prepare`.
   This verifies the pinned corpus and freezes 955 prompts. Copy **only**
   `.data/premise2/simple-run/manifest.json` and `items.jsonl` to the same relative
   folder on Windows. Do not copy earlier `simple-preflight-*` folders.
2. On Windows, stop the currently running agent process before switching to this
   branch. Leave `.data/premise2/agent` and the completed V2 data in place. Run
   `npm run premise2 -- overnight`. The controller refuses another detected
   generator, keeps Windows awake, and runs small 600, mid 600, large core 200,
   unfinished agent episodes until noon, large 600, then small/mid 955. It stops
   generation at **6 PM Eastern daylight time, September 24**. The same command
   resumes after an interruption; after a reboot, start it again manually.
3. Check Windows progress with `npm run premise2 -- overnight-status`. The copied
   Windows snapshot can be graded on the Mac while generation continues. Copy the
   Windows `simple-run` directory over the Mac snapshot, then run
   `npm run premise2 -- simple-grade` and `npm run premise2 -- simple-report`.
   Repeat after later snapshots. Saved Mac verdicts are in
   `.data/premise2/simple-grading`, outside the copied folder, so completed judge
   calls are reused. Grading requires the study's explicit OpenRouter judge models
   and key; missing settings fail before any verdict is written.

`simple-report.md` and `simple-report.json` appear in
`benchmarks/results/premise2`. Partial rows show generated and graded counts;
intervals appear only for fully graded checkpoints. The selected 200-question
core is enriched for BM25 misses and is weighted to the selected 600-question
population when complete. Finish grading and paper updates by **7 PM Eastern
daylight time, September 24**.

The work is split across two machines:

- **Mac** (no generation): data, retrieval, prompts, and afterwards grading and the report.
- **Windows eval box**: one continuous, unattended generation run.

## Commands

```
npm run premise2 -- verify-data   check the three parquet files against their pinned sha256
npm run premise2 -- embed         dense index (Mac, ~45 min)
npm run premise2 -- prepare       pools, retrieval, contexts, prompts (Mac)
npm run premise2 -- run           the supervised generation run (Windows)
npm run premise2 -- status        progress per cell and model
npm run premise2 -- grade         TEST grading after the run (J1, J2, adjudication)
npm run premise2 -- report        writes benchmarks/results/premise2/
npm run premise2 -- agent         the agent-arm run (Windows; see below)
npm run premise2 -- agent-status  agent-arm progress per arm
npm run premise2 -- agent-grade   agent-arm grading after that run (Mac)
npm run test:premise2             unit tests
```

Settings come from `.env` in the repo root, or from the environment:

| variable | meaning |
|---|---|
| `POC2_STOP_AT` | local time by which the run must stop, e.g. `2026-09-23T18:00` |
| `POC2_LHM_URL` | LibreHardwareMonitor JSON (default `http://localhost:8085/data.json`) |
| `POC2_ENERGY` | `off` disables the energy logger |
| `POC2_DATA_DIR` | data directory (default `.data/premise2`) |
| `OLLAMA_URL` | default `http://localhost:11434` |
| `POC2_SMOKE_MODEL`, `POC2_MAX_ITEMS` | smoke run only: every model is replaced by one small model, and each cell is cut to N items |

## Windows run: checklist

Do these once, before the run. Type each command on its own line in PowerShell, in the repo folder.

1. **Code**

   ```
   git fetch
   git checkout premise-v2
   git pull
   npm install
   node --version
   ```

   Node must be 22.13 or newer (the run uses `node:sqlite`).

2. **Ollama**: version 0.34 or newer (`ollama --version`). Turn off automatic updates in the Ollama app settings, so the version cannot change mid-run.

3. **Models** (`gemma4:31b-it-qat` and `gemma4:e2b` are already installed):

   ```
   ollama pull gemma4:e2b-it-qat
   ollama pull gemma4:e4b-it-qat
   ollama pull gemma3:1b-it-qat
   ollama pull nomic-embed-text
   ollama pull gpt-oss:20b-cloud
   ollama pull nemotron-3-nano:30b-cloud
   ollama signin
   ollama list
   ```

   The two `-cloud` pulls only register the judges; they download nothing large. `ollama signin` makes them work. The run needs only J1 (`gpt-oss:20b-cloud`), for DEV grading.

4. **Ollama server settings**: run these two commands, then quit Ollama from the tray icon and start it again:

   ```
   setx OLLAMA_NUM_PARALLEL 1
   setx OLLAMA_MAX_LOADED_MODELS 1
   ```

   Open a **new** PowerShell window afterwards, so the run records the settings.

5. **Energy**:
   1. Start LibreHardwareMonitor as administrator.
   2. Enable Options → Remote Web Server → Run (port 8085).
   3. Check that http://localhost:8085/data.json opens in a browser and that the CPU shows a "Package" power value.
   4. Leave it running.

6. **Keep the PC up**:
   - Settings → Windows Update → pause updates for 1 week.
   - Settings → System → Power → sleep: never (when plugged in).

   The run also holds a wake lock.

7. **Data**: copy `premise2-transfer.zip` (about 1.3 GB) from the Mac to the repo folder on Windows. On the Mac it is at `.data/premise2-transfer.zip`. Extract it there with "Extract All…", choosing the repo folder itself as the destination; it creates `.data\premise2\` and `.data\models\`. Then check the files:

   ```
   npm run premise2 -- verify-data
   ```

   It must print three `ok` lines.

8. **Stop time**: add a line like this to `.env` in the repo root (create the file if there is none), set to when you need the PC back:

   ```
   POC2_STOP_AT=2026-09-23T18:00
   ```

## Windows run: start

```
npm run premise2 -- run
```

That is the only command. It:

- runs the probe (about 45 min), then the whole queue;
- needs about 16–17 h for everything except the optional 31b secondaries, by V1's measured speeds. Those secondaries (up to about 6 h more) are admitted only if they fit before the stop time;
- if the stop time cuts it, the rest can be finished later with the same command. The confirmatory cells come first; the e2b grid and exploratory cells come last;
- restarts itself after a crash, and resumes where it stopped;
- stops cleanly at `POC2_STOP_AT`.

**Checking progress.** In a second PowerShell window:

```
npm run premise2 -- status
```

**Checking the energy logger.** After about a minute of running, this must print lines:

```
Select-String -Path .data\premise2\energy.jsonl -Pattern '"src":"cpu"' | Select-Object -First 2
```

If it prints nothing, LibreHardwareMonitor is not reachable. The run continues, but CPU energy will be missing (GPU energy from `nvidia-smi` is still recorded).

**If the PC reboots or you stop the run** (Ctrl+C), start the same command again. Nothing that finished is regenerated.

**When it stops**, copy `.data/premise2/` back to the Mac. The generated files are:

- `answers.jsonl`
- `verdicts.jsonl`
- `run-state.json`
- `markers.jsonl`
- `energy.jsonl`
- `latency.json`

Paste the last lines of the terminal output, including the `[run] stopped:` line, into the chat.

## Judges and the free tier

- **Tier status.** On Ollama's free tier, cloud calls run one at a time: J1 manages about 0.37 calls/s, J2 about 2.7/s. The paid-tier models (`deepseek-v4-flash`, `mistral-large-3`) return HTTP 402.
- **Adjudicator.** The chain is in PREREG §6. On the free tier it falls back to `nemotron-3-super:cloud`, and the report flags that.
- **Usage limits.** When a limit is hit, grading pauses and retries every 10 minutes. Nothing is lost; rerun `grade` to continue.
- **OpenRouter.** It can replace any judge: set `POC2_J2_PROVIDER=openrouter`, `POC2_J2_MODEL=<model id>` and `OPENROUTER_API_KEY` (the same pattern works for `POC2_ADJ_*`). A switch creates new verdict keys, so the affected contrast is re-judged in full rather than mixed.

## Agent arm (PREREG-AGENT.md)

A second, separate Windows run. Each model drives retrieval itself in a loop of up to 5 SEARCH/OPEN rounds over the same BM25 index, on the 600 questions the 31b answered in the main run. It never touches the main run's files; everything it writes goes to `.data\premise2\agent\`.

**Before starting.** Nothing new needs copying from the Mac. The corpus, BM25 index, pools and run state are already in `.data\premise2\`, and the question order (`agent-items.json`) is committed.

1. Update the code:

   ```
   git pull
   npm install
   ```

2. Keep **the same Ollama version (0.34.2)** and the same models as the main run. The run checks both and refuses to start if either changed. If Ollama auto-updated, reinstall 0.34.2.
3. Start LibreHardwareMonitor again (as administrator, web server on) and keep sleep and Windows Update paused, as for the main run.
4. In `.env`, set the stop time to about 18 hours from the start, for example:

   ```
   POC2_STOP_AT=2026-09-24T18:00
   ```

**Start.**

```
npm run premise2 -- agent
```

The first start builds `.data\premise2\agent\emails.sqlite` from the parquet (about a minute) and runs a short determinism pilot. Then it works through the queue, confirmatory arms first:

| order | arm | estimated time |
|---|---|---|
| 1 | e2b agent | 10–25 min |
| 2 | 31b agent | 5–9 h |
| 3 | e4b agent | 15–35 min |
| 4 | 1b agent | 10–40 min |
| 5 | e2b raw-question control | ~15 min |
| 6 | e2b rewording control | ~15 min |
| 7 | e2b thinking | 1.5–6 h |
| 8 | e4b thinking | 2.5–10 h |

The thinking arms are last and exploratory, so if the stop time cuts them, that is fine. It restarts itself after a crash, and rerunning the same command resumes without redoing anything.

**Checking progress.** In a second window:

```
npm run premise2 -- agent-status
```

After about 20 minutes the e2b line should show a few hundred episodes, 1–4 rounds on average, and protocol errors well under 1 per episode. Protocol errors near 1 per episode would mean the model is not following the SEARCH/OPEN/ANSWER format; paste the status output into the chat if that happens.

**When it stops.** Copy the folder `.data\premise2\agent\` back to the Mac, into `.data/premise2/agent/`. You can skip `emails.sqlite` (250 MB); the Mac can rebuild it. Then paste the last terminal lines into the chat.

**On the Mac afterwards:**

```
npm run premise2 -- agent-grade
npm run premise2 -- report
```

`agent-grade` costs well under $1 of OpenRouter credit. The report adds an "Agent arm" section to `benchmarks/results/premise2/report.md`.

## Index factor in the agent arm (PREREG-AGENT-INDEX.md)

The extension adds index-side preprocessing variants (`indexes.js`) and runs the agent on BM25, the DEV-chosen new index, dense and RRF-60, plus rephrased-question and 2-round arms. Episodes the original agent queue already ran (for example Stage A below) keep their keys and are not rerun.

**1. Mac: build the variant indexes and choose the new index on DEV.**

```
npm run premise2 -- index-build
npm run premise2 -- index-eval
```

`index-build` takes a few minutes and writes `corpus-r1.sqlite`, `corpus-msg.sqlite` and `corpus-latest.sqlite` next to `corpus.sqlite`. `index-eval` (about 10–15 minutes) writes `benchmarks/results/premise2/index-eval.md` and `.json` and prints the DEV choice. The choice is then written into `PREREG-AGENT-INDEX.md` and `AGENT_NEW_INDEX` in `cells.js`, and committed, before any extension episode runs; the run refuses otherwise.

**2. Mac: smoke the whole queue with the 1b model**, in a separate agent directory so nothing mixes with real episodes:

```
POC2_SMOKE_MODEL=gemma3:1b-it-qat POC2_MAX_ITEMS=2 POC2_AGENT_DIR=.data/premise2/agent-smoke POC2_STOP_AT=2026-12-31T00:00 npm run premise2 -- agent-once
```

**3. Windows: Stage B.** When the Stage A run has stopped at its stop time:

1. `git fetch`, then `git checkout claude/project-context-research-1xf86y`, then `git pull` and `npm install`.
2. `ollama pull nomic-embed-text`. Its digest in `ollama list` should equal the Mac's.
3. Check that `.data\premise2\` holds `dense.f32`, `dense-docs.json` and `retrieval.jsonl`. If any is missing, copy it from the Mac's `.data/premise2/`.
4. `npm run premise2 -- index-build` (a few minutes).
5. Set the night's stop time in `.env`, for example `POC2_STOP_AT=2026-09-24T07:00`.
6. `npm run premise2 -- agent`

The start prints a dense preflight line (top-10 overlap with the main study's dense lists; it must be at least 90%). After about 20 minutes, `npm run premise2 -- agent-status` should show the Stage A arms complete and the new e2b arms filling.
