# Premise study: project memory

This folder is the long-term memory of the research project behind branch `premise-v2`: what the study is, why it is built the way it is, what was decided (and by whom), what the results are, and what is left.

**Start here, then read the file you need.**

| file | what it holds |
|---|---|
| [abstract.md](abstract.md) | the accepted abstract, verbatim, and how each of its promises maps to what was measured |
| [project-history.md](project-history.md) | timeline from the original plan through V1, V2, grading and the agent arm; every decision, with its reason |
| [study-design.md](study-design.md) | the V2 design in one place: data, models, factors, contexts, runtime, queue, grading, statistics |
| [results.md](results.md) | V2 results with the exact numbers, their interpretation and caveats; the V1 pilot reanalysis |
| [agent-arm.md](agent-arm.md) | the agent extension (model-driven search, built and pre-registered but not yet run) and the approved-but-not-built index-factor extension |
| [operations.md](operations.md) | how to run everything on the Mac and the Windows box, costs, environment facts, and the lessons that cost time |
| [paper-notes.md](paper-notes.md) | what the paper can claim, the figures and tables to make, limitations, and how the results line up with the abstract |
| [open-items.md](open-items.md) | what remains, in priority order |
| [research-plan-original.md](research-plan-original.md) | the original research plan from 1 September 2026, verbatim (partly superseded; see project-history.md) |

## The study in five sentences

- **The question.** The paper *Does Retrieval Engineering Offset Model Scale? A Controlled Study on Email Question Answering* (Kerem Cakmak, Suleyman Vural) asks whether better email representation and retrieval can buy the accuracy that would otherwise need a larger generator.
- **The setup.** It is tested on EnronQA with Gemma models from 1B to 31B, run locally through Ollama on a Windows box with an 8 GB RTX 5060 Ti.
- **Deadline.** The paper is due **Monday 5 October 2026**.
- **The main result (V2, 27,644 answers, graded by three judges).** The scale gap is small when the model is handed the right email: e2b scores 96.3%, the 31b 98.2%. Retrieval failure costs both models far more, 6–8 points, and the tested retrieval engineering (k, ordering, representation) did not close the gap. A 2B model with perfect retrieval still beats the 31B model with real BM25 retrieval, 96.3 vs 91.8.
- **Next.** An agent arm, in which each model writes its own search queries, is built and pre-registered and waits for a Windows run. A further index-factor extension is designed but not built.

## Where the code and data live

- Code: `benchmarks/premise2/`. Its `README.md` is the command reference; `PREREG.md` and `PREREG-AGENT.md` are the pre-registrations.
- Tests: `tests/premise2/`, run with `npm run test:premise2` (252 tests).
- Results: `benchmarks/results/premise2/`, holding `report.md`, `report.json` and `cases.csv` (per-answer scores), and `benchmarks/results/v1-pilot-reanalysis.md`.
- Data: `.data/premise2/`, gitignored and about 1.5 GB. It holds the parquet files, BM25 index, dense vectors, prompts, answers, verdicts and energy logs. It is never committed, so back it up separately.
- V1 pilot: `benchmarks/premiseBenchmark.js` (branch `poc-premise`). Its raw outputs were kept outside the repo.
