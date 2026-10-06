// Worker z: the champion x1 with a new reading method on its unsure half (real, non-replay).
// See docs/premise-study/explore2/z.md.
//
// x1 is run unchanged (variants/x-agent.js) through a ctx wrapper. x1 makes its final
// reading calls through ctx.generate with gates' sandwich prompt in exactly the places
// where it is NOT confident: the g5 handover's final answer (commit & unsure answer) and
// the explore steps' answer (no YES in W0). Its confident commit answer goes through
// chatRaw (logprobs) and is untouched, as are the YES/NO probes, picks, plans and the g5
// tool turns. The wrapper replaces only those sandwich-prompt reading calls:
//
//   z-thx  thinking mode (think: true) on the same prompt, num_predict 1024 for thinking
//          and answer; if the budget runs out (no answer), the normal no-think call.
import { VARIANTS as X } from "./x-agent.js"
import { generationOptions } from "../../ollama.js"

const SANDWICH_HEAD = "You answer questions about a person's email archive using only the emails below."

function thinkingCtx(ctx, { budget = 1024 } = {}) {
    const stats = { reads: 0, thinkMs: 0, thinkChars: 0, budgetOut: 0 }
    const wrapped = Object.create(ctx)
    wrapped.generate = async (args) => {
        if (typeof args.prompt !== "string" || !args.prompt.startsWith(SANDWICH_HEAD)) return ctx.generate(args)
        stats.reads++
        const started = performance.now()
        const data = await ctx.chatRaw({ messages: [{ role: "user", content: args.prompt }], think: true, truncate: false, options: generationOptions({ num_predict: budget }) })
        stats.thinkMs += Math.round(performance.now() - started)
        stats.thinkChars += String(data.message?.thinking ?? "").length
        const answer = String(data.message?.content ?? "").trim()
        if (data.error || !answer) { stats.budgetOut++; return ctx.generate(args) }
        return { status: "ok", answer }
    }
    return { wrapped, stats }
}

async function x1Thinking(ctx, record, opts) {
    const { wrapped, stats } = thinkingCtx(ctx, opts)
    const result = await X.x1.run(wrapped, record)
    return { ...result, z: stats }
}

export const VARIANTS = {
    "z-thx": { version: 1, describe: "x1 with thinking mode (num_predict 1024; no-think fallback) on its unsure reading calls only: the g5 handover's final answer and the explore answer; confident commits unchanged", run: (ctx, record) => x1Thinking(ctx, record) },
}
