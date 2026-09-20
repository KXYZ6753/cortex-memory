# Cortex Memory

A self-hosted, AI-powered personal memory and productivity system — a unified context layer for your LLM workflows.

Cortex Memory aims to provide a universal connector foundation and all in one ecosystem for knowledge about you, such as emails, slack, notifications and 3rd party connectors for supporting anything [coming soon].
# TODO LIST:
* API Endpoints
  * [ ] createEntry
  * [ ] search
  * [ ] listEntrySources
  * [ ] Update memory
* MCP Server that uses API
  * [ ] createEntry
  * [ ] search
  * [ ] listEntrySources
  * [ ] Update memory
  * [ ] Add Quick note -> Act as a persistent LLM memory 
* index.js runtime
* Getting Started CLI
* Read me and documentation
  * update readme.md with instructions to change .env and how to setup .env.example
  * rest of documentation
* npm tests

## How it works

// todo: do here //

## Tech stack

- **Node.js** (ES modules) + **Express**
- **PostgreSQL** + **pgvector** (via **Prisma**)
- **Ollama** for local LLM summarization, extraction, and embeddings
  - **nomic-embed-text** for embeddings
  - **gemma4:e4b** for summarization and extraction
- **Docker Compose** for the database and migrations

## Getting started

### Prerequisites

- [Docker](https://www.docker.com/) + Docker Compose
- [Node.js](https://nodejs.org/) 22.5+
- [Ollama](https://ollama.com)

### Setup // todo: change after moving production into docker env //

```bash
# 1. Install dependencies
npm install

# 2. Pull required models
ollama pull nomic-embed-text
ollama pull gemma4:e4b

# 3. Start Postgres (pgvector) and run migrations
docker compose up -d

# 4. Make a copy of .env.example and name it ".env". After it follow the directions there.

# 5. Run
node src/index.js
```

## Search

The fast default is content-embedding search:

```bash
node tests/searchTest.js "When did Caroline send the original email?" 10 embedding
```

For lexical BM25 or the higher-accuracy BM25 + embedding search, build the
local search index after importing entries:

```bash
npm run index:bm25
node tests/searchTest.js "When did Caroline send the original email?" 10 word
node tests/searchTest.js "When did Caroline send the original email?" 10 hybrid
```

Run a deterministic benchmark with:

```bash
npm run benchmark:retrieval -- benchmarks/enronqaCases.json hybrid 500 benchmarks/hybridResults.json 42 100
```

Rerankers are benchmark-only experiments because they were slower and less
accurate than hybrid retrieval on EnronQA:

```bash
npm run benchmark:reranker -- minilm benchmarks/enronqaCases.json 50 42 20
npm run benchmark:reranker -- qwen benchmarks/enronqaCases.json 30 42 5
```

## Premise benchmark (research)

Before the full 14-cell study, `benchmarks/premiseBenchmark.js` answers the two
questions the paper's claim depends on:

- **Kill test A** — hand both generators the gold email (oracle retrieval). Does the
  large model actually beat the small one? No gap means retrieval engineering has
  nothing to offset.
- **Kill test B** — give the small model the gold email alone, then the gold email
  plus hard negatives (lexically similar wrong emails) and plus random emails. If
  correctness only drops on hard negatives, the mechanism is retrieval *precision*.
  If it drops on both, the story is context dilution instead.

Phase 1 (both kill tests, the no-retrieval floor, the representation arm) needs only
Ollama and network access to HuggingFace — no Postgres, no pgvector, no BM25 index.
Phase 2 adds a real retrieval arm through `src/search.js` and is skipped with a
reason when that stack is unavailable.

All settings come from `.env`, never from inline environment variables, so the same
commands work on Windows, macOS and Linux. Run these one at a time, in order.

Offline checks for the statistics and text transforms — no models, no network:

```bash
npm run test:premise
```

Project the run before committing a night to it. Fits a cost model from 8 calls per
model and prints a per-cell projection against `POC_DEADLINE_HOURS`:

```bash
npm run benchmark:premise -- probe
```

Smoke gate — the full pipeline on 3 questions, finishes in minutes. Set
`POC_VALIDATION_N=4` in `.env` first so it stays quick:

```bash
npm run benchmark:premise -- all 3
```

The real run. Resumable: rerun the identical command after any interruption.

```bash
npm run benchmark:premise -- all 100
```

Generation and grading can be separated, so a judge outage never costs a night:

```bash
npm run benchmark:premise -- generate 100
```

```bash
npm run benchmark:premise -- judge 100
```

Read `premiseVerdict.decision` in `benchmarks/premiseResults.json` first: `GO`,
`NO_GAP`, `GAP_BUT_NO_MECHANISM`, `UNDERPOWERED` or `INCONCLUSIVE`.

### Windows notes

Two shell habits from the examples above do **not** carry over:

- `VAR=value npm run ...` sets nothing in cmd or PowerShell. Use `.env`.
- `a && b` is a syntax error in Windows PowerShell 5.1, the default shell. Run each
  command on its own line, or use cmd, or install PowerShell 7 where `&&` works.

A `.env` for the eval box looks like this:

```ini
POC_MODEL_SMALL=gemma4:e2b
POC_MODEL_LARGE=gemma4:31b-it-qat
POC_JUDGE_MODEL=gpt-oss:20b-cloud
POC_DEADLINE_HOURS=8
POC_VALIDATION_N=60
```

Key settings (all optional, all via `.env` or the environment):

| Variable | Default | Purpose |
|---|---|---|
| `POC_MODEL_SMALL` / `POC_MODEL_LARGE` | `gemma4:e2b` / `gemma4:31b-it-qat` | the two generators under test |
| `POC_MODEL_LARGE_ALT` + `POC_PROBE_ALT=true` | `gemma4:31b-nvfp4` | probe a second quantisation and print the speed-up |
| `POC_JUDGE_MODEL` | `gpt-oss:20b-cloud` | grader; must not be a model under test |
| `POC_JUDGE_PROVIDER` | `ollama` | or `openrouter`, with `OPENROUTER_API_KEY` |
| `POC_DEADLINE_HOURS` | `8` | cells are trimmed in priority order to fit; `oracle-large` is never trimmed |
| `POC_ENERGY` | `auto` | GPU power via `nvidia-smi`; non-fatal when missing |
| `POC_QUESTION_FIELD` | `questions` | `rephrased_questions` avoids gold-email name leakage into the query |
| `POC_POOL_SIZE` | `2000` | emails fetched from HuggingFace; also bounds hard-negative difficulty |

The judge is validated without any human labelling: the dataset ships
`incorrect_answers` and `alternate_answers`, so known-right and known-wrong
candidates are mixed blind into the same shuffled grading stream and the report
gives the judge's recall, specificity and false-correct rate. If recall drops below
0.80 or the false-correct rate exceeds 0.15, the verdict becomes `INCONCLUSIVE`
regardless of how large the measured gap looks.

Energy caveat: on an 8 GB card a 31b model runs mostly on CPU, so GPU-only joules
undercount it badly and the ratio can even invert. `wallSeconds` is the valid cost
metric here; whole-system wall power is required before any energy claim.
