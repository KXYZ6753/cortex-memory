// Worker b (round 5): in-domain few-shot demonstrations for e2b's answer prompts.
// Notes: docs/premise-study/explore2/b.md. No VARIANTS here (helpers only).
//
// The demonstration bank is DEMO-1 + DEMO-2 (700 questions; training data, never
// evaluated): question, gold email path, gold answer, and gates' first context for the
// question (built offline by tools/b-bank.js into .data/premise2/explore/b-bank.json).
//
// Demos are injected by wrapping ctx (withDemos): every answer call whose prompt is
// gates' sandwich prompt (explore/variants.js sandwichPrompt) gets k demonstrations
// in front of it; every other call (YES/NO probes, list picks, search plans, the g5
// tool turns) passes through unchanged. So the same wrapper serves the gold-only
// harness, gates (one-shot) and x1 (commit answer, explore final answer, g5's final
// sandwich answer) without copying their code.
//
// Honesty rules for demo choice: a demo never comes from the asker's mailbox (TEST
// questions come from other mailboxes than the tuning bank), and never shares the gold
// email, a twin or a near-duplicate with the question.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { sandwichPrompt, clip } from "../../explore/variants.js"
import { questionType } from "../../text.js"

export const BANK_PATH = (dataDir) => join(dataDir, "explore", "b-bank.json")
export const SANDWICH_HEAD = "You answer questions about a person's email archive using only the emails below.\n\nQuestion: "
export const isSandwich = (text) => typeof text === "string" && text.startsWith(SANDWICH_HEAD)

// ---- demo similarity: BM25 over the bank's questions (pure JS, no model) ----
const STOP = new Set("a an the and or of to in on for from by with at as is are was were be been being what who whom whose which when where why how does did do according email emails mail sent send message that this these those it its his her their there about into than then any all can will would could should has have had not mentioned regarding".split(" "))
export const qTokens = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w))

export class DemoIndex {
    constructor(bank, { k1 = 1.2, b = 0.75 } = {}) {
        this.bank = bank
        this.docs = bank.map((d) => qTokens(d.question))
        this.avg = this.docs.reduce((s, t) => s + t.length, 0) / Math.max(1, this.docs.length)
        this.df = new Map()
        for (const t of this.docs) for (const w of new Set(t)) this.df.set(w, (this.df.get(w) ?? 0) + 1)
        this.k1 = k1
        this.b = b
    }
    scores(question) {
        const q = [...new Set(qTokens(question))]
        const N = this.docs.length
        return this.docs.map((doc) => {
            const tf = new Map()
            for (const w of doc) tf.set(w, (tf.get(w) ?? 0) + 1)
            let s = 0
            for (const w of q) {
                const f = tf.get(w)
                if (!f) continue
                const idf = Math.log(1 + (N - this.df.get(w) + 0.5) / (this.df.get(w) + 0.5))
                s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * doc.length / this.avg))
            }
            return s
        })
    }
}

export function loadBank(dataDir) {
    const bank = JSON.parse(readFileSync(BANK_PATH(dataDir), "utf8"))
    return { bank, index: new DemoIndex(bank) }
}
export const bankResource = (ctx) => ctx.resource("b-bank", () => loadBank(ctx.dataDir))

// Hand-picked fixed demos (tools/b-pick.js; keys of DEMO-set questions), in prompt order.
export const FIXED = [
    "dev:love-p/sent_items/428.#0",          // who: forwarding (forward chain, sender vs original sender)
    "test:nemec-g/notes_inbox/258.#0",       // when: date and time from a "Forwarded by" line
    "test:love-p/sent/394.#0",               // url-contact: an extension copied as written (5-2539)
    "test:perlingiere-d/deleted_items/79.#0", // who, two parts, from the quoted original message
    "dev:germany-c/all_documents/3236.#0",   // number
    "test:lewis-a/inbox/36.#0",              // other: a specific name
]

const overlaps = (d, record) => {
    const mine = new Set([record.path, ...(record.twins ?? []), ...(record.nearDups ?? [])])
    return d.excl.some((p) => mine.has(p))
}

// Demo choice for one question. mode: "sim" (BM25 over bank questions), "type" (same
// question type, by similarity), "fixed" (FIXED in order, skipping excluded ones).
// Demos are returned least similar first, so the most similar one sits right before
// the real question. context "ctx5" needs a bank entry whose gates context holds the gold.
// `scores` (optional): a similarity per bank entry (e.g. nomic-embed cosine) replacing BM25.
export function selectDemos({ bank, index }, record, { k = 4, mode = "sim", maxChars = 2500, minChars = 150, context = "gold", maxGold = 400, minGold = 0 } = {}, scores = null) {
    const ok = (d) => d.user !== record.user && !overlaps(d, record) && d.chars <= maxChars && d.chars >= minChars && d.gold.length <= maxGold && d.gold.length >= minGold && (context !== "ctx5" || d.goldInCtx5)
    if (mode === "fixed") {
        const byKey = new Map(bank.map((d) => [d.key, d]))
        return FIXED.map((key) => byKey.get(key)).filter((d) => d && ok(d)).slice(0, k)
    }
    const s = scores ?? index.scores(record.question)
    const type = questionType(record.question)
    let order = bank.map((d, i) => ({ d, s: s[i] })).filter(({ d }) => ok(d))
    if (mode === "type") order = order.filter(({ d }) => d.type === type)
    order.sort((a, b) => b.s - a.s || (a.d.key < b.d.key ? -1 : 1))
    return order.slice(0, k).map(({ d }) => d).reverse()
}

// demo answer text: "gold" verbatim, or "norm" (the trailing ", according to ..." clause
// that only restates the question's source is dropped)
export const demoAnswer = (d, answer = "gold") => (answer === "norm" ? d.gold.replace(/,\s*(according to|as (stated|mentioned|reported|indicated) in)\b[^.,]*\.\s*$/i, ".") : d.gold)

// Chat turns (format "chat") or one inline block (format "inline") for the demos.
// context "ctx5": the demo shows gates' first context for its question (gold inside, the
// other emails are real retrieval distractors), each clipped to clipChars (the gold email
// is never clipped: demo gold emails are <= maxChars <= clipChars).
export function demoTurns(demos, emailOf, { context = "gold", answer = "gold", clipChars = 2500 } = {}) {
    return demos.map((d) => {
        const paths = context === "ctx5" ? d.ctx5 : [d.path]
        const emails = paths.map((p) => (context === "ctx5" && p !== d.path ? clip(emailOf(p), clipChars) : emailOf(p)))
        return { question: d.question, prompt: sandwichPrompt(d.question, emails), emails, answer: demoAnswer(d, answer) }
    })
}

const inlineBlock = (turns) => `Here are solved examples from other people's email archives. Each shows emails, a question and a correct answer.

${turns.map((t, i) => `Example ${i + 1}:
Emails:
<<<EMAILS
${t.emails.map((email, j) => `[${j + 1}]\n${email}`).join("\n\n")}
EMAILS>>>
Question: ${t.question}
Answer: ${t.answer}`).join("\n\n")}

Now answer the real question in the same way.

`

// messages for one sandwich prompt with demos
export function withDemoMessages(turns, prompt, format = "chat") {
    if (!turns.length) return [{ role: "user", content: prompt }]
    if (format === "inline") return [{ role: "user", content: inlineBlock(turns) + prompt }]
    return [...turns.flatMap((t) => [{ role: "user", content: t.prompt }, { role: "assistant", content: t.answer }]), { role: "user", content: prompt }]
}

// Context budget: num_ctx 16384; keep demos + prompt under ~14,500 tokens at a
// conservative 3 chars/token (gates' p99 prompt is ~7,900 tokens); drop the least
// similar demos first.
export const CHAR_BUDGET = 43_500
export function fitTurns(turns, prompt, format) {
    const size = (ts) => withDemoMessages(ts, prompt, format).reduce((s, m) => s + m.content.length, 0)
    let ts = turns
    while (ts.length && size(ts) > CHAR_BUDGET) ts = ts.slice(1)
    return ts
}

// ctx wrapper: sandwich answer prompts get demos; everything else passes through.
// opts: { k, mode, format, context, answer, maxChars }. Records what it did in ctx.bDemo.
// sim "emb": nomic-embed (CPU, ctx.embedQuery) cosine between the question and the bank
// questions; the bank vectors are computed once (also through ctx.embedQuery) and cached
// in .data/premise2/explore/b-bank-emb.json.
const EMB_PATH = (dataDir) => join(dataDir, "explore", "b-bank-emb.json")
const bankVectors = (ctx, bank) => ctx.resource("b-bank-emb", async () => {
    if (existsSync(EMB_PATH(ctx.dataDir))) {
        const cached = JSON.parse(readFileSync(EMB_PATH(ctx.dataDir), "utf8"))
        if (cached.keys?.length === bank.length && cached.keys.every((k, i) => k === bank[i].key)) return cached.vectors
    }
    const vectors = []
    for (const d of bank) vectors.push(Array.from(await ctx.embedQuery(d.question), (x) => Math.round(x * 1e5) / 1e5))
    writeFileSync(EMB_PATH(ctx.dataDir), JSON.stringify({ keys: bank.map((d) => d.key), vectors }))
    return vectors
})
const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

export async function withDemos(ctx, record, opts = {}) {
    const { format = "chat" } = opts
    const bank = await bankResource(ctx)
    let scores = null
    if (opts.sim === "emb" && opts.mode !== "fixed") {
        const vectors = await bankVectors(ctx, bank.bank)
        const q = await ctx.embedQuery(record.question)
        scores = vectors.map((v) => cosine(q, v))
    }
    const demos = selectDemos(bank, record, opts, scores)
    const turns = demoTurns(demos, ctx.emailOf, opts)
    const info = { keys: demos.map((d) => d.key), calls: 0, dropped: 0 }
    const build = (prompt) => {
        const fitted = fitTurns(turns, prompt, format)
        info.calls++
        info.dropped += turns.length - fitted.length
        return withDemoMessages(fitted, prompt, format)
    }
    const wrapped = Object.create(ctx)
    wrapped.generate = (args) => (isSandwich(args.prompt) ? ctx.generate({ ...args, prompt: undefined, messages: build(args.prompt) }) : ctx.generate(args))
    wrapped.chatRaw = (body) => {
        const m = body.messages
        if (Array.isArray(m) && m.length === 1 && m[0].role === "user" && isSandwich(m[0].content)) return ctx.chatRaw({ ...body, messages: build(m[0].content) })
        return ctx.chatRaw(body)
    }
    return { ctx: wrapped, info }
}
