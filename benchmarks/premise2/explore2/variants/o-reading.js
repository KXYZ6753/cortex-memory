// Phase-2 one-shot reading variants (prefix o). Retrieval, gating and the abstention
// retry are gates' (explore/variants.js gatedMailbox, copied here so the prompt /
// context builder is pluggable); only how the emails are presented changes.
// Notes: docs/premise-study/explore2/o.md

import { ABSTAIN, isAbstain } from "../../prompts.js"
import { byHeaderRank, sandwichPrompt } from "../../explore/variants.js"

// gates' retrieval + gate + retry. `present(question, paths, ctx)` returns
// { prompt } or { messages } for one context; `prepare(paths, ctx, record)` may
// rewrite a context's path list (dedup etc.) before it is shown.
async function gatedReading(ctx, record, { present, prepare = (paths) => paths, options } = {}) {
    const globalRanked = await ctx.search(record.question, 20)
    const mailboxRanked = await ctx.search(record.question, 20, record.user)
    const mailboxOrdered = byHeaderRank(record.question, mailboxRanked, ctx.emailOf)
    const global = { shown: globalRanked.slice(0, 5), ranked: globalRanked, kind: "global" }
    const mailbox = { shown: mailboxOrdered.slice(0, 5), ranked: mailboxOrdered, kind: "mailbox" }
    const switched = !global.shown[0]?.startsWith(`${record.user}/`)
    const contexts = (switched ? [mailbox, global] : [global, mailbox]).map(({ shown, ranked, kind }) => prepare(shown, ctx, ranked, kind))
    const ask = (paths) => ctx.generate({ ...present(record.question, paths, ctx), ...(options ? { options } : {}) })
    let result = await ask(contexts[0])
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ask(contexts[used])
        used++
    }
    return { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, used }
}

const emailsOf = (paths, ctx) => paths.map((path) => ctx.emailOf(path))
const block = (emails) => `<<<EMAILS\n${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}\nEMAILS>>>`

// o1: the sandwich prompt with the length rule replaced by a concision rule. FULL-0
// failure analysis: gates' hit answers with an added source / extra sentence were
// 85.5% correct vs 91.2% for the rest; J1 marks unrequested extra details wrong.
const CONCISE_RULES = `Rules:
- Answer only what the question asks, covering every part of it, in one sentence (two only if the question asks for several things).
- Do not add other details, and do not say which email or sender the answer came from.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ${ABSTAIN}`

export function concisePrompt(question, emails) {
    return `You answer questions about a person's email archive using only the emails below.

Question: ${question}

${CONCISE_RULES}

Emails:
${block(emails)}

Question: ${question}
Answer:`
}

// o2: chat format. System message: role and T2 rules; user message: question,
// emails, question (the sandwich's content, split by role).
const T2_RULES = `Rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ${ABSTAIN}`

export function chatMessages(question, emails, rules = T2_RULES) {
    return [
        { role: "system", content: `You answer questions about a person's email archive using only the emails the user gives you.\n\n${rules}` },
        { role: "user", content: `Question: ${question}\n\nEmails:\n${block(emails)}\n\nQuestion: ${question}\nAnswer:` },
    ]
}

// o3: near-duplicate removal. An email whose body is ≥ 80% contained (5-word
// shingles) in another shown email is dropped (the containing one keeps every word),
// and the slot is refilled from the same ranked list. FULL-0: near-duplicate pairs in
// 30% of gates' hit contexts (thread copies, replies quoting the original).
const bodyOf = (email) => String(email).split(/\n=====+\n/).slice(1).join("\n").toLowerCase().replace(/\s+/g, " ").trim()
function shingles(email) {
    const words = bodyOf(email).split(" ")
    const set = new Set()
    for (let index = 0; index + 5 <= words.length; index++) set.add(words.slice(index, index + 5).join(" "))
    return set
}
const contained = (a, b) => { // share of a's shingles found in b
    if (!a.size) return 0
    let shared = 0
    for (const item of a) if (b.has(item)) shared++
    return shared / a.size
}
export function dedupContext(paths, ctx, ranked, { k = 5, threshold = 0.8 } = {}) {
    const cache = new Map()
    const sh = (path) => (cache.has(path) ? cache.get(path) : cache.set(path, shingles(ctx.emailOf(path))).get(path))
    const kept = []
    const candidates = [...paths, ...ranked.filter((path) => !paths.includes(path))]
    for (const path of candidates) {
        if (kept.length >= k) break
        const mine = sh(path)
        const dupOf = kept.findIndex((other) => contained(mine, sh(other)) >= threshold || contained(sh(other), mine) >= threshold)
        if (dupOf < 0) { kept.push(path); continue }
        // Keep the more complete of the two, in the earlier slot.
        const other = kept[dupOf]
        if (mine.size > sh(other).size && contained(sh(other), mine) >= threshold) kept[dupOf] = path
    }
    return kept
}

// Dedup applied to the mailbox context only.
const mailboxOnlyDedup = () => (paths, ctx, ranked, kind) => (kind === "mailbox" ? dedupContext(paths, ctx, ranked) : paths)

// o4: rules moved after the emails, right before the final question
// (question, emails, rules, question).
export function rulesLastPrompt(question, emails, rules = T2_RULES) {
    return `You answer questions about a person's email archive using only the emails below.

Question: ${question}

Emails:
${block(emails)}

${rules}

Question: ${question}
Answer:`
}

// Deterministic post-processing: drop sentences after the first that only say where
// the answer came from ("This was mentioned in the email from …", "This information is found in email [2].").
// Narrow on purpose: FULL-0 showed that cutting every "also/additionally" sentence
// would also cut correct second parts (oracles' cut-affected answers were 96% right).
const SOURCE = /^(this|that|these|the (above|information|answer|detail|request|date|event|address|number|subject|statement)|it)\b[^.]{0,60}\b(is|was|are|were|can be|appears?)\b[^.]{0,20}\b(mentioned|stated|found|noted|indicated|given|shared|listed|written|included|referenced|appears|contained)\b[^.]*\b(e-?mails?|message|thread|subject|note)\b/i
export function cutSource(answer) {
    const parts = String(answer ?? "").trim().split(/(?<=[a-z0-9)"'][.!?])\s+(?=[A-Z])/)
    if (parts.length < 2) return answer
    const kept = [parts[0], ...parts.slice(1).filter((sentence) => !SOURCE.test(sentence.trim()))]
    return kept.join(" ")
}

// o5: one worked example as a prior chat turn (synthetic emails, not from the corpus):
// same sandwich format, a distractor email from the same thread, and an answer that
// covers both parts, copies the figures exactly and does not cite its source.
const DEMO_EMAILS = [
    `Subject: Storage contract
Sender: mary.smith@enron.com
Recipients: ['john.doe@enron.com']
File: smith-m/sent/12.
=====================================
John,

Can you check whether Northwind will extend the storage contract past December? The current rate is $0.15/MMBtu.

Thanks,
Mary
=====================================`,
    `Subject: Re: Storage contract
Sender: john.doe@enron.com
Recipients: ['mary.smith@enron.com']
File: doe-j/sent/48.
=====================================
Mary,

Northwind agreed to extend the storage contract through March 31, 2002 at $0.12/MMBtu. Legal will send the amendment on Friday.

John
=====================================`,
]
const DEMO_QUESTION = "According to John's reply about the storage contract, until when was the contract extended and at what rate?"
const DEMO_ANSWER = "Northwind extended the storage contract through March 31, 2002 at $0.12/MMBtu."
export const demoMessages = (question, emails) => [
    { role: "user", content: sandwichPrompt(DEMO_QUESTION, DEMO_EMAILS) },
    { role: "assistant", content: DEMO_ANSWER },
    { role: "user", content: sandwichPrompt(question, emails) },
]

// o7: the sandwich taken further: the question is restated after every email, so
// each email is read right next to it.
export function interleavedPrompt(question, emails) {
    return `You answer questions about a person's email archive using only the emails below.

Question: ${question}

${T2_RULES}

Emails:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}\n(Question: ${question})`).join("\n\n")}
EMAILS>>>

Question: ${question}
Answer:`
}

export const VARIANTS = {
    o1: { version: 1, describe: "gates with a concision rule (one sentence, every part, no extra details or source) replacing the length rule", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: concisePrompt(q, emailsOf(paths, c)) }) }) },
    o2: { version: 1, describe: "gates in chat format: rules in a system message, question+emails+question in the user message", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ messages: chatMessages(q, emailsOf(paths, c)) }) }) },
    o3: { version: 1, describe: "gates with near-duplicate emails (>=80% shingle containment) removed and slots refilled from the same ranking", run: (ctx, record) => gatedReading(ctx, record, { prepare: dedupContext, present: (q, paths, c) => ({ prompt: sandwichPrompt(q, emailsOf(paths, c)) }) }) },
    o4: { version: 1, describe: "gates prompt with the rules moved after the emails (question, emails, rules, question)", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: rulesLastPrompt(q, emailsOf(paths, c)) }) }) },
    o5: { version: 1, describe: "gates with one synthetic worked example (sandwich prompt + answer) as a prior chat turn", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ messages: demoMessages(q, emailsOf(paths, c)) }) }) },
    o6: { version: 1, describe: "gates with source-attribution sentences ('This was mentioned in the email from ...') cut from the answer after the first sentence", run: async (ctx, record) => {
        const out = await gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: sandwichPrompt(q, emailsOf(paths, c)) }) })
        return { ...out, rawAnswer: out.answer, answer: cutSource(out.answer) }
    } },
    o7: { version: 1, describe: "gates prompt with the question also restated after every email", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: interleavedPrompt(q, emailsOf(paths, c)) }) }) },
    o8: { version: 1, describe: "o4 (rules after the emails) + o6's source-attribution cut", run: async (ctx, record) => {
        const out = await gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: rulesLastPrompt(q, emailsOf(paths, c)) }) })
        return { ...out, rawAnswer: out.answer, answer: cutSource(out.answer) }
    } },
    o9: { version: 1, describe: "gates prompt telling the model the emails are sorted by relevance, most relevant first", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: sandwichPrompt(q, emailsOf(paths, c)).replace("using only the emails below.", "using only the emails below. The emails are sorted by relevance to the question, most relevant first.") }) }) },
    o10: { version: 1, describe: "o4 (rules after the emails) with the relevance-order sentence of o9", run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: rulesLastPrompt(q, emailsOf(paths, c)).replace("using only the emails below.", "using only the emails below. The emails are sorted by relevance to the question, most relevant first.") }) }) },
    // o3 on S300-2: misses +6/−0 vs gates (dedup frees mailbox slots), hits +0/−2. o11/o12
    // dedup only the mailbox context (switched first contexts and abstention retries).
    o11: { version: 1, describe: "gates with o3's near-duplicate removal on the mailbox context only", run: (ctx, record) => gatedReading(ctx, record, { prepare: mailboxOnlyDedup(record), present: (q, paths, c) => ({ prompt: sandwichPrompt(q, emailsOf(paths, c)) }) }) },
    o12: { version: 1, describe: "o11 with o4's prompt (rules after the emails)", run: (ctx, record) => gatedReading(ctx, record, { prepare: mailboxOnlyDedup(record), present: (q, paths, c) => ({ prompt: rulesLastPrompt(q, emailsOf(paths, c)) }) }) },
    o13: { version: 1, describe: "o12 (rules after the emails, mailbox dedup) with the relevance-order sentence of o9", run: (ctx, record) => gatedReading(ctx, record, { prepare: mailboxOnlyDedup(record), present: (q, paths, c) => ({ prompt: rulesLastPrompt(q, emailsOf(paths, c)).replace("using only the emails below.", "using only the emails below. The emails are sorted by relevance to the question, most relevant first.") }) }) },
    oref: { version: 1, describe: "DIAGNOSTIC: gates re-implemented through gatedReading (must match gates up to e2b noise)", diagnostic: true, run: (ctx, record) => gatedReading(ctx, record, { present: (q, paths, c) => ({ prompt: sandwichPrompt(q, emailsOf(paths, c)) }) }) },
}
