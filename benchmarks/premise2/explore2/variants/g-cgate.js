// Worker g: confidence-gated agent (suggested by the lead from worker n's gate).
// gates' first answer through ctx.chatRaw with logprobs (n-conf.js lpCall); if it is
// confident (mean token logprob >= tau, no hedge, no abstention) keep gates' exact
// answer (with gates' abstention retry semantics); otherwise run the g5 pure agent
// (native tools, own query, own read/answer decisions) and use its answer.
// Offline simulation from stored n-g5 (unsure flag) + g5 answers, exact under e2b's
// determinism: S300-2 86.7 (gates 85.1), S300-1 85.7 (gates 83.9).
import { isAbstain } from "../../prompts.js"
import { sandwichPrompt } from "../../explore/variants.js"
import { lpCall, gatesContexts, meanLp, HEDGE } from "./n-conf.js"
import { VARIANTS as G } from "./g-agent.js"

async function confGatedAgent(ctx, record, { tau = -0.1, agent = "g5" } = {}) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const ask = (paths) => lpCall(ctx, { prompt: sandwichPrompt(record.question, paths.map((path) => ctx.emailOf(path))) })
    const first = await ask(contexts[0])
    const mean = meanLp(first)
    const unsure = isAbstain(first.answer) || HEDGE.test(first.answer) || mean < tau || (first.status !== "ok" && first.status !== "output_limit")
    const diag = { firstMean: Math.round(mean * 1000) / 1000, unsure, gatesAnswer: first.answer, switched }
    if (!unsure) return { status: first.status, answer: first.answer, contextPaths: contexts[0], readPaths: contexts[0], step: "gates", ...diag }
    const result = await G[agent].run(ctx, record)
    return { ...result, step: agent, ...diag }
}

export const VARIANTS = {
    "g10": { version: 1, describe: "Confidence-gated agent: gates (logprob gate, tau -0.1, hedge/abstain = unsure); unsure questions are answered by the g5 native-tools agent", run: (ctx, record) => confGatedAgent(ctx, record) },
}
