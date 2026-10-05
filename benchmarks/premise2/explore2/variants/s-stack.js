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
import { generationOptions } from "../../ollama.js"
import { contentWords, normaliseForMatch } from "../../text.js"
import { attribute } from "./a-common.js"
import { pickPrompt, parsePick, listLines } from "./a-agent.js"
import { dedupContext, rulesLastPrompt } from "./o-reading.js"

const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))

export async function stacked(ctx, record, { swap = true, dedup = false, rulesLast = false, depth = 30, escalate = false, margin = 0.15, swapMargin = -Infinity } = {}) {
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
            // r4's condition (swapMargin -1): the best unseen mailbox email must score
            // within |swapMargin| of the best global email; r5 (default) always swaps.
            const pool = Number.isFinite(swapMargin) ? [...candidates, ...global] : candidates
            const scores = await model.score(question, pool.map((path) => rerankText(ctx.emailOf(path))))
            const cand = scores.slice(0, candidates.length)
            const bestScore = Math.max(...cand)
            const globalMax = Number.isFinite(swapMargin) ? Math.max(...scores.slice(candidates.length)) : -Infinity
            if (bestScore > globalMax + swapMargin) {
                globalCtx = [...global.slice(0, 4), candidates[cand.indexOf(bestScore)]]
                swapped = true
            }
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
    const base = { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, swapped, used }
    if (!escalate || (result.status !== "ok" && result.status !== "output_limit")) return base
    // a5's escalation: one list pick over <= 15 emails; read the pick alone only when it
    // is outside the final context and covers the question's words clearly better.
    const final = contexts[used - 1]
    const shown = [...new Set([...contexts[0], ...contexts[1], ...byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf, { k: 20 })])].slice(0, 15)
    const pick = await ctx.generate({ prompt: pickPrompt(question, listLines(ctx, record, shown)), options: generationOptions({ num_predict: 12 }) })
    const n = parsePick(pick.answer, shown.length)
    if (!n || final.includes(shown[n - 1])) return { ...base, step: "agree" }
    const qw = contentWords(question)
    const cov = (path) => { const lower = normaliseForMatch(ctx.emailOf(path)); return qw.filter((w) => lower.includes(w)).length / Math.max(1, qw.length) }
    const source = isAbstain(result.answer) ? null : attribute(result.answer, question, final, ctx.emailOf)
    if (cov(shown[n - 1]) < (source ? cov(source.path) : 0) + margin) return { ...base, step: "outside-weak" }
    const second = await ctx.generate({ prompt: prompt([shown[n - 1]]) })
    if ((second.status !== "ok" && second.status !== "output_limit") || isAbstain(second.answer) || !String(second.answer ?? "").trim()) return { ...base, step: "escalated-abstain" }
    return { ...base, status: second.status, answer: second.answer, readPaths: [...base.readPaths, shown[n - 1]], step: "escalated" }
}

export const VARIANTS = {
    s1: { version: 1, describe: "r5 swap + mailbox-context dedup (o11), sandwich prompt", run: (ctx, record) => stacked(ctx, record, { dedup: true }) },
    s3: { version: 1, describe: "s1 + a5's list-pick escalation", run: (ctx, record) => stacked(ctx, record, { dedup: true, escalate: true }) },
    s4: { version: 1, describe: "miss-side stack: r4's conditional swap + mailbox dedup + a5 escalation", run: (ctx, record) => stacked(ctx, record, { dedup: true, escalate: true, swapMargin: -1 }) },
    s5: { version: 1, describe: "r4's conditional swap + a5 escalation (no dedup)", run: (ctx, record) => stacked(ctx, record, { escalate: true, swapMargin: -1 }) },
    s2: { version: 1, describe: "s1 with the rules-last prompt (o4)", run: (ctx, record) => stacked(ctx, record, { dedup: true, rulesLast: true }) },
}
