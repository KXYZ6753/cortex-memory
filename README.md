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
- [Node.js](https://nodejs.org/) 22+
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
