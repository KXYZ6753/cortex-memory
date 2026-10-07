// Worker u (round 5): methods from the recent literature, implemented for e2b through
// Ollama 0.34.2. Notes: docs/premise-study/explore2/u.md
//
// u-probe (DIAGNOSTIC, no answer): feasibility of decoding-level methods through the
// API wrapper (ctx.chatRaw = /api/chat): logprobs / top_logprobs limits, assistant-turn
// prefill (continuation), per-call latency of 1-token calls on a cached prefix, and
// whether alternating two prompts thrashes the single prompt-cache slot
// (OLLAMA_NUM_PARALLEL=1). Also checks /api/generate raw mode.

import { sandwichPrompt, VARIANTS as BASE } from "../../explore/variants.js"
import { generationOptions } from "../../ollama.js"
import { VARIANTS as X } from "./x-agent.js"
import { isAbstain } from "../../prompts.js"
import { HEDGE } from "./n-conf.js"

const ms = (t0) => Math.round(performance.now() - t0)

// the sandwich prompt without the emails block (question-only condition for CAD-style contrast)
export function noContextPrompt(question) {
    return sandwichPrompt(question, []).replace(/Emails:\n<<<EMAILS\n\nEMAILS>>>\n\n/, "")
}

async function raw(ctx, body) {
    const t0 = performance.now()
    const data = await ctx.chatRaw(body)
    return { data, wall: ms(t0) }
}
const brief = ({ data, wall }) => ({
    wall, error: data.error ?? null, answer: data.message?.content ?? null, done: data.done_reason ?? null,
    pe: data.prompt_eval_count ?? null, ev: data.eval_count ?? null,
    peMs: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : null,
    evMs: data.eval_duration ? Math.round(data.eval_duration / 1e6) : null,
    nlp: Array.isArray(data.logprobs) ? data.logprobs.length : null,
    ntop: Array.isArray(data.logprobs) && data.logprobs[0]?.top_logprobs ? data.logprobs[0].top_logprobs.length : null,
    top0: Array.isArray(data.logprobs) ? (data.logprobs[0]?.top_logprobs ?? []).slice(0, 6).map((a) => [a.token, Math.round(a.logprob * 1000) / 1000]) : null,
    toks: Array.isArray(data.logprobs) ? data.logprobs.slice(0, 12).map((t) => t.token) : null,
})

async function probe(ctx, record) {
    const q = record.question
    const gold = ctx.emailOf(record.path)
    const Pc = sandwichPrompt(q, [gold])
    const Pq = noContextPrompt(q)
    const out = {}
    // 1. logprobs with top 20, and the limit (25, 50)
    const base = await raw(ctx, { messages: [{ role: "user", content: Pc }], logprobs: true, top_logprobs: 20 })
    out.base = brief(base)
    out.top25 = brief(await raw(ctx, { messages: [{ role: "user", content: Pc }], logprobs: true, top_logprobs: 25, options: generationOptions({ num_predict: 2 }) }))
    out.top50 = brief(await raw(ctx, { messages: [{ role: "user", content: Pc }], logprobs: true, top_logprobs: 50, options: generationOptions({ num_predict: 2 }) }))
    const toks = (base.data.logprobs ?? []).map((t) => t.token)
    // 2. assistant prefill: does the model continue a partial assistant message?
    const pre = toks.slice(0, 3).join("")
    out.prefillText = pre
    out.prefill = brief(await raw(ctx, { messages: [{ role: "user", content: Pc }, { role: "assistant", content: pre }], logprobs: true, top_logprobs: 5, options: generationOptions({ num_predict: 8 }) }))
    out.render = await ctx.chatRaw({ messages: [{ role: "user", content: "Q?" }, { role: "assistant", content: "The answer" }], _debug_render_only: true }).then((d) => JSON.stringify(d).slice(0, 1500)).catch((e) => String(e))
    // 3. 1-token calls along the answer path, question-only prompt (cache should hold Pq + prefix)
    out.qPath = []
    for (let t = 0; t < Math.min(10, toks.length); t++) {
        const r = await raw(ctx, { messages: [{ role: "user", content: Pq }, ...(t ? [{ role: "assistant", content: toks.slice(0, t).join("") }] : [])], logprobs: true, top_logprobs: 20, options: generationOptions({ num_predict: 1 }) })
        out.qPath.push(brief(r))
    }
    // 4. same along the context prompt (cache holds Pq now -> first call re-evaluates Pc)
    out.cPath = []
    for (let t = 0; t < Math.min(6, toks.length); t++) {
        const r = await raw(ctx, { messages: [{ role: "user", content: Pc }, ...(t ? [{ role: "assistant", content: toks.slice(0, t).join("") }] : [])], logprobs: true, top_logprobs: 20, options: generationOptions({ num_predict: 1 }) })
        out.cPath.push(brief(r))
    }
    // 5. alternating Pc / Pq (single cache slot -> Pc re-evaluated each time?)
    out.alt = []
    for (let t = 1; t <= 4; t++) {
        for (const P of [Pc, Pq]) {
            const r = await raw(ctx, { messages: [{ role: "user", content: P }, { role: "assistant", content: toks.slice(0, t).join("") }], logprobs: true, top_logprobs: 20, options: generationOptions({ num_predict: 1 }) })
            out.alt.push({ ctx: P === Pc, ...brief(r) })
        }
    }
    // 6. /api/generate raw mode (prompt = rendered template) with logprobs
    try {
        const t0 = performance.now()
        const res = await fetch(`${ctx.ollamaUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: ctx.tag, stream: false, raw: true, keep_alive: "60m", prompt: `<start_of_turn>user\n${Pq}<end_of_turn>\n<start_of_turn>model\n`, logprobs: true, top_logprobs: 5, options: generationOptions({ num_predict: 4 }) }) })
        const data = await res.json()
        out.genRaw = brief({ data: { ...data, message: { content: data.response } }, wall: ms(t0) })
    } catch (e) { out.genRaw = String(e) }
    // 7. format enum (constrained choice) with logprobs
    out.fmt = brief(await raw(ctx, { messages: [{ role: "user", content: Pc }], format: { type: "string", enum: ["alpha beta", "gamma delta"] }, logprobs: true, top_logprobs: 5, options: generationOptions({ num_predict: 10 }) }))
    return { status: "diagnostic", answer: "", probe: out }
}

// ---- Prompt repetition (Leviathan, Kalman & Matias 2025, arXiv:2512.14982; PARTREP 2026) ----
// In a causal LM no prompt token attends to anything after it: the emails are encoded
// before the closing question and rules. Repeating the whole prompt lets every token of
// the second copy attend to the full first copy. Prefill only (no extra output tokens).
// Applied to gates' sandwich answer prompt wherever a pipeline uses it (a ctx proxy
// rewrites the prompt of every sandwich answer call; probes, picks, plans, tool turns
// are untouched). If the doubled prompt overflows num_ctx, the call is re-sent plain.
const SANDWICH_HEAD = "You answer questions about a person's email archive using only the emails below."
export const isSandwich = (s) => typeof s === "string" && s.startsWith(SANDWICH_HEAD) && s.endsWith("\nAnswer:")
export function repeatPrompt(p, { verbose = true, times = 2 } = {}) {
    const body = p.replace(/\nAnswer:$/, "")
    const parts = [body]
    for (let i = 1; i < times; i++) parts.push(`${verbose ? (i === 1 ? "Let me repeat that:\n\n" : "Let me repeat that one more time:\n\n") : ""}${i === times - 1 ? p : body}`)
    return parts.join("\n\n")
}
// ~3 chars per token for these emails; num_ctx 16384 minus room for the answer
const MAX_CHARS = 15_800 * 3
// lpOffset: added to every token logprob returned by a rewritten /api/chat call. Used to
// move x1's handover threshold without copying x1: x1 hands a commit to g5 when the
// commit answer's mean token logprob < -0.1, so an offset of +0.01 is tau = -0.11.
export function rewriteCtx(ctx, rewrite, stats, { lpOffset = 0 } = {}) {
    const tr = (s) => (isSandwich(s) && (stats.n++, true) ? rewrite(s) : s)
    const trMsgs = (m) => (Array.isArray(m) && m.length === 1 && m[0].role === "user" && isSandwich(m[0].content) ? [{ ...m[0], content: tr(m[0].content) }] : m)
    const fits = (s) => typeof s !== "string" || s.length <= MAX_CHARS
    return {
        ...ctx,
        generate: async (args) => {
            const prompt = args.prompt ? tr(args.prompt) : args.prompt
            const messages = args.messages ? trMsgs(args.messages) : args.messages
            const changed = prompt !== args.prompt || messages !== args.messages
            if (changed && fits(prompt) && fits(messages?.[0]?.content)) {
                const r = await ctx.generate({ ...args, prompt, messages })
                if (r.status !== "context_overflow") return r
            }
            if (changed) stats.plain++
            return ctx.generate(args)
        },
        chatRaw: async (body) => {
            const messages = trMsgs(body.messages)
            const changed = messages !== body.messages
            if (changed && fits(messages[0].content)) {
                const d = await ctx.chatRaw({ ...body, messages })
                if (!d.error) {
                    if (lpOffset && Array.isArray(d.logprobs)) d.logprobs = d.logprobs.map((t) => ({ ...t, logprob: t.logprob + lpOffset }))
                    return d
                }
            }
            if (changed) stats.plain++
            return ctx.chatRaw(body)
        },
    }
}
const withRewrite = (run, rewrite, opts = {}) => async (ctx, record) => {
    const stats = { n: 0, plain: 0 }
    const out = await run(rewriteCtx(ctx, rewrite, stats, opts), record)
    return { ...out, uRewritten: stats.n, uPlain: stats.plain, ...(opts.lpOffset ? { uLpOffset: opts.lpOffset } : {}) }
}
const rep2 = (p) => repeatPrompt(p)
const rep3 = (p) => repeatPrompt(p, { times: 3 })
// Leviathan et al.'s control: pad the prompt with periods to about the length of the
// repeated prompt (no content added). Any gain it shows is a re-roll of low-margin answers
// (the generation changes, the information does not), the placebo for repetition and CAD.
const pad = (p) => `${". ".repeat(Math.round(p.length / 4))}

${p}`
const goldOnly = async (ctx, record) => {
    const result = await ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(record.path)]) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: [record.path] }
}


// ---- raw-mode generation (/api/generate, raw: true) with the chat template rendered by
// hand. Needed because /api/chat closes a trailing assistant message and starts a new
// turn (no prefill continuation for gemma4). Calls are counted in the result (uRawCalls);
// their time is inside the question's wall time.
export const renderUser = (content) => `<bos><|turn>user\n${content}<turn|>\n<|turn>model\n`
export async function rawGen(ctx, prompt, { numPredict = 160, topK = 0, stats = null } = {}) {
    const t0 = performance.now()
    const res = await fetch(`${ctx.ollamaUrl}/api/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ctx.tag, stream: false, raw: true, keep_alive: "60m", prompt, ...(topK ? { logprobs: true, top_logprobs: topK } : {}), options: generationOptions({ num_predict: numPredict }) }),
    })
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (stats) { stats.calls = (stats.calls ?? 0) + 1; stats.ms = (stats.ms ?? 0) + (performance.now() - t0) }
    const lp = Array.isArray(data.logprobs) ? data.logprobs : []
    return { error: data.error ?? null, text: typeof data.response === "string" ? data.response : "", done: data.done_reason ?? null, pe: data.prompt_eval_count ?? null, peMs: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : null, wall: Math.round(performance.now() - t0), toks: lp.map((t) => t.token), lps: lp.map((t) => t.logprob), tops: lp.map((t) => t.top_logprobs ?? []) }
}

async function probe2(ctx, record) {
    const q = record.question
    const Pc = sandwichPrompt(q, [ctx.emailOf(record.path)])
    const Pq = noContextPrompt(q)
    const out = {}
    out.render1 = await ctx.chatRaw({ messages: [{ role: "user", content: "Q?" }], _debug_render_only: true }).then((d) => d._debug_info?.rendered_template ?? JSON.stringify(d).slice(0, 400))
    const chat = await ctx.chatRaw({ messages: [{ role: "user", content: Pc }], logprobs: true, top_logprobs: 3 })
    out.chat = { answer: chat.message?.content, pe: chat.prompt_eval_count, lp0: chat.logprobs?.[0]?.logprob, n: chat.logprobs?.length }
    const st = {}
    const raw = await rawGen(ctx, renderUser(Pc), { topK: 3, stats: st })
    out.raw = { answer: raw.text, pe: raw.pe, lp0: raw.lps[0], n: raw.toks.length, same: raw.text.trim() === (chat.message?.content ?? "").trim() }
    const pre = raw.toks.slice(0, 4).join("")
    const cont = await rawGen(ctx, renderUser(Pc) + pre, { topK: 3, numPredict: 12 })
    out.cont = { pre, answer: cont.text, pe: cont.pe, peMs: cont.peMs, wall: cont.wall, toks: cont.toks }
    out.qPath = []
    for (let t = 0; t < Math.min(8, raw.toks.length); t++) {
        const r = await rawGen(ctx, renderUser(Pq) + raw.toks.slice(0, t).join(""), { topK: 20, numPredict: 1 })
        out.qPath.push({ wall: r.wall, pe: r.pe, peMs: r.peMs, tok: r.toks[0], top: r.tops[0]?.slice(0, 4).map((a) => [a.token, Math.round(a.logprob * 1000) / 1000]) })
    }
    out.cAfterQ = await rawGen(ctx, renderUser(Pc) + raw.toks.slice(0, 6).join(""), { topK: 20, numPredict: 1 }).then((r) => ({ wall: r.wall, pe: r.pe, peMs: r.peMs, tok: r.toks[0] }))
    // how many positions of the greedy answer have >= 2 plausible tokens (p >= 0.1 p_max)?
    const full = await rawGen(ctx, renderUser(Pc), { topK: 20 })
    out.sites = full.tops.map((top) => top.filter((a) => a.logprob >= top[0].logprob + Math.log(0.1)).length).filter((n) => n >= 2).length
    out.len = full.toks.length
    return { status: "diagnostic", answer: "", probe: out }
}

// ---- Context-aware decoding (Shi et al. 2023) with AdaCAD's adaptive weight (Wang et al.,
// NAACL 2025), fitted to Ollama: no prompt-token logprobs, top_logprobs <= 20, and chat
// does not continue a trailing assistant message, so all calls are raw-mode generations.
// Speculative form: decode greedily with the context (top 20 per position); at every
// position where more than one token is plausible under the context (p >= beta * p_max),
// ask the question-only prompt (sandwich without the emails block) for its next-token
// distribution on the same prefix (1 token); score the plausible tokens by
// (1 + a) log p_c - a log p_q with a = JSD(p_c, p_q) in bits (AdaCAD) or a fixed alpha;
// if the winner is not the greedy token, commit it and re-decode the rest with the
// context. Tokens outside the question-only top 20 get its smallest top-20 logprob (an
// upper bound, so the contrast is conservative). Special tokens are never candidates, so
// the answer stops where greedy decoding would.
const SPECIAL = /^<[^>]*>$|^$/
export function jsdBits(cTop, qTop) {
    const tokens = [...new Set([...cTop.map((a) => a.token), ...qTop.map((a) => a.token)])]
    const dist = (top) => {
        const m = new Map(top.map((a) => [a.token, a.logprob]))
        const floor = Math.min(...top.map((a) => a.logprob))
        const p = tokens.map((t) => Math.exp(m.get(t) ?? floor))
        const z = p.reduce((s, x) => s + x, 0)
        return p.map((x) => x / z)
    }
    const P = dist(cTop), Q = dist(qTop)
    let j = 0
    for (let i = 0; i < tokens.length; i++) {
        const M = (P[i] + Q[i]) / 2
        if (P[i] > 0) j += 0.5 * P[i] * Math.log2(P[i] / M)
        if (Q[i] > 0) j += 0.5 * Q[i] * Math.log2(Q[i] / M)
    }
    return j
}
export async function cadDecode(ctx, Pc, Pq, { beta = 0.1, alpha = null, maxBranches = 4, numPredict = 160 } = {}) {
    const stats = {}
    const C = renderUser(Pc), Q = renderUser(Pq)
    let committed = ""
    let nCommitted = 0
    let r = await rawGen(ctx, C, { numPredict, topK: 20, stats })
    if (r.error) return { status: /exceed|context/i.test(r.error) ? "context_overflow" : "http_error", answer: "", error: String(r.error).slice(0, 300), uRawCalls: stats.calls }
    const greedy = r.text.trim()
    const greedyLp = r.toks.map((token, j) => ({ token, logprob: r.lps[j], top: r.tops[j] }))
    const pe0 = r.pe
    let branches = 0, sites = 0
    const changes = []
    let i = 0
    while (i < r.toks.length) {
        const top = (r.tops[i] ?? []).filter((a) => !SPECIAL.test(a.token))
        const best = top.length ? Math.max(...top.map((a) => a.logprob)) : 0
        const plaus = top.filter((a) => a.logprob >= best + Math.log(beta))
        if (plaus.length >= 2 && branches < maxBranches) {
            sites++
            const prefix = committed + r.toks.slice(0, i).join("")
            const q = await rawGen(ctx, Q + prefix, { numPredict: 1, topK: 20, stats })
            const qTop = q.tops[0] ?? []
            if (qTop.length) {
                const qMap = new Map(qTop.map((a) => [a.token, a.logprob]))
                const floor = Math.min(...qTop.map((a) => a.logprob))
                const a = alpha ?? jsdBits(r.tops[i], qTop)
                const score = (c) => (1 + a) * c.logprob - a * (qMap.get(c.token) ?? floor)
                const choice = plaus.reduce((x, y) => (score(y) > score(x) ? y : x))
                if (choice.token !== r.toks[i]) {
                    changes.push({ at: nCommitted + i, from: r.toks[i], to: choice.token, a: Math.round(a * 1000) / 1000 })
                    committed = prefix + choice.token
                    nCommitted += i + 1
                    branches++
                    r = await rawGen(ctx, C + committed, { numPredict: Math.max(1, numPredict - nCommitted), topK: 20, stats })
                    if (r.error) return { status: "http_error", answer: "", error: String(r.error).slice(0, 300), uRawCalls: stats.calls }
                    i = 0
                    continue
                }
            }
        }
        i++
    }
    const answer = (committed + r.text).trim()
    const status = !answer ? "empty" : r.done === "length" ? "output_limit" : "ok"
    return { status, answer, greedy, greedyLp, pe0, cad: { branches, sites, changes }, uRawCalls: stats.calls, uRawMs: Math.round(stats.ms) }
}
const goldCad = (opts) => async (ctx, record) => {
    const { greedyLp, ...out } = await cadDecode(ctx, sandwichPrompt(record.question, [ctx.emailOf(record.path)]), noContextPrompt(record.question), opts)
    return { ...out, contextPaths: [record.path] }
}
// CAD inside a pipeline: a ctx proxy that answers every sandwich answer call (generate or
// chatRaw with one user message) with cadDecode instead. The question-only prompt is the
// same sandwich prompt without its emails block. For chatRaw callers (x1's commit answer,
// which gates its handover on the mean token logprob), the returned logprobs are the
// greedy pass's, so x1's routing is its own (the gate judges the model's default reading);
// the answer text is CAD's. On an error (e.g. context overflow) the original call is made.
const questionOf = (prompt) => prompt.match(/\nQuestion: (.*)\n/)?.[1] ?? ""
export function cadCtx(ctx, stats, opts = {}) {
    const run = async (prompt, numPredict) => {
        const out = await cadDecode(ctx, prompt, noContextPrompt(questionOf(prompt)), { ...opts, numPredict })
        stats.n++
        stats.raw += out.uRawCalls ?? 0
        stats.branches += out.cad?.branches ?? 0
        if (out.answer !== out.greedy) stats.changed++
        return out
    }
    return {
        ...ctx,
        generate: async (args) => {
            if (!args.prompt || !isSandwich(args.prompt) || args.think) return ctx.generate(args)
            const out = await run(args.prompt, args.options?.num_predict ?? 160)
            if (out.status === "http_error" || out.status === "context_overflow") { stats.plain++; return ctx.generate(args) }
            return { status: out.status, answer: out.answer, cad: out.cad, greedy: out.greedy }
        },
        chatRaw: async (body) => {
            const m = body.messages
            if (!(Array.isArray(m) && m.length === 1 && m[0].role === "user" && isSandwich(m[0].content)) || body.tools || body.format) return ctx.chatRaw(body)
            const out = await run(m[0].content, body.options?.num_predict ?? 160)
            if (out.status === "http_error" || out.status === "context_overflow") { stats.plain++; return ctx.chatRaw(body) }
            const k = body.top_logprobs ?? 0
            return {
                message: { role: "assistant", content: out.answer },
                done_reason: out.status === "output_limit" ? "length" : "stop",
                ...(body.logprobs ? { logprobs: out.greedyLp.map((t) => ({ token: t.token, logprob: t.logprob, top_logprobs: (t.top ?? []).slice(0, k) })) } : {}),
            }
        },
    }
}
const withCad = (run, opts = {}) => async (ctx, record) => {
    const stats = { n: 0, raw: 0, branches: 0, changed: 0, plain: 0 }
    const out = await run(cadCtx(ctx, stats, opts), record)
    return { ...out, uCad: stats, uRawCalls: stats.raw }
}


// ---- x1 + CAD single read of the YES email on sure commits (u-xyc) ----
// Gold-only harness (S300-2/-1/-3, 900 questions): CAD α 0.5 reads the gold email alone at
// 93.5 on hits vs 91.5 plain (+22/−10; the padding placebo +11/−12). On x1's *sure*
// commits whose first YES email is the gold (313 hits), x1 answers over five emails at
// 289 right, the gold read alone at 294 (plain) and 303 (CAD): +15/−1 vs x1, positive on
// each set (+3/−0, +3/−1, +9/−0). So: run x1 unchanged; when it ends on a sure commit,
// re-read its first YES email alone with CAD and use that answer unless it abstains or
// hedges (then x1's answer stays). u-xyc2 also requires the single read's greedy pass to
// be confident (mean token logprob >= -0.1, n's / j2's tau, fixed a priori), which should
// screen YES emails that do not hold the answer (3% of sure-commit hits).
// The extra calls come after all of x1's calls for the question.
const meanOf = (lps) => (lps.length ? lps.reduce((a, b) => a + b, 0) / lps.length : -Infinity)
const yesCad = ({ tau = null } = {}) => async (ctx, record) => {
    const base = await X.x1.run(ctx, record)
    if (base.step !== "commit") return base
    const yesPath = (base.log ?? []).find((l) => l.act === "check" && l.yes)?.path
    if (!yesPath) return base
    const out = await cadDecode(ctx, sandwichPrompt(record.question, [ctx.emailOf(yesPath)]), noContextPrompt(record.question), { alpha: 0.5 })
    const mean = meanOf((out.greedyLp ?? []).map((t) => t.logprob))
    const usable = (out.status === "ok" || out.status === "output_limit") && out.answer && !isAbstain(out.answer) && !HEDGE.test(out.answer)
    const u = { yesPath, x1Answer: base.answer, cadAnswer: out.answer, cadGreedy: out.greedy, cadMean: Math.round(mean * 1000) / 1000, cad: out.cad, uRawCalls: out.uRawCalls, kept: false }
    if (!usable || (tau !== null && mean < tau)) return { ...base, u }
    return { ...base, status: out.status, answer: out.answer, contextPaths: [yesPath], readPaths: [yesPath], used: 1, step: "commit-cad", u: { ...u, kept: true } }
}

export const VARIANTS = {
    "u-probe2": { version: 1, describe: "DIAGNOSTIC: raw-mode /api/generate equivalence with chat, prefill continuation, 1-token call cost, CAD site counts", diagnostic: true, run: probe2 },
    "u-ocad": { version: 1, describe: "DIAGNOSTIC (gold-only harness): oracles with speculative AdaCAD decoding (raw mode; beta 0.1, alpha = JSD bits, <= 4 branches)", diagnostic: true, run: goldCad({}) },
    "u-ocad5": { version: 1, describe: "DIAGNOSTIC (gold-only harness): oracles with speculative CAD, fixed alpha 0.5 (raw mode; beta 0.1, <= 4 branches)", diagnostic: true, run: goldCad({ alpha: 0.5 }) },
    "u-orep": { version: 1, describe: "DIAGNOSTIC (gold-only harness): oracles with prompt repetition (sandwich prompt, 'Let me repeat that:', x2)", diagnostic: true, run: withRewrite(goldOnly, rep2) },
    "u-orep3": { version: 1, describe: "DIAGNOSTIC (gold-only harness): oracles with prompt repetition x3 (verbose)", diagnostic: true, run: withRewrite(goldOnly, rep3) },
    "u-opad": { version: 1, describe: "DIAGNOSTIC (gold-only harness, placebo): oracles with the prompt padded by periods to about the repeated length (Leviathan et al.'s control)", diagnostic: true, run: withRewrite(goldOnly, pad) },
    "u-gcad": { version: 1, describe: "gates with speculative CAD (alpha 0.5, beta 0.1, <= 4 branches; raw mode) on its sandwich answer calls", run: withCad((ctx, record) => BASE.gates.run(ctx, record), { alpha: 0.5 }) },
    "u-xcad": { version: 1, describe: "x1 with speculative CAD (alpha 0.5) on every sandwich answer call (commit, g5 final, explore); x1's handover gate reads the greedy pass's logprobs", run: withCad((ctx, record) => X.x1.run(ctx, record), { alpha: 0.5 }) },
    "u-gpad": { version: 1, describe: "DIAGNOSTIC (placebo, not a candidate): gates with its sandwich prompt padded by periods to about twice its length; measures the re-roll delta of a content-free prompt change", diagnostic: true, run: withRewrite((ctx, record) => BASE.gates.run(ctx, record), pad) },
    "u-xyc": { version: 1, describe: "x1; on a sure commit its first YES email is re-read alone with speculative CAD (alpha 0.5) and that answer replaces x1's unless it abstains or hedges", run: yesCad() },
    "u-xyc2": { version: 1, describe: "u-xyc, the CAD single read kept only if its greedy pass is confident (mean token logprob >= -0.1)", run: yesCad({ tau: -0.1 }) },
    "u-grep": { version: 1, describe: "gates with prompt repetition on every sandwich answer prompt (x2, verbose)", run: withRewrite((ctx, record) => BASE.gates.run(ctx, record), rep2) },
    "u-xrep2": { version: 1, describe: "u-xrep with x1's handover threshold rate-matched for the repeated commit answer (tau -0.11: +0.01 offset on the rewritten call's token logprobs; firstMean is logged with the offset)", run: withRewrite((ctx, record) => X.x1.run(ctx, record), rep2, { lpOffset: 0.01 }) },
    "u-xrep": { version: 1, describe: "x1 with prompt repetition on every sandwich answer prompt (commit, g5 final, explore); probes/picks/tool turns unchanged", run: withRewrite((ctx, record) => X.x1.run(ctx, record), rep2) },
    "u-probe": { version: 1, describe: "DIAGNOSTIC: Ollama API feasibility for decoding-level methods (logprob limits, prefill, cache, raw mode)", diagnostic: true, run: probe },
}
