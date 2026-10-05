// Worker g (agent interface): support probe for Gemma 4 e2b's native function calling
// (Ollama /api/chat `tools`) and JSON-schema constrained decoding (`format`).
// Diagnostic only: the "answer" is a JSON dump of the raw responses.
import { generationOptions } from "../../ollama.js"

const TOOLS = [
    { type: "function", function: { name: "search_mailbox", description: "Search the asker's own mailbox. Returns numbered results.", parameters: { type: "object", properties: { query: { type: "string", description: "keywords" } }, required: ["query"] } } },
    { type: "function", function: { name: "read", description: "Read full emails by result number.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "integer" } } }, required: ["ids"] } } },
    { type: "function", function: { name: "answer", description: "Give the final answer.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
]

const SCHEMA = { type: "object", properties: { action: { type: "string", enum: ["search", "read", "answer"] }, query: { type: "string" }, ids: { type: "array", items: { type: "integer" } }, text: { type: "string" } }, required: ["action"] }

const brief = (data) => ({ content: data.message?.content, tool_calls: data.message?.tool_calls, error: data.error, eval: data.eval_count, prompt: data.prompt_eval_count, ms: Math.round((data.total_duration ?? 0) / 1e6), logprobs: data.logprobs ? data.logprobs.slice(0, 3) : undefined })

async function probe(ctx, record) {
    const sys = "You answer questions about the user's email archive. Use the tools: search first, then read, then answer."
    const msgs = [{ role: "system", content: sys }, { role: "user", content: `Question (asked by mailbox owner ${record.user}): ${record.question}` }]
    const opts = generationOptions({ num_predict: 120 })
    const t1 = await ctx.chatRaw({ messages: msgs, tools: TOOLS, options: opts })
    // second turn: feed back a fake tool result to see multi-turn tool handling
    let t1b = null
    const call = t1.message?.tool_calls?.[0]
    if (call) {
        const paths = await ctx.search(call.function?.arguments?.query ?? record.question, 3, record.user)
        const results = paths.map((p, i) => `[${i + 1}] ${ctx.emailOf(p).slice(0, 200).replace(/\s+/g, " ")}`).join("\n")
        t1b = await ctx.chatRaw({ messages: [...msgs, t1.message, { role: "tool", tool_name: call.function?.name, content: results }], tools: TOOLS, options: opts })
    }
    const t2 = await ctx.chatRaw({ messages: [...msgs, { role: "user", content: "Reply in JSON: {action, query|ids|text}." }], format: SCHEMA, options: opts })
    const t3 = await ctx.chatRaw({ messages: [{ role: "user", content: `Is Paris in France? Answer YES or NO.` }], options: generationOptions({ num_predict: 2 }), logprobs: true, top_logprobs: 3 })
    return { status: "ok", answer: JSON.stringify({ tools: brief(t1), toolsTurn2: t1b && brief(t1b), format: brief(t2), logprobs: brief(t3) }).slice(0, 6000) }
}

export const VARIANTS = {
    "g-probe": { version: 1, describe: "Diagnostic: tools / format / logprobs support probe (answer = raw JSON)", run: probe },
}
