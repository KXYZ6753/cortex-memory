# premise2

V2 of the premise benchmark. The design and every decision rule are in [PREREG.md](PREREG.md).

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

7. **Data**: copy these two folders from the Mac into the same places in the Windows checkout:
   - `.data/premise2/`
   - `.data/models/` (the reranker, for the latency sample)

   Then check the files:

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
