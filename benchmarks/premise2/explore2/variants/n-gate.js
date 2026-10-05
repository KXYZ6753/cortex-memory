// New-methods scientist (prefix n): confidence-gated perturbation.
// Notes: docs/premise-study/explore2/n.md
//
// Observation (n-lp0 on S300-2 and S300-1): gates' mean token logprob is calibrated
// between questions (AUC ~0.7) but useless for picking between two answers to the same
// question. Hits that gates answers confidently are ~95% right, so any change to their
// prompt (a swapped email, another prompt) can only lose on average; unsure hits are
// ~70% right and unsure misses mostly lack the gold, so a change has positive expected
// value there. So: answer with gates; only when that answer is unsure (mean token
// logprob < tau, a hedge, or an abstention) answer instead with a retrieval-improved
// pipeline (r5 / s1), whose answer replaces gates' (no confidence comparison).

import { isAbstain } from "../../prompts.js"
import { sandwichPrompt } from "../../explore/variants.js"
import { lpCall, gatesContexts, meanLp, HEDGE } from "./n-conf.js"
import { rerankGate } from "./r-rerank.js"
import { stacked } from "./s-stack.js"

const emailsOf = (ctx, paths) => paths.map((path) => ctx.emailOf(path))

async function gatedSwap(ctx, record, { tau = -0.1, fallback = "r5" } = {}) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const ask = (paths) => lpCall(ctx, { prompt: sandwichPrompt(record.question, emailsOf(ctx, paths)) })
    const first = await ask(contexts[0])
    const mean = meanLp(first)
    const unsure = isAbstain(first.answer) || HEDGE.test(first.answer) || mean < tau || (first.status !== "ok" && first.status !== "output_limit")
    const diag = { firstMean: Math.round(mean * 1000) / 1000, unsure, gatesAnswer: first.answer }
    // r5 on a switched question is gates' own pipeline (no swap), so keep gates' answer
    // (with gates' abstention retry).
    if (!unsure || (fallback === "r5" && switched)) {
        let result = first
        let used = 1
        while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
            result = await ask(contexts[used])
            used++
        }
        return { status: result.status, answer: result.answer, contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used, step: unsure ? "gates-switched" : "gates", ...diag }
    }
    const alt = fallback === "s1" ? await stacked(ctx, record, { dedup: true }) : await rerankGate(ctx, record, { mode: "gates", margin: -Infinity })
    return { ...alt, step: fallback, ...diag }
}

export const VARIANTS = {
    "n-g5": { version: 1, describe: "gates; when its answer is unsure (mean token logprob < -0.1, hedge or abstention) answer with r5 instead (CE best mailbox email in slot 5)", run: (ctx, record) => gatedSwap(ctx, record, { tau: -0.1, fallback: "r5" }) },
    "n-g6": { version: 1, describe: "gates; when its answer is unsure (mean token logprob < -0.1, hedge or abstention) answer with s1 instead (r5 swap + mailbox dedup)", run: (ctx, record) => gatedSwap(ctx, record, { tau: -0.1, fallback: "s1" }) },
}
