// Lead's stacks (prefix s): combine the phase-2 levers that act on different
// failure modes.
//   swap (r5)      when the gate does not switch, the best cross-encoder email of the
//                  asker's mailbox BM25 top 30 not already shown replaces global #5
//   dedup (o11)    near-duplicate emails in the mailbox context are collapsed and the
//                  freed slots refilled from the header-ranked mailbox list
//   rulesLast (o4) question, emails, rules, question (instead of the sandwich prompt)
// Everything else is gates: global top 5 / header-reranked mailbox top 5, the gate
// on the global top 1, one retry on the other context after an exact abstention.

import { join } from "node:path"
import { loadReranker, rerankText } from "../../rerank.js"
import { sandwichPrompt, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { dedupContext, rulesLastPrompt } from "./o-reading.js"

const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))

export async function stacked(ctx, record, { swap = true, dedup = false, rulesLast = false, depth = 30 } = {}) {
    const question = record.question
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = (await ctx.search(question, depth, record.user)).slice(0, depth)
    const mailboxOrdered = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    let mailbox = mailboxOrdered.slice(0, 5)
    if (dedup) mailbox = dedupContext(mailbox, ctx, mailboxOrdered)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    let globalCtx = global
    let swapped = false
    if (swap && !switched) {
        const model = await reranker(ctx)
        const candidates = mailboxRanked.filter((path) => !global.includes(path))
        if (candidates.length) {
            const scores = await model.score(question, candidates.map((path) => rerankText(ctx.emailOf(path))))
            const best = candidates[scores.indexOf(Math.max(...scores))]
            globalCtx = [...global.slice(0, 4), best]
            swapped = true
        }
    }
    const contexts = switched ? [mailbox, globalCtx] : [globalCtx, mailbox]
    const prompt = (paths) => (rulesLast ? rulesLastPrompt : sandwichPrompt)(question, paths.map((path) => ctx.emailOf(path)))
    let result = await ctx.generate({ prompt: prompt(contexts[0]) })
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ctx.generate({ prompt: prompt(contexts[used]) })
        used++
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, swapped, used }
}

export const VARIANTS = {
    s1: { version: 1, describe: "r5 swap + mailbox-context dedup (o11), sandwich prompt", run: (ctx, record) => stacked(ctx, record, { dedup: true }) },
    s2: { version: 1, describe: "s1 with the rules-last prompt (o4)", run: (ctx, record) => stacked(ctx, record, { dedup: true, rulesLast: true }) },
}
