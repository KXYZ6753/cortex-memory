// Worker n6 (round 6): document-contrastive decoding (DCD) for e2b in multi-email contexts.
// Notes: docs/premise-study/explore2/n6.md
//
// u (round 5) showed speculative context-aware decoding (CAD: contrast the email+question
// distribution against the question-only one, alpha 0.5) improves e2b's reading of ONE
// email (gold-only hits +38/-24 over four dev sets) but dies in five-email contexts
// (u-gcad, u-xcad), because "with the five emails vs with none" boosts whatever any of the
// five supports, distractors included. DCD changes the contrast: the full context C against
// the same context with the evidence email removed (R1: C minus E*) or replaced by a
// content-free filler of the same length (F1). That amplifies exactly what E* contributes
// and suppresses tokens the other emails drive.
//
// Speculative form (u's cadDecode, generalised): decode greedily with C (raw mode, top 20 per
// position); at each position where >= 2 non-special tokens are plausible under C
// (p >= beta * p_max), ask the contrast prompt X for its next-token distribution on the same
// prefix (1 token); score the plausible tokens by (1 + a) log p_C - a log p_X (tokens outside
// X's top 20 get X's smallest top-20 logprob, a conservative bound); if the winner is not the
// greedy token, commit it and re-decode the rest with C. <= maxBranches branches.
//
// Determinism (i.md): raw /api/generate calls bypass det(), so the engine puts the det reset
// prompt (rendered by hand, same tokens as det's /api/chat reset) in front of the first call
// of every prompt lineage (the greedy C call and the first call of each contrast prompt).
// Every later call of the question continues one of the question's own cached prompts, so
// nothing depends on earlier questions. The variants are also wrapped in det(mode "all")
// (no ctx model calls on the gates path; it covers any that a parent makes).
//
// n6-gx (DIAGNOSTIC, hits only): gates' exact contexts and abstention retry; the official
//   answer is the greedy pass (= det gates' answer: same prompt, from position 0); logs the
//   answers of several (contrast, alpha) configurations computed in one pass with memoised
//   calls, plus per-config call counts and ms, the greedy mean token logprob (gate signal)
//   and E1. Config answers are graded by tools/n6-grade.js and evaluated by tools/n6-eval.js.
// n6-ox (DIAGNOSTIC, hits only): the same on the gold-only harness (gold email alone;
//   R1 = question-only = classic CAD; F1 = gold replaced by the filler).

import { sandwichPrompt, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { renderUser, noContextPrompt } from "./u-lit.js"
import { det, RESET_PROMPT } from "./i-det.js"
import { createHash } from "node:crypto"

const SPECIAL = /^<[^>]*>$|^$/
const isContent = (t) => /\d/.test(t) || /^\s*[A-Z]/.test(t)
// question-contrast (QN): the same emails with both question slots of the sandwich prompt
// replaced by a neutral request, so the contrast removes what the context makes salient in
// general and keeps what the question asks for (aimed at relation / role errors)
export const NEUTRAL_Q = "What do these emails say?"
const r3 = (x) => Math.round(x * 1000) / 1000
const meanOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// content-free filler of about the email's token length (". " is ~1 token per 2 chars;
// these emails run ~3.5 chars per token)
export const filler = (email) => ". ".repeat(Math.max(1, Math.round(email.length / 3.5))).trim()

async function rawGen(ctx, prompt, { numPredict = 160, topK = 0 } = {}) {
    const t0 = performance.now()
    let data
    try {
        const res = await fetch(`${ctx.ollamaUrl}/api/generate`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: ctx.tag, stream: false, raw: true, truncate: false, keep_alive: "60m", prompt, ...(topK ? { logprobs: true, top_logprobs: topK } : {}), options: generationOptions({ num_predict: numPredict }) }),
        })
        data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        if (!res.ok && !data.error) data.error = `HTTP ${res.status}`
    } catch (e) { data = { error: String(e.message ?? e) } }
    const lp = Array.isArray(data.logprobs) ? data.logprobs : []
    return {
        error: data.error ?? null, text: typeof data.response === "string" ? data.response : "", done: data.done_reason ?? null,
        pe: data.prompt_eval_count ?? null, cached: data.prompt_eval_cached_count ?? null, ms: performance.now() - t0,
        toks: lp.map((t) => t.token), lps: lp.map((t) => t.logprob), tops: lp.map((t) => t.top_logprobs ?? []),
    }
}

// One context (question + email list): memoised greedy pass, continuations and contrast calls.
export class Engine {
    constructor(ctx, question, emails, { beta = 0.1, maxBranches = 4, numPredict = 160 } = {}) {
        Object.assign(this, { ctx, question, emails, beta, maxBranches, numPredict })
        this.C = renderUser(sandwichPrompt(question, emails))
        this.calls = new Map() // key -> { ms, kind, lineage, cached, pe }
        this.memo = new Map()
        this.lineages = new Map() // lineage -> reset ms (once)
    }
    contrastPrompt(name) {
        const q = this.question, e = this.emails
        if (name === "Q") return renderUser(noContextPrompt(q))
        if (name === "R1") return renderUser(e.length > 1 ? sandwichPrompt(q, e.slice(1)) : noContextPrompt(q))
        if (name === "F1") return renderUser(sandwichPrompt(q, [filler(e[0]), ...e.slice(1)]))
        if (name === "QN") return renderUser(sandwichPrompt(NEUTRAL_Q, e))
        throw new Error(`contrast ${name}`)
    }
    async call(key, lineage, prompt, opts) {
        if (this.memo.has(key)) return this.memo.get(key)
        if (!this.lineages.has(lineage)) {
            const r = await rawGen(this.ctx, renderUser(RESET_PROMPT), { numPredict: 1 })
            this.lineages.set(lineage, r.ms)
        }
        const r = await rawGen(this.ctx, prompt, opts)
        this.calls.set(key, { ms: r.ms, lineage, cached: r.cached, pe: r.pe })
        this.memo.set(key, r)
        return r
    }
    greedy() { return this.call("C|", "C", this.C, { numPredict: this.numPredict, topK: 20 }) }
    continuation(committed, nCommitted) { return this.call(`C|${committed}`, "C", this.C + committed, { numPredict: Math.max(1, this.numPredict - nCommitted), topK: 20 }) }
    contrast(name, prefix) { return this.call(`${name}|${prefix}`, name, this.contrastPrompt(name) + prefix, { numPredict: 1, topK: 20 }) }

    // speculative contrastive decode; x = null -> greedy. Returns the answer and the call keys used.
    // contentOnly: only positions where a plausible token is a content token (digit, or starts
    // with a capital: names, numbers, dates, codes) are contrasted.
    async decode({ x = null, alpha = 0.5, contentOnly = false } = {}) {
        const used = new Set(["C|"])
        let r = await this.greedy()
        if (r.error) return { status: /exceed|context|too long/i.test(r.error) ? "context_overflow" : "http_error", answer: "", error: String(r.error).slice(0, 200), used }
        const greedyText = r.text.trim()
        let committed = "", nCommitted = 0, branches = 0, sites = 0
        const changes = []
        let i = 0
        while (x && i < r.toks.length) {
            const top = (r.tops[i] ?? []).filter((a) => !SPECIAL.test(a.token))
            const best = top.length ? Math.max(...top.map((a) => a.logprob)) : 0
            const plaus = top.filter((a) => a.logprob >= best + Math.log(this.beta))
            if (plaus.length >= 2 && branches < this.maxBranches && (!contentOnly || plaus.some((a) => isContent(a.token)))) {
                sites++
                const prefix = committed + r.toks.slice(0, i).join("")
                if (x === "PBO") {
                    // placebo: no contrast; with probability alpha (hash of question + prefix) take a
                    // hash-chosen non-greedy plausible token; same branching machinery and limits
                    const h = createHash("sha256").update(`${this.question}|${prefix}`).digest()
                    const others = plaus.filter((a) => a.token !== r.toks[i])
                    if (others.length && h[0] / 256 < alpha) {
                        const choice = others[h[1] % others.length]
                        changes.push({ at: nCommitted + i, from: r.toks[i], to: choice.token })
                        committed = prefix + choice.token
                        nCommitted += i + 1
                        branches++
                        used.add(`C|${committed}`)
                        r = await this.continuation(committed, nCommitted)
                        if (r.error) return { status: "http_error", answer: "", error: String(r.error).slice(0, 200), used }
                        i = 0
                        continue
                    }
                    i++
                    continue
                }
                used.add(`${x}|${prefix}`)
                const q = await this.contrast(x, prefix)
                const qTop = q.tops[0] ?? []
                if (qTop.length) {
                    const qMap = new Map(qTop.map((a) => [a.token, a.logprob]))
                    const floor = Math.min(...qTop.map((a) => a.logprob))
                    const score = (c) => (1 + alpha) * c.logprob - alpha * (qMap.get(c.token) ?? floor)
                    const choice = plaus.reduce((u, v) => (score(v) > score(u) ? v : u))
                    if (choice.token !== r.toks[i]) {
                        changes.push({ at: nCommitted + i, from: r.toks[i], to: choice.token })
                        committed = prefix + choice.token
                        nCommitted += i + 1
                        branches++
                        used.add(`C|${committed}`)
                        r = await this.continuation(committed, nCommitted)
                        if (r.error) return { status: "http_error", answer: "", error: String(r.error).slice(0, 200), used }
                        i = 0
                        continue
                    }
                }
            }
            i++
        }
        const answer = (committed + r.text).trim()
        const status = !answer ? "empty" : r.done === "length" ? "output_limit" : "ok"
        return { status, answer, greedy: greedyText, branches, sites, changes, used }
    }
    // greedy-pass summary: mean / min token logprob, number of plausible sites
    async greedyStats() {
        const r = await this.greedy()
        const sites = r.tops.filter((top) => {
            const t = top.filter((a) => !SPECIAL.test(a.token))
            if (t.length < 2) return false
            const best = Math.max(...t.map((a) => a.logprob))
            return t.filter((a) => a.logprob >= best + Math.log(this.beta)).length >= 2
        }).length
        return { mean: meanOf(r.lps), min: r.lps.length ? Math.min(...r.lps) : null, n: r.toks.length, sites, cached: r.cached, pe: r.pe }
    }
    costOf(used) {
        let ms = 0, n = 0
        const lin = new Set()
        for (const k of used) { const c = this.calls.get(k); if (!c) continue; ms += c.ms; n++; lin.add(c.lineage) }
        for (const l of lin) ms += this.lineages.get(l) ?? 0
        return { calls: n, resets: lin.size, ms: Math.round(ms) }
    }
}

// gates' contexts (explore/variants.js gatedMailbox with onAbstain + sandwich), rebuilt here
// because gatedMailbox is not exported; tools/n6-check.js verifies the contexts equal det gates'.
export async function gatesContexts(ctx, record) {
    const global = (await ctx.search(record.question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(record.question, 20, record.user)
    const mailbox = byHeaderRank(record.question, mailboxRanked.slice(0, 20), ctx.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    return { contexts: switched ? [mailbox, global] : [global, mailbox], switched }
}

// gates' answer logic over contexts with a per-context decoder (retry once on an exact abstention)
async function gatesWith(contexts, decodeCtx) {
    let res = await decodeCtx(0)
    let used = 1
    while (used < contexts.length && contexts[used].length && res.status === "ok" && isAbstain(res.answer)) {
        res = await decodeCtx(used)
        used++
    }
    return { res, used }
}

export const CONFIGS = {
    R1a25: { x: "R1", alpha: 0.25 }, R1a50: { x: "R1", alpha: 0.5 }, R1a100: { x: "R1", alpha: 1.0 },
    F1a50: { x: "F1", alpha: 0.5 },
    Qa25: { x: "Q", alpha: 0.25 }, Qa100: { x: "Q", alpha: 1.0 },
}

// multi-config diagnostic on gates' contexts (or on the gold email alone with gold: true)
const multi = ({ gold = false, configs = CONFIGS, gateTau = null } = {}) => async (ctx, record) => {
    if (record.stratum !== "hit") return { status: "skipped", answer: "", contextPaths: [] }
    const t0 = performance.now()
    const { contexts, switched } = gold ? { contexts: [[record.path]], switched: false } : await gatesContexts(ctx, record)
    const ctxMs = performance.now() - t0
    const engines = new Map()
    const engineOf = (k) => {
        if (!engines.has(k)) engines.set(k, new Engine(ctx, record.question, contexts[k].map((p) => ctx.emailOf(p))))
        return engines.get(k)
    }
    const run = async (cfg) => {
        const usedByCtx = []
        const { res, used } = await gatesWith(contexts, async (k) => { const d = await engineOf(k).decode(cfg ?? {}); usedByCtx[k] = d.used; return d })
        let ms = 0, calls = 0, resets = 0
        usedByCtx.forEach((u, k) => { if (!u) return; const c = engineOf(k).costOf(u); ms += c.ms; calls += c.calls; resets += c.resets })
        return { res, used, cost: { ms, calls, resets } }
    }
    const base = await run(null)
    const g0 = await engineOf(0).greedyStats()
    const g1 = base.used > 1 ? await engineOf(1).greedyStats() : null
    const cfg = {}
    const gated = gateTau !== null && !((g0.mean ?? 0) < gateTau)
    for (const [name, c] of Object.entries(configs)) {
        if (gated) { cfg[name] = { answer: base.res.answer, status: base.res.status, used: base.used, branches: 0, sites: 0, changes: [], gatedOff: true, ...base.cost }; continue }
        const out = await run(c)
        cfg[name] = { answer: out.res.answer, status: out.res.status, used: out.used, branches: out.res.branches, sites: out.res.sites, changes: out.res.changes, ...out.cost }
    }
    let rawCalls = 0, resets = 0
    for (const e of engines.values()) { rawCalls += e.calls.size; resets += e.lineages.size }
    const final = contexts.slice(0, base.used)
    return {
        status: base.res.status, answer: base.res.answer, contextPaths: contexts[0], readPaths: final.flat(), switched, used: base.used,
        n6: { e1: contexts[base.used - 1][0], greedy: { mean: r3(g0.mean ?? NaN), min: r3(g0.min ?? NaN), n: g0.n, sites: g0.sites, cached: g0.cached, pe: g0.pe }, greedy2: g1 && { mean: r3(g1.mean ?? NaN), n: g1.n }, baseCost: base.cost, ctxMs: Math.round(ctxMs), rawCalls, resets, cfg },
    }
}

// single configuration on gates' contexts: greedy pass, and if (tau === null or the greedy
// mean token logprob < tau) the speculative contrastive decode; otherwise the greedy answer.
// hitsOnly: misses are "skipped" (dev-set runs measure hit points only).
const single = ({ x, alpha, tau = null, hitsOnly = true }) => async (ctx, record) => {
    if (hitsOnly && record.stratum !== "hit") return { status: "skipped", answer: "", contextPaths: [] }
    const t0 = performance.now()
    const { contexts, switched } = await gatesContexts(ctx, record)
    const ctxMs = performance.now() - t0
    const engines = []
    const info = []
    const { res, used } = await gatesWith(contexts, async (k) => {
        const e = (engines[k] = new Engine(ctx, record.question, contexts[k].map((p) => ctx.emailOf(p))))
        const g = await e.greedyStats()
        const fire = tau === null || (g.mean ?? 0) < tau
        const d = await e.decode(fire ? { x, alpha } : {})
        info.push({ k, fired: fire, mean: r3(g.mean ?? NaN), sites: g.sites, greedy: d.greedy, branches: d.branches ?? 0, changes: d.changes ?? [], e1: contexts[k][0], cached: g.cached, pe: g.pe })
        return d
    })
    let rawCalls = 0, resets = 0
    for (const e of engines) if (e) { rawCalls += e.calls.size; resets += e.lineages.size }
    return { status: res.status, answer: res.answer, contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used, n6: { ctxMs: Math.round(ctxMs), rawCalls, resets, info }, n6RawCalls: rawCalls + resets }
}

export const VARIANTS = {
    "n6-gx": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (hits only): gates' contexts behind det, greedy raw pass (= det gates) as the answer; logs DCD answers for R1 (top email removed) a .25/.5/1, F1 (top email -> filler) a .5, classic CAD Q a .25/1 (speculative, beta .1, <= 4 branches, memoised)", run: det(multi({}), { mode: "all" }) },
    "n6-gq": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (hits only): gates' contexts behind det, greedy raw pass (= det gates) as the answer; on unsure answers (greedy mean token logprob < -0.1) logs question-contrastive decodes: contrast vs the same emails under a neutral question (QN) a .5 (pre-registered primary) and a 1.0, and QN a .5 at content positions only", run: det(multi({ gateTau: -0.1, configs: { QNa50: { x: "QN", alpha: 0.5 }, QNa100: { x: "QN", alpha: 1.0 }, QNc50: { x: "QN", alpha: 0.5, contentOnly: true } } }), { mode: "all" }) },
    "n6-g-pbo": { version: 1, describe: "PLACEBO for the gated decoders (not a candidate): gates behind det; on unsure greedy answers (tau -0.1) each plausible position (beta .1) branches with probability 0.25 to a hash-chosen non-greedy plausible token (no contrast; <= 4 branches; ~2.5 branches per fired answer, between R1's 2.0 and Q's 3.0); hits only", run: det(single({ x: "PBO", alpha: 0.25, tau: -0.1 }), { mode: "all" }) },
    "n6-g-r1g": { version: 1, describe: "gates behind det; when the greedy answer is unsure (mean token logprob < -0.1) it is re-decoded with DCD: contrast vs the context without its top email (R1), alpha 0.5, beta .1, <= 4 branches; hits only on dev sets (misses skipped)", run: det(single({ x: "R1", alpha: 0.5, tau: -0.1 }), { mode: "all" }) },
    "n6-g-r1": { version: 1, describe: "gates behind det with DCD on every answer: contrast vs the context without its top email (R1), alpha 0.5; hits only (misses skipped)", run: det(single({ x: "R1", alpha: 0.5 }), { mode: "all" }) },
    "n6-g-q1g": { version: 1, describe: "gates behind det; unsure greedy answers (mean token logprob < -0.1) re-decoded with classic CAD (contrast vs the question-only prompt), alpha 1.0 (chosen on S300-1/2/3 tuning); hits only on dev sets", run: det(single({ x: "Q", alpha: 1.0, tau: -0.1 }), { mode: "all" }) },
    "n6-ox": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (hits only): gold email alone behind det, greedy raw pass (= oracles) as the answer; logs R1 (= classic CAD) a .25/.5/1 and F1 (gold -> filler) a .5", run: det(multi({ gold: true, configs: { R1a25: CONFIGS.R1a25, R1a50: CONFIGS.R1a50, R1a100: CONFIGS.R1a100, F1a50: CONFIGS.F1a50 } }), { mode: "all" }) },
}
