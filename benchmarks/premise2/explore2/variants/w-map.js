// Wildcard (prefix w): multi-call inference-time methods. See docs/premise-study/explore2/w.md.
//
// wprobe (diagnostic): gates' answer plus one single-email sandwich call for every
//   email gates could show (its first context, then the unseen part of its second),
//   to measure single-email abstention on gold vs non-gold emails offline.

import { sandwichPrompt, byHeaderRank, clip } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"

// gates' two contexts, exactly as explore/variants.js gatedMailbox builds them.
export async function gatesContexts(ctx, record) {
    const global = (await ctx.search(record.question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(record.question, 20, record.user)
    const mailbox = byHeaderRank(record.question, mailboxRanked.slice(0, 20), ctx.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    return { contexts: switched ? [mailbox, global] : [global, mailbox], switched, global, mailboxRanked }
}

const prompt = (ctx, record, paths) => sandwichPrompt(record.question, paths.map((path) => ctx.emailOf(path)))

// gates itself (same calls, same prompt).
export async function gatesAnswer(ctx, record, contexts) {
    let result = await ctx.generate({ prompt: prompt(ctx, record, contexts[0]) })
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ctx.generate({ prompt: prompt(ctx, record, contexts[used]) })
        used++
    }
    return { result, used }
}

async function probe(ctx, record) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const { result, used } = await gatesAnswer(ctx, record, contexts)
    const candidates = [...new Set(contexts.flat())].slice(0, 10)
    const singles = []
    for (const path of candidates) {
        const started = performance.now()
        const single = await ctx.generate({ prompt: prompt(ctx, record, [path]) })
        singles.push({ path, answer: single.answer ?? "", status: single.status, abstain: isAbstain(single.answer), ms: Math.round(performance.now() - started), chars: ctx.emailOf(path).length })
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used, singles }
}

// Single-email map-then-pick: read gates' candidate emails one at a time in gates'
// order (first context, then the unseen part of the second) and return the first
// non-abstaining answer; if the first n all abstain, fall back to gates itself.
async function mapPick(ctx, record, { n }) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const candidates = [...new Set(contexts.flat())].slice(0, n)
    const tried = []
    for (const path of candidates) {
        const single = await ctx.generate({ prompt: prompt(ctx, record, [path]) })
        tried.push({ path, abstain: isAbstain(single.answer), answer: single.answer ?? "" })
        if (single.status !== "ok") return { status: single.status, answer: single.answer ?? "", contextPaths: [path], readPaths: tried.map((t) => t.path), switched, tried }
        if (!isAbstain(single.answer)) return { status: "ok", answer: single.answer, contextPaths: [path], readPaths: [path], switched, picked: tried.length, tried }
    }
    const { result, used } = await gatesAnswer(ctx, record, contexts)
    return { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used, picked: 0, tried, fellBack: true }
}

// Lexical source of an answer: index of the email sharing the most answer tokens.
const lexTokens = (text) => new Set((String(text).toLowerCase().match(/[a-z0-9][a-z0-9.$%/@-]*[a-z0-9]/g) ?? []).filter((t) => t.length >= 3))
export function lexicalSource(answer, paths, emailOf) {
    const wanted = lexTokens(answer)
    let best = -1
    let bestScore = -1
    paths.forEach((path, index) => {
        const have = lexTokens(emailOf(path))
        let score = 0
        for (const t of wanted) if (have.has(t)) score++
        if (score > bestScore) { best = index; bestScore = score }
    })
    return best
}

// gates; when its answer is lexically sourced from the first email of the context it
// read, re-read that email alone (removes blending in a second email) and use that
// answer unless it abstains.
async function attributed(ctx, record) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const { result, used } = await gatesAnswer(ctx, record, contexts)
    const read = contexts[used - 1]
    const base = { contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used }
    if (result.status !== "ok" || isAbstain(result.answer)) return { status: result.status, answer: result.answer ?? "", ...base }
    const source = lexicalSource(result.answer, read, ctx.emailOf)
    if (source !== 0) return { status: "ok", answer: result.answer, ...base, source }
    const single = await ctx.generate({ prompt: prompt(ctx, record, [read[0]]) })
    if (single.status !== "ok" || isAbstain(single.answer)) return { status: "ok", answer: result.answer, ...base, source, single: single.answer ?? "" }
    return { status: "ok", answer: single.answer, ...base, source, gatesAnswer: result.answer, reread: true }
}

// Pointwise abstention filter: probe each candidate email alone with the sandwich prompt
// but only 5 output tokens (enough to see "NOT IN EMAILS"); then answer once from the
// non-abstaining emails first (candidate order kept), filled to k with the abstainers.
// On an exact abstention, retry once on the next k of that order.
const PROBE_OPTIONS = generationOptions({ num_predict: 5 })
const probeAbstains = (text) => /^\W*NOT\s+IN\b/i.test(String(text ?? ""))
async function filtered(ctx, record, { n = 10, k = 5, extra = 0 } = {}) {
    const { contexts, switched, mailboxRanked } = await gatesContexts(ctx, record)
    let candidates = [...new Set(contexts.flat())]
    if (extra) candidates = [...new Set([...candidates, ...byHeaderRank(record.question, mailboxRanked.slice(0, 20), ctx.emailOf).filter((path) => !candidates.includes(path)).slice(0, extra)])]
    candidates = candidates.slice(0, n + extra)
    const yes = []
    const no = []
    for (const path of candidates) {
        const probeResult = await ctx.generate({ prompt: prompt(ctx, record, [path]), options: PROBE_OPTIONS })
        ;(probeResult.status === "ok" && probeAbstains(probeResult.answer) ? no : yes).push(path)
    }
    const order = [...yes, ...no]
    let result = await ctx.generate({ prompt: prompt(ctx, record, order.slice(0, k)) })
    let used = 1
    if (result.status === "ok" && isAbstain(result.answer) && order.length > k) {
        result = await ctx.generate({ prompt: prompt(ctx, record, order.slice(k, 2 * k)) })
        used = 2
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: order.slice(0, k), readPaths: order.slice(0, used * k), switched, used, yes, no, candidates }
}

// Pointwise YES/NO relevance probe (one email, 3 output tokens) instead of abstention.
export const relevancePrompt = (question, email) => `Does the email below contain the information needed to answer the question? Reply with only YES or NO.

Question: ${question}

Email:
<<<EMAIL
${email}
EMAIL>>>

Question: ${question}
Does this email contain the answer (YES or NO)?`
const YESNO_OPTIONS = generationOptions({ num_predict: 3 })
async function yesNoFiltered(ctx, record, { k = 5, extra = 5, clipChars = 0 } = {}) {
    const { contexts, switched, mailboxRanked } = await gatesContexts(ctx, record)
    let candidates = [...new Set(contexts.flat())]
    candidates = [...new Set([...candidates, ...byHeaderRank(record.question, mailboxRanked.slice(0, 20), ctx.emailOf).filter((path) => !candidates.includes(path)).slice(0, extra)])]
    const yes = []
    const no = []
    for (const path of candidates) {
        const email = ctx.emailOf(path)
        const r = await ctx.generate({ prompt: relevancePrompt(record.question, clipChars ? clip(email, clipChars) : email), options: YESNO_OPTIONS })
        ;(r.status === "ok" && /^\W*NO\b/i.test(r.answer ?? "") ? no : yes).push(path)
    }
    const order = [...yes, ...no]
    let result = await ctx.generate({ prompt: prompt(ctx, record, order.slice(0, k)) })
    let used = 1
    if (result.status === "ok" && isAbstain(result.answer) && order.length > k) {
        result = await ctx.generate({ prompt: prompt(ctx, record, order.slice(k, 2 * k)) })
        used = 2
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: order.slice(0, k), readPaths: order.slice(0, used * k), switched, used, yes, no, candidates }
}

export const VARIANTS = {
    wprobe: { version: 1, diagnostic: true, describe: "DIAGNOSTIC: gates answer + single-email sandwich answers for each of gates' up to 10 emails", run: probe },
    w1: { version: 1, describe: "Single-email read of gates' first email; if it abstains, gates", run: (ctx, record) => mapPick(ctx, record, { n: 1 }) },
    w2: { version: 1, describe: "Single-email reads down gates' up-to-10 emails, first non-abstaining answer; if all abstain, gates", run: (ctx, record) => mapPick(ctx, record, { n: 10 }) },
    w3: { version: 1, describe: "gates; if its answer is lexically sourced from the first email it read, that email re-read alone (unless it abstains)", run: attributed },
    w4: { version: 1, describe: "Pointwise abstention probes (5 tokens) on gates' up-to-10 emails; answer from non-abstainers first (rank order), top 5", run: (ctx, record) => filtered(ctx, record) },
    w5: { version: 1, describe: "w4 with the next 5 header-reranked mailbox emails also probed (up to 15)", run: (ctx, record) => filtered(ctx, record, { extra: 5 }) },
    w6: { version: 1, describe: "w5 with a pointwise YES/NO relevance probe (3 tokens) instead of the abstention probe", run: (ctx, record) => yesNoFiltered(ctx, record) },
    w7: { version: 1, describe: "w6 probing 10 more header-ranked mailbox emails (to hdr top 15), probe emails clipped to 3000 chars", run: (ctx, record) => yesNoFiltered(ctx, record, { extra: 10, clipChars: 3000 }) },
}
