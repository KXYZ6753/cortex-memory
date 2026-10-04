// Retrieval engineer (prefix r): gates with a cross-encoder in the retrieval step.
// Offline evidence: benchmarks/premise2/explore2/tools/r-recall.js, notes in
// docs/premise-study/explore2/r.md.
//
// All variants keep gates' reading: sandwichPrompt, the same gate (switch to the
// mailbox context when the global top 1 is from another mailbox), and one retry on
// the other context after an exact abstention. What changes:
//   mailbox context  r1: cross-encoder (CE) top 5 of the asker's mailbox BM25 top 30,
//                    CE order; r2: RRF(k=10) of BM25 rank, header-match rank and 2x
//                    the CE rank over the same 30 (gates: BM25 + header over top 20)
//   swap "last"      when not switched, the best CE email of the mailbox top 30 not
//                    already shown replaces the global #5 (the global #1 keeps the
//                    first slot) if it outscores all five global emails (+ margin)
//   ceorder (off)    offline, CE best-first ordering of the global context lowered
//                    AB@1 on hits (95.8 -> 90.3), so BM25 order is kept
// Cross-encoder: Xenova/ms-marco-MiniLM-L-6-v2 (q8, CPU) on Subject + Sender + body
// start (rerank.js rerankText), ~35 pairs per question.

import { join } from "node:path"
import { rrf } from "../../retrieve.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { sandwichPrompt, headerScore, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { openBm25 } from "../../bm25.js"

// Field-weighted BM25 (bm25() column weights: path, user, subject, sender, recipients,
// body), same FTS5 index and query sanitiser as ctx.search; time counts in wall ms.
async function fieldSearch(ctx, weights) {
    const handle = await ctx.resource(`r-bm25-${weights.join("-")}`, () => openBm25(join(ctx.dataDir, "corpus.sqlite"), { weights }))
    return async (query, k, user = null) => handle.search(query, k, user).map((hit) => hit.path)
}

const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))

async function ceScores(ctx, question, paths) {
    const model = await reranker(ctx)
    const scores = await model.score(question, paths.map((path) => rerankText(ctx.emailOf(path))))
    return new Map(paths.map((path, index) => [path, scores[index]]))
}

export async function rerankGate(ctx, record, { depth = 30, mode = "ce", wCe = 2, ceorder = false, swap = "last", margin = 0, header = true, fresh = false, weights = null } = {}) {
    const search = weights ? await fieldSearch(ctx, weights) : ctx.search
    const question = record.question
    const global = (await search(question, 20)).slice(0, 5)
    const mailboxRanked = (await search(question, depth, record.user)).slice(0, depth)
    const started = performance.now()
    // mode "gates" needs the CE only for the swap, i.e. when not switched.
    const skipCe = mode === "gates" && !fresh && !global[0]?.startsWith(`${record.user}/`)
    const ce = skipCe ? new Map() : await ceScores(ctx, question, [...new Set([...mailboxRanked, ...global])])
    const ceMs = Math.round(performance.now() - started)
    const ceOf = (path) => ce.get(path) ?? -Infinity
    const byCe = (paths) => [...paths].sort((a, b) => ceOf(b) - ceOf(a))
    const lists = [mailboxRanked.map((path) => ({ path }))]
    if (header) lists.push(mailboxRanked.map((path, index) => ({ path, index, h: headerScore(question, ctx.emailOf(path)) })).sort((a, b) => b.h - a.h || a.index - b.index))
    const ceList = byCe(mailboxRanked).map((path) => ({ path }))
    for (let i = 0; i < wCe; i++) lists.push(ceList)
    // mode "gates": exactly gates' mailbox context (BM25 top 20 reranked by RRF of BM25 and header rank)
    let mailbox = mode === "gates" ? byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf, { k: 5 }) : mode === "ce" ? byCe(mailboxRanked).slice(0, 5) : rrf(lists, 10, 5).map((hit) => hit.path)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    let globalCtx = global
    let swapped = false
    if (swap && !switched) {
        const best = byCe(mailboxRanked).find((path) => !global.includes(path))
        if (best && ceOf(best) > Math.max(...global.map(ceOf)) + margin) {
            globalCtx = swap === "first" ? [best, ...global.slice(0, 4)] : [...global.slice(0, 4), best]
            swapped = true
        }
    }
    if (ceorder) {
        mailbox = byCe(mailbox)
        globalCtx = byCe(globalCtx)
    }
    const contexts = switched ? [mailbox, globalCtx] : [globalCtx, mailbox]
    // fresh: the retry context shows only emails not in the first one (global top 10
    // then mailbox CE order when switched; mailbox CE order otherwise).
    if (fresh) {
        const spare = switched ? [...(await search(question, 10)), ...byCe(mailboxRanked)] : byCe(mailboxRanked)
        contexts[1] = [...new Set(spare)].filter((path) => !contexts[0].includes(path)).slice(0, 5)
    }
    const prompt = (paths) => sandwichPrompt(question, paths.map((path) => ctx.emailOf(path)))
    let result = await ctx.generate({ prompt: prompt(contexts[0]) })
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ctx.generate({ prompt: prompt(contexts[used]) })
        used++
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, swapped, used, ceMs }
}

export const VARIANTS = {
    r1: { version: 2, describe: "gates; mailbox ctx = CE top 5 of mailbox BM25 top 30; when not switched, best unseen mailbox CE email replaces global #5 if it outscores the global five", run: (ctx, record) => rerankGate(ctx, record) },
    r3: { version: 1, describe: "r1 with swap threshold = global CE max - 1 and a retry context of 5 unseen emails", run: (ctx, record) => rerankGate(ctx, record, { margin: -1, fresh: true }) },
    r4: { version: 1, describe: "gates exactly, plus: when not switched, the best unseen mailbox-top-30 CE email replaces global #5 if its CE > global CE max - 1", run: (ctx, record) => rerankGate(ctx, record, { mode: "gates", margin: -1 }) },
    r5: { version: 1, describe: "r4 with the swap always made (best unseen mailbox-top-30 CE email in slot 5 whenever not switched)", run: (ctx, record) => rerankGate(ctx, record, { mode: "gates", margin: -Infinity }) },
    r2: { version: 1, describe: "r1 with mailbox ctx = RRF(BM25, header, 2xCE) of mailbox top 30", run: (ctx, record) => rerankGate(ctx, record, { mode: "fuse" }) },
}
