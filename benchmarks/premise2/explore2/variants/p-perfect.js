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
import { sandwichPrompt, byHeaderRank, headerScore } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { dedupContext } from "./o-reading.js"
import { snippetText } from "../tools/p-common.js"

export const denseIndex = (ctx) => ctx.resource("p-dense", () => {
    const docs = readJson(join(ctx.dataDir, "dense-docs.json"))
    return loadDense(join(ctx.dataDir, "dense.f32"), docs.paths, docs.users)
})
const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))

// Logistic swap trigger (tools/p-logit.js; fitted on the dev sets FULL-0 + S300-1 +
// S100-0..9, non-switched questions, target = the global five lack the answer). 5-fold
// CV: at logit > 0 it fires on 6.2% of non-switched hits (r4: 10.1%) for the same 92
// miss gains. Features: b1 - gmax, b1 - g1, gmax, g1, b2 - gmax (CE; b = best unseen
// mailbox candidates, g = the global five), log(1 + BM25 score of global #1), relative
// BM25 gap #1-#2, header score of global #1, header score of b1 minus that of global #1.
const LOGIT = {
    mu: [0, -4.6508, -4.1455, 3.2152, 2.7099, -5.707, 3.7949, 0.2112, 2.8109, -1.1884],
    sd: [1, 4.5191, 5.0204, 3.1355, 3.6314, 4.5896, 0.3844, 0.1902, 1.6921, 1.733],
    w: [-3.4928, 0.9356, 0.9025, 0.2105, 0.0983, 0.7771, -0.7927, -0.958, -0.0176, 0.5519],
}
export function triggerLogit({ question, emailOf, global, best, ce, scores }) {
    const g = global.map((path) => ce.get(path))
    const gmax = Math.max(...g)
    const b1 = ce.get(best[0])
    const b2 = best[1] ? ce.get(best[1]) : -99
    const [s1, s2 = 0] = scores
    const h1 = headerScore(question, emailOf(global[0]))
    const x = [1, b1 - gmax, b1 - g[0], gmax, g[0], b2 - gmax, Math.log1p(Math.abs(s1)), (s1 - s2) / (Math.abs(s1) || 1), h1, headerScore(question, emailOf(best[0])) - h1]
    return x.reduce((sum, v, j) => sum + LOGIT.w[j] * (j === 0 ? 1 : (v - LOGIT.mu[j]) / LOGIT.sd[j]), 0)
}

export const ceTextOf = (text) => (text === "snip" ? snippetText : (question, email) => rerankText(email))

// lists: { global (BM25 top 20 paths), mailbox (BM25 top >= depth paths, asker), dense
// (dense mailbox paths or null) }; scoreCe(paths) -> Promise<Map path -> score>.
export async function buildContexts({ question, user, lists, emailOf, scoreCe, scoreSnip = null, opts = {} }) {
    const { depth = 30, slot = 5, nswap = 1, dense = 0, dedup = false, reverse = null, margin = -Infinity, drop = "last", margin2 = -Infinity, bestLast = false, trigger = null, pick = null, pickDepth = 50 } = opts
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
            const ce = await scoreCe(margin === -Infinity && margin2 === -Infinity && drop !== "minCe" && trigger === null ? candidates : [...candidates, ...global])
            const sorted = [...candidates].sort((a, b) => ce.get(b) - ce.get(a))
            const best = sorted.slice(0, nswap)
            // trigger: swap only when the logistic trigger says the global five likely lack the answer
            const fire = trigger === null || triggerLogit({ question, emailOf, global, best: sorted.slice(0, 2), ce, scores: lists.globalScores }) > trigger
            const bar = margin === -Infinity ? -Infinity : Math.max(...global.map((path) => ce.get(path))) + margin
            const globalMax = Math.max(...global.map((path) => ce.get(path) ?? -Infinity))
            // margin2: emails after the first are swapped in only if CE > global CE max + margin2
            // pick (only once the trigger fired): re-pick the swapped emails among the
            // mailbox top pickDepth by max(std CE, snippet CE)
            if (fire && pick === "maxsnip") {
                const wide = lists.mailbox.slice(0, pickDepth).filter((path) => !global.includes(path))
                const std = await scoreCe(wide)
                const snip = await scoreSnip(wide)
                const both = (path) => Math.max(std.get(path), snip.get(path))
                best.splice(0, best.length, ...[...wide].sort((a, b) => both(b) - both(a)).slice(0, nswap))
                for (const path of wide) ce.set(path, both(path))
            }
            let take = !fire ? [] : best.filter((path, i) => ce.get(path) > bar && (i === 0 || margin2 === -Infinity || ce.get(path) > globalMax + margin2))
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
    // raw BM25 for the global list: the trigger needs the scores (time counts in wall ms)
    const globalHits = ctx.bm25.search(question, 20)
    const global = globalHits.map((hit) => hit.path)
    const globalScores = globalHits.slice(0, 2).map((hit) => hit.score)
    const mailbox = await ctx.search(question, Math.max(20, depth, opts.pick ? opts.pickDepth ?? 50 : 0), record.user)
    let dense = null
    if (opts.dense) {
        const index = await denseIndex(ctx)
        const vector = await ctx.embedQuery(question)
        const started = performance.now()
        dense = denseSearch(index, vector, opts.dense, record.user).map((hit) => hit.path)
        ctx.denseMs = (ctx.denseMs ?? 0) + performance.now() - started
    }
    const textOf = ceTextOf(opts.text)
    const memo = new Map() // per question: each email is scored once
    const scoreCe = async (paths) => {
        const todo = [...new Set(paths)].filter((path) => !memo.has(path))
        if (todo.length) {
            const model = await reranker(ctx)
            const scores = await model.score(question, todo.map((path) => textOf(question, ctx.emailOf(path))))
            todo.forEach((path, index) => memo.set(path, scores[index]))
        }
        return new Map(paths.map((path) => [path, memo.get(path)]))
    }
    // snippet CE: only emails whose snippet differs from the standard text are re-scored
    const scoreSnip = async (paths) => {
        const std = await scoreCe(paths)
        const todo = paths.filter((path) => snippetText(question, ctx.emailOf(path)) !== rerankText(ctx.emailOf(path)))
        const model = await reranker(ctx)
        const scores = todo.length ? await model.score(question, todo.map((path) => snippetText(question, ctx.emailOf(path)))) : []
        todo.forEach((path, index) => std.set(path, scores[index]))
        return std
    }
    const { contexts, switched, swapped } = await buildContexts({ question, user: record.user, lists: { global, mailbox, dense, globalScores }, emailOf: ctx.emailOf, scoreCe, scoreSnip, opts })
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
    p1: { version: 1, describe: "gates + logistic-triggered swap (logit > 0): best 2 unseen CE emails of the mailbox top 30 take slots 4-5 (best last), other-mailbox emails dropped first", run: (ctx, record) => perfect(ctx, record, { trigger: 0, nswap: 2, bestLast: true, drop: "foreign" }) },
    p3: { version: 1, describe: "p1 with the two swapped emails picked from the mailbox top 50 by max(std CE, question-snippet CE) (trigger unchanged)", run: (ctx, record) => perfect(ctx, record, { trigger: 0, nswap: 2, bestLast: true, drop: "foreign", pick: "maxsnip" }) },
    p4: { version: 1, describe: "p3 + near-duplicate collapse in the mailbox context (o11 / s1 dedup; touches switched contexts only)", run: (ctx, record) => perfect(ctx, record, { trigger: 0, nswap: 2, bestLast: true, drop: "foreign", pick: "maxsnip", dedup: true }) },
    p2: { version: 1, describe: "p1 with a looser trigger (logit > -0.5)", run: (ctx, record) => perfect(ctx, record, { trigger: -0.5, nswap: 2, bestLast: true, drop: "foreign" }) },
}
