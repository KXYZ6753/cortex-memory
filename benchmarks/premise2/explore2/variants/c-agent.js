// Worker c (round 5): end-to-end presentation variants on top of gates and x1, without
// copying either. docs/premise-study/explore2/c.md
//
// renderingCtx(ctx, opts) wraps a run ctx so that every ANSWER prompt the wrapped variant
// sends (gates' sandwich prompt; in x1: the commit answer, the explore final answer and
// g5's final answer, all sandwichPrompt over whole emails) is rebuilt with c-render.js's
// cPrompt(question, emails, opts). A prompt is rebuilt only if it parses back exactly:
// sandwichPrompt(question, parsedEmails) must reproduce it byte for byte. Everything else
// (YES/NO probes, list picks, plans, the g5 tool turns, retrieval, the cross-encoder)
// is untouched, so only the reading prompts change.
import { join } from "node:path"
import { sandwichPrompt } from "../../explore/variants.js"
import { VARIANTS as BASE } from "../../explore/variants.js"
import { loadReranker } from "../../rerank.js"
import { cPrompt, keyLines, lexScores } from "./c-render.js"
import { questionType } from "../../text.js"
import { VARIANTS as X } from "./x-agent.js"

const HEAD = "You answer questions about a person's email archive using only the emails below.\n\nQuestion: "

// Parse a sandwich prompt back into { question, emails }; null if it is not one.
export function parseSandwich(prompt) {
    if (typeof prompt !== "string" || !prompt.startsWith(HEAD)) return null
    const question = prompt.slice(HEAD.length, prompt.indexOf("\n", HEAD.length))
    const open = prompt.indexOf("<<<EMAILS\n")
    const close = prompt.lastIndexOf("\nEMAILS>>>")
    if (open < 0 || close < open) return null
    const block = prompt.slice(open + "<<<EMAILS\n".length, close)
    if (!block.startsWith("[1]\n")) return null
    const emails = []
    let at = 4
    for (let i = 2; ; i++) {
        const mark = `\n\n[${i}]\n`
        const next = block.indexOf(mark, at)
        if (next < 0) { emails.push(block.slice(at)); break }
        emails.push(block.slice(at, next))
        at = next + mark.length
    }
    return sandwichPrompt(question, emails) === prompt ? { question, emails } : null
}

const ceScorer = (ctx) => async (question, texts) => {
    const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
    const started = performance.now()
    const scores = await model.score(question, texts)
    ctx.ceMs = (ctx.ceMs ?? 0) + performance.now() - started
    return scores
}

// opts: { render, keys: 0 | k, scorer: "lex" | "ce", hint, only: null | [question types] }
export function renderingCtx(ctx, opts = {}) {
    const stats = { rebuilt: 0, kept: 0 }
    const rebuild = async (prompt) => {
        const parsed = parseSandwich(prompt)
        if (!parsed || (opts.only && !opts.only.includes(questionType(parsed.question)))) { stats.kept++; return prompt }
        const keys = opts.keys ? await keyLines(parsed.question, parsed.emails, { k: opts.keys, scorer: opts.scorer === "ce" ? ceScorer(ctx) : lexScores }) : null
        const out = cPrompt(parsed.question, parsed.emails, { render: opts.render ?? "r0", keys, hint: opts.hint ?? false })
        stats.rebuilt++
        return out
    }
    const wrapped = Object.create(ctx)
    wrapped.generate = async (args) => (args?.prompt ? ctx.generate({ ...args, prompt: await rebuild(args.prompt) }) : ctx.generate(args))
    wrapped.chatRaw = async (body) => {
        const m = body?.messages
        if (!body?.tools && Array.isArray(m) && m.length === 1 && m[0].role === "user") {
            const content = await rebuild(m[0].content)
            if (content !== m[0].content) return ctx.chatRaw({ ...body, messages: [{ ...m[0], content }] })
        }
        return ctx.chatRaw(body)
    }
    wrapped.cStats = stats
    return wrapped
}

const wrap = (base, opts) => async (ctx, record) => {
    const c = renderingCtx(ctx, opts)
    const out = await base.run(c, record)
    return { ...out, c: { ...c.cStats, ceMs: Math.round(c.ceMs ?? 0), opts } }
}

export const OPTS = {
    T: { render: "thread1" },             // thread labels on chain emails only
    K: { keys: 3, scorer: "ce" },          // CE key-line excerpt after the emails
    TK: { render: "thread1", keys: 3, scorer: "ce" },
    C: { render: "chrono" },               // chronological thread (oldest first) on chain emails only
    W: { render: "thread1", hint: 2, only: ["who"] },   // who-questions only: thread labels + relation rule
    WC: { render: "chrono", hint: 2, only: ["who"] },
}

export const VARIANTS = {
    "c-gT": { version: 2, describe: "gates with thread labels on chain emails (c-render thread1) in every answer prompt", run: wrap(BASE.gates, OPTS.T) },
    "c-xT": { version: 2, describe: "x1 with thread labels on chain emails (c-render thread1) in every answer prompt (commit, explore final, g5 final)", run: wrap(X.x1, OPTS.T) },
    "c-gC": { version: 1, describe: "gates with chain emails rendered as a chronological labelled thread (oldest first) in every answer prompt", run: wrap(BASE.gates, OPTS.C) },
    "c-xC": { version: 1, describe: "x1 with chain emails rendered as a chronological labelled thread in every answer prompt", run: wrap(X.x1, OPTS.C) },
    "c-gK": { version: 1, describe: "gates + CE key-unit excerpt (k=3, '[i, from sender] \"unit\"') after the emails in every answer prompt", run: wrap(BASE.gates, OPTS.K) },
    "c-xK": { version: 1, describe: "x1 + CE key-unit excerpt (k=3) after the emails in every answer prompt", run: wrap(X.x1, OPTS.K) },
    "c-gW": { version: 1, describe: "gates; who-questions only: thread labels on chain emails + a relation rule (each message has its own From/To; I = sender, you = recipient)", run: wrap(BASE.gates, OPTS.W) },
    "c-xW": { version: 1, describe: "x1; who-questions only: thread labels on chain emails + the relation rule", run: wrap(X.x1, OPTS.W) },
}

// ---- config-driven slots (the GPU queue is hours long: slots are queued early and
// pointed at the chosen configuration before they start). The configuration is read
// from c-final.json when each question runs and is stored with every answer (c.cfg).
// Rule kept by hand: a slot's configuration is fixed before its first run starts and
// never changed afterwards; the final configurations are pinned below as c-fin*-pinned
// notes in c.md.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const CFG_URL = new URL("./c-final.json", import.meta.url)
const cfgOf = (id) => {
    const text = readFileSync(CFG_URL, "utf8")
    const c = JSON.parse(text)[id]
    if (!c) throw new Error(`c-final.json has no entry for ${id}`)
    return { ...c, hash: createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 8) }
}
const slot = (id) => ({
    version: 1,
    describe: `config-driven slot (variants/c-final.json "${id}"): base gates or x1, renderingCtx options`,
    run: async (ctx, record) => {
        const c = cfgOf(id)
        const base = c.base === "gates" ? BASE.gates : X.x1
        const out = await wrap(base, c.opts)(ctx, record)
        return { ...out, c: { ...out.c, cfg: c.hash, base: c.base } }
    },
})
VARIANTS["c-fin1"] = slot("c-fin1")
VARIANTS["c-fin2"] = slot("c-fin2")
VARIANTS["c-fin3"] = slot("c-fin3")
VARIANTS["c-fin4"] = slot("c-fin4")

// Composition with worker b's few-shot demonstrations (b-common.js withDemos, which turns
// a sandwich answer prompt into demo turns + the prompt). The rendering wrapper must be
// the OUTER one: it rebuilds the sandwich prompt the base variant sends (labels), and b's
// wrapper, which accepts any prompt starting with the sandwich head, then adds the demos.
// (The demo emails themselves stay R0 unless b's demoTurns renders them, e.g. with
// renderEmail(email, { render: "thread1" }).) Not registered as a variant: b's chosen
// demo options are b's call. Usage: run: (ctx, record) => withRenderAndDemos(X.x1, ctx, record, { render: "thread1" }, demoOpts)
export async function withRenderAndDemos(base, ctx, record, renderOpts, demoOpts = {}) {
    const { withDemos } = await import("./b-common.js")
    const d = await withDemos(ctx, record, demoOpts)
    const c = renderingCtx(d.ctx, renderOpts)
    const out = await base.run(c, record)
    return { ...out, c: { ...c.cStats, opts: renderOpts }, demos: d.info }
}
