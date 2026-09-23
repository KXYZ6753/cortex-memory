# Open items (as of 2026-09-23)

In priority order. The paper is due Monday 5 October 2026.

1. **Decide whether the agent arm runs with or without the index factor.**
   - The base agent arm is ready to run now: `npm run premise2 -- agent` on Windows, ~10–18 h.
   - The index-factor extension is approved but not built: about half a day of building and validating on the Mac, then one run of ~18 h.
   - If time is tight, run the base arm now and add the index arms as a second session. Both keep their answers in the same agent store.
2. **If the index factor goes ahead, before building:**
   - run the design critique that was cancelled (`agent-arm.md`, last bullet);
   - validate the in-process nomic query embedder against Ollama's;
   - add the Family B hypotheses to `PREREG-AGENT.md`;
   - commit before any episode runs.
3. **Run the agent arm on Windows** (checklist in `benchmarks/premise2/README.md`, "Agent arm"). Then copy back `.data/premise2/agent/` and run `agent-grade` (under $1) and `report` on the Mac.
4. **Paper figures and tables** from `benchmarks/results/premise2/report.json` and `cases.csv`; the list is in `paper-notes.md`.
5. **Write the paper:** method and results first, then intro and related work (RAG vs scale, energy-aware NLP, enterprise-email QA, "compression helps weaker readers", arXiv 2606.21807).
6. **Reproducibility packaging:**
   - pin everything (already in the manifests and run states);
   - describe the clean-machine path;
   - decide whether to publish `cases.csv` (it holds scores, not email text or answers).
7. **Back up `.data/premise2/`** (gitignored; about 1.5 GB plus the answers and verdicts). The results cannot be regenerated without a new 13-hour run.

## Known caveats to keep in mind

- **Server settings:** the main run's provenance does not show the Ollama server settings (`declaredServerEnv` is null). The one-model-at-a-time evidence comes from the per-block `/api/ps` snapshots.
- **Energy:** the energy log is complete. It holds 49,152 CPU-package samples at 1 Hz (the whole ~13.6 h run) and 456,716 GPU samples at 10 Hz (`report.json`, `energy.sources`).
- **Scoring bases:** tier-B cells are J1-only. Compare them only on the J1 basis; the report's exploratory table says which basis each delta uses.
