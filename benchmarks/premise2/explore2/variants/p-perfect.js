// One-shot perfecter (prefix p), exploration phase 2 round 2. Builds on r5 (gates +
// cross-encoder slot-5 swap from the asker's mailbox BM25 top 30) and keeps gates'
// reading: sandwichPrompt, the gate (switch to the mailbox context when the global
// top 1 is from another mailbox), one retry on the other context after an exact
// abstention. One generation call (plus the rare retry); no model-chosen actions.
// Notes: docs/premise-study/explore2/p.md; offline simulation: tools/p-sim.js (it
// calls buildContexts below, so simulated and run contexts are the same code).
//
// Options (defaults = r5):
//   depth    mailbox BM25 candidates for the swap (30)
//   slot     1-based position the swapped email takes in the global context (5);
//            the global emails from that slot on shift down, global #5 drops out
//   nswap    number of swapped emails (1); with 2 they take slots slot-1 and slot
//   text     cross-encoder input: "std" (Subject + Sender + body start) or "snip"
//            (Subject + Sender + the body window covering most question words)
//   dense    add the asker's nomic-dense mailbox top N to the swap candidates (0)
//   dedup    near-duplicate collapse in the mailbox context (o11 / s1)
//   reverse  when switched: the mailbox context's slot 5 gets the best CE email of
//            "global" (global top 10) or "pool" (the swap candidates) not shown (null)
//   margin   swap only if best CE > max CE of the global five + margin (-Infinity)
//
// pdense (diagnostic, no generation): dense lists stored for the offline tools.

import { join } from "node:path"
import { readJson, loadDense, denseSearch } from "../../dense.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { sandwichPrompt, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { dedupContext } from "./o-reading.js"
import { snippetText } from "../tools/p-common.js"

export const denseIndex = (ctx) => ctx.resource("p-dense", () => {
    const docs = readJson(join(ctx.dataDir, "dense-docs.json"))
    return loadDense(join(ctx.dataDir, "dense.f32"), docs.paths, docs.users)
})
const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))

export const ceTextOf = (text) => (text === "snip" ? snippetText : (question, email) => rerankText(email))

// lists: { global (BM25 top 20 paths), mailbox (BM25 top >= depth paths, asker), dense
// (dense mailbox paths or null) }; scoreCe(paths) -> Promise<Map path -> score>.
export async function buildContexts({ question, user, lists, emailOf, scoreCe, opts = {} }) {
    const { depth = 30, slot = 5, nswap = 1, dense = 0, dedup = false, reverse = null, margin = -Infinity, drop = "last", margin2 = -Infinity, bestLast = false } = opts
    const global = lists.global.slice(0, 5)
    const mailboxRanked = lists.mailbox.slice(0, depth)
    const mailboxOrdered = byHeaderRank(question, lists.mailbox.slice(0, 20), emailOf)
    let mailbox = mailboxOrdered.slice(0, 5)
    if (dedup) mailbox = dedupContext(mailbox, { emailOf }, mailboxOrdered)
    const switched = !global[0]?.startsWith(`${user}/`)
    const pool = [...new Set([...mailboxRanked, ...(dense ? (lists.dense ?? []).slice(0, dense) : [])])]
    let globalCtx = global
    let swapped = 0
    if (!switched) {
        const candidates = pool.filter((path) => !global.includes(path))
        if (candidates.length) {
            const ce = await scoreCe(margin === -Infinity && margin2 === -Infinity && drop !== "minCe" ? candidates : [...candidates, ...global])
            const best = [...candidates].sort((a, b) => ce.get(b) - ce.get(a)).slice(0, nswap)
            const bar = margin === -Infinity ? -Infinity : Math.max(...global.map((path) => ce.get(path))) + margin
            const globalMax = Math.max(...global.map((path) => ce.get(path) ?? -Infinity))
            // margin2: emails after the first are swapped in only if CE > global CE max + margin2
            let take = best.filter((path, i) => ce.get(path) > bar && (i === 0 || margin2 === -Infinity || ce.get(path) > globalMax + margin2))
            // bestLast: the best swapped email takes the last slot (slot), the next ones precede it
            if (bestLast) take = [...take].reverse()
            if (take.length) {
                // which global emails make room: the last ones ("last", r5), the lowest-CE of
                // #2-#5 ("minCe"), or the last ones from another mailbox ("foreign", else last)
                let order = [4, 3, 2, 1]
                if (drop === "minCe") order = [1, 2, 3, 4].sort((a, b) => ce.get(global[a]) - ce.get(global[b]))
                if (drop === "foreign") order = [...order.filter((i) => !global[i]?.startsWith(`${user}/`)), ...order.filter((i) => global[i]?.startsWith(`${user}/`))]
                const gone = new Set(order.slice(0, take.length).map((i) => global[i]))
                const keep = global.filter((path) => !gone.has(path)).slice(0, 5 - take.length)
                const at = Math.max(0, slot - take.length)
                globalCtx = [...keep.slice(0, at), ...take, ...keep.slice(at)]
                swapped = take.length
            }
        }
    } else if (reverse) {
        const source = reverse === "global" ? lists.global.slice(0, 10) : pool
        const candidates = source.filter((path) => !mailbox.includes(path))
        if (candidates.length) {
            const ce = await scoreCe(candidates)
            const best = [...candidates].sort((a, b) => ce.get(b) - ce.get(a))[0]
            mailbox = [...mailbox.slice(0, 4), best]
            swapped = -1
        }
    }
    return { contexts: switched ? [mailbox, globalCtx] : [globalCtx, mailbox], switched, swapped }
}

async function perfect(ctx, record, opts = {}) {
    const question = record.question
    const depth = opts.depth ?? 30
    const global = await ctx.search(question, 20)
    const mailbox = await ctx.search(question, Math.max(20, depth), record.user)
    let dense = null
    if (opts.dense) {
        const index = await denseIndex(ctx)
        const vector = await ctx.embedQuery(question)
        const started = performance.now()
        dense = denseSearch(index, vector, opts.dense, record.user).map((hit) => hit.path)
        ctx.denseMs = (ctx.denseMs ?? 0) + performance.now() - started
    }
    const textOf = ceTextOf(opts.text)
    const scoreCe = async (paths) => {
        const model = await reranker(ctx)
        const scores = await model.score(question, paths.map((path) => textOf(question, ctx.emailOf(path))))
        return new Map(paths.map((path, index) => [path, scores[index]]))
    }
    const { contexts, switched, swapped } = await buildContexts({ question, user: record.user, lists: { global, mailbox, dense }, emailOf: ctx.emailOf, scoreCe, opts })
    const prompt = (paths) => sandwichPrompt(question, paths.map((path) => ctx.emailOf(path)))
    let result = await ctx.generate({ prompt: prompt(contexts[0]) })
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ctx.generate({ prompt: prompt(contexts[used]) })
        used++
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, swapped, used }
}

async function denseDiag(ctx, record) {
    const index = await denseIndex(ctx)
    const vector = await ctx.embedQuery(record.question)
    const global = denseSearch(index, vector, 20).map((hit) => [hit.path, +hit.score.toFixed(4)])
    const mailbox = denseSearch(index, vector, 50, record.user).map((hit) => [hit.path, +hit.score.toFixed(4)])
    return { status: "diagnostic", answer: "", dense: { global, mailbox } }
}

export const VARIANTS = {
    pdense: { version: 1, describe: "diagnostic: nomic dense global top 20 / mailbox top 50 (no generation)", run: denseDiag },
    pr5: { version: 1, describe: "DIAGNOSTIC: r5 rebuilt through buildContexts (must match r5's contexts)", run: (ctx, record) => perfect(ctx, record, {}) },
}
