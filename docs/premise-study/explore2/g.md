# Worker g: the agent interface (exploration phase 2, round 2)

Prefix `g`. Code: `benchmarks/premise2/explore2/variants/g-*.js`, tools `benchmarks/premise2/explore2/tools/g-*.js`.
Mission: close the agentic gap for e2b (frozen plain-text agent ≈37 in pool, 40.0 TEST; 31b frozen agent 75.8 TEST; gates 85.1 on S300-2) by changing the interface: Gemma 4 native function calling / JSON-schema constrained decoding, a tool set designed for a 2B model, cheap reading, few rounds, sandwich final answer.

## 1. Support probe (`g-probe`, S100-0, 5 questions)

- **Native tools work** (Ollama `/api/chat` `tools`, gemma4:e2b-it-qat): 5/5 first turns returned a well-formed `tool_calls` entry (search_mailbox with a sensible keyword query), 5/5 second turns (after a `role: tool` result) returned a well-formed `read` call. 200–400 ms per tool turn (15–22 output tokens).
- **JSON-schema `format` works**: 5/5 valid JSON objects matching the schema.
- **logprobs work** (`logprobs: true, top_logprobs: n`): per-token logprobs and alternatives returned.
- Observed reflex: after a search, e2b calls `read([1,2,3])` (opens the top results) rather than answering from previews. Good for reading; a risk when the full emails are already shown.
