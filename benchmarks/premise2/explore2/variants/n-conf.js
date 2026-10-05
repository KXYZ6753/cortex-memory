// New-methods scientist (prefix n): e2b's own token probabilities as a signal.
// Notes: docs/premise-study/explore2/n.md
//
// n-lp0 (DIAGNOSTIC): gates exactly (same contexts, gate, sandwich prompt, retry), its
// answer call made through /api/chat with logprobs; plus the same first context read
// with two other prompts (o4 rules-last, pb's T2), all with
// logprobs. The final answer is gates' answer; the alternatives and every call's
// token logprobs are stored for offline selection studies (texts are deterministic, so
// stored J1 verdicts of gates / o4 / pb answers transfer by text).

import { buildPrompt, isAbstain } from "../../prompts.js"
import { byHeaderRank, sandwichPrompt, NUM_PREDICT } from "../../explore/variants.js"
import { generationOptions } from "../../ollama.js"
import { rulesLastPrompt, demoMessages, dedupContext } from "./o-reading.js"
import { join } from "node:path"
import { loadReranker, rerankText } from "../../rerank.js"

// One /api/chat call with logprobs; returns chat()-like { status, answer } plus a compact
// token trace: toks (strings), lps (logprob per output token), top1 (first token's top-k).
export async function lpCall(ctx, { prompt, messages, numPredict = NUM_PREDICT, topK = 5 }) {
    const data = await ctx.chatRaw({ messages: messages ?? [{ role: "user", content: prompt }], truncate: false, logprobs: true, top_logprobs: topK, options: generationOptions({ num_predict: numPredict }) })
    if (data.error) return { status: "http_error", answer: "", error: String(data.error).slice(0, 300), toks: [], lps: [] }
    const raw = typeof data.message?.content === "string" ? data.message.content : null
    const answer = raw === null ? "" : raw.trim()
    let status = "ok"
    if (raw === null) status = "malformed"
    else if (!answer) status = data.done_reason === "length" ? "output_limit" : "empty"
    else if (data.done_reason === "length") status = "output_limit"
    const lp = Array.isArray(data.logprobs) ? data.logprobs : []
    return {
        status, answer,
        toks: lp.map((t) => t.token),
        lps: lp.map((t) => Math.round((t.logprob ?? 0) * 1000) / 1000),
        tops: lp.slice(0, 3).map((t) => (t.top_logprobs ?? []).map((a) => [a.token, Math.round(a.logprob * 1000) / 1000])),
        hasLogprobs: Array.isArray(data.logprobs),
    }
}

// gates' two contexts (explore/variants.js gatedMailbox with defaults).
export async function gatesContexts(ctx, record) {
    const global = (await ctx.search(record.question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(record.question, 20, record.user)
    const mailbox = byHeaderRank(record.question, mailboxRanked, ctx.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    return { contexts: switched ? [mailbox, global] : [global, mailbox], switched, global, mailboxRanked }
}

// s1's contexts (s-stack.js stacked with dedup, swap): gates' contexts, the mailbox one
// near-duplicate-collapsed (o11), and when not switched the best cross-encoder email of
// the mailbox BM25 top 30 not already shown replaces global #5 (r5).
const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
export async function s1Contexts(ctx, record) {
    const question = record.question
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = (await ctx.search(question, 30, record.user)).slice(0, 30)
    const mailboxOrdered = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    const mailbox = dedupContext(mailboxOrdered.slice(0, 5), ctx, mailboxOrdered)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    let globalCtx = global
    if (!switched) {
        const candidates = mailboxRanked.filter((path) => !global.includes(path))
        if (candidates.length) {
            const scores = await (await reranker(ctx)).score(question, candidates.map((path) => rerankText(ctx.emailOf(path))))
            globalCtx = [...global.slice(0, 4), candidates[scores.indexOf(Math.max(...scores))]]
        }
    }
    return { contexts: switched ? [mailbox, globalCtx] : [globalCtx, mailbox], switched, global, mailboxRanked }
}

const emailsOf = (ctx, paths) => paths.map((path) => ctx.emailOf(path))
const trace = (r) => ({ answer: r.answer, status: r.status, toks: r.toks, lps: r.lps, tops: r.tops })

async function lp0(ctx, record) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const question = record.question
    const sand = (paths) => lpCall(ctx, { prompt: sandwichPrompt(question, emailsOf(ctx, paths)) })
    let result = await sand(contexts[0])
    const first = result
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await sand(contexts[used])
        used++
    }
    const emails = emailsOf(ctx, contexts[0])
    const o4 = await lpCall(ctx, { prompt: rulesLastPrompt(question, emails) })
    const t2 = await lpCall(ctx, { prompt: buildPrompt({ question, paths: contexts[0], representation: "R0", template: "T2", emailByPath: ctx.emailMap, record }) })
    return {
        status: result.status, answer: result.answer, contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used,
        hasLogprobs: first.hasLogprobs,
        lp: { gates: trace(first), retry: used > 1 ? trace(result) : null, o4: trace(o4), t2: trace(t2) },
    }
}


// Mean token logprob of an answer (the confidence used for selection).
export const meanLp = (r) => (r.lps?.length ? r.lps.reduce((a, b) => a + b, 0) / r.lps.length : -Infinity)
const usable = (r) => (r.status === "ok" || r.status === "output_limit") && r.answer && !isAbstain(r.answer)

// Confidence selection: the base pipeline's sandwich answer (with gates' abstention retry)
// plus the same final context read with other prompts; the answer with the highest mean
// token logprob wins (the sandwich answer wins ties and needs to be beaten by margin).
export async function confSelect(ctx, record, { base = "gates", alts = ["o4", "t2"], margin = 0, score = meanLp } = {}) {
    const { contexts, switched } = base === "s1" ? await s1Contexts(ctx, record) : await gatesContexts(ctx, record)
    const question = record.question
    const sand = (paths) => lpCall(ctx, { prompt: sandwichPrompt(question, emailsOf(ctx, paths)) })
    let result = await sand(contexts[0])
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await sand(contexts[used])
        used++
    }
    const final = contexts[used - 1]
    const emails = emailsOf(ctx, final)
    const cands = [{ name: "sandwich", r: result }]
    if (usable(result)) for (const alt of alts) {
        const r = alt === "o4" ? await lpCall(ctx, { prompt: rulesLastPrompt(question, emails) })
            : alt === "o5" ? await lpCall(ctx, { messages: demoMessages(question, emails) })
            : await lpCall(ctx, { prompt: buildPrompt({ question, paths: final, representation: "R0", template: "T2", emailByPath: ctx.emailMap, record }) })
        cands.push({ name: alt, r })
    }
    let best = cands[0]
    for (const c of cands.slice(1)) if (usable(c.r) && score(c.r) > score(best.r) + (best === cands[0] ? margin : 0)) best = c
    return {
        status: best.r.status, answer: best.r.answer, contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used, picked: best.name,
        cands: cands.map((c) => ({ name: c.name, answer: c.r.answer, status: c.r.status, mean: Math.round(score(c.r) * 1000) / 1000, toks: c.r.toks, lps: c.r.lps })),
    }
}

// Hedged answers ("does not specify …" while still answering): ~10% correct offline.
export const HEDGE = /\b(do(es)?n['’]?t|do(es)? not|is not|are not|isn['’]t|aren['’]t|was not|were not)\s+(specif|mention|provide|state|say|include|give|indicate|explicitly|contain|identify|detail)|\bnot (specified|mentioned|stated|provided)\b|\bno (specific|explicit) /i

// Confidence-triggered second context: the base answer from the first context; when it
// abstains, hedges or its mean token logprob is below tau, the other context is read
// too and the more confident usable answer is kept (an abstention never wins).
export async function confRetry(ctx, record, { base = "s1", tau = -0.3, hedge = true, score = meanLp } = {}) {
    const { contexts, switched } = base === "s1" ? await s1Contexts(ctx, record) : await gatesContexts(ctx, record)
    const question = record.question
    const sand = (paths) => lpCall(ctx, { prompt: sandwichPrompt(question, emailsOf(ctx, paths)) })
    const first = await sand(contexts[0])
    const low = !usable(first) || score(first) < tau || (hedge && HEDGE.test(first.answer))
    const out = { contextPaths: contexts[0], switched, firstMean: Math.round(score(first) * 1000) / 1000, trigger: low, first: { answer: first.answer, toks: first.toks, lps: first.lps, tops: first.tops } }
    if (!low || !contexts[1]?.length) return { ...out, status: first.status, answer: first.answer, readPaths: contexts[0], used: 1, picked: "first" }
    const second = await sand(contexts[1])
    const pickSecond = usable(second) && (!usable(first) || score(second) > score(first))
    const best = pickSecond ? second : first
    return { ...out, status: best.status, answer: best.answer, readPaths: [...contexts[0], ...contexts[1]], used: 2, picked: pickSecond ? "second" : "first", second: { answer: second.answer, toks: second.toks, lps: second.lps, tops: second.tops } }
}

export const VARIANTS = {
    "n-lp0": { version: 1, diagnostic: true, describe: "DIAGNOSTIC: gates via chatRaw with logprobs, plus o4 / T2 prompts on the same first context (logprobs stored)", run: lp0 },
    "n-cs2": { version: 1, describe: "s1 contexts; sandwich + o4 + T2 answers on the final context, pick the highest mean token logprob", run: (ctx, record) => confSelect(ctx, record, { base: "s1" }) },
    "n-cr1": { version: 1, describe: "s1 contexts; when the first answer abstains, hedges or has low mean token logprob, read the other context and keep the more confident answer", run: (ctx, record) => confRetry(ctx, record) },
}
