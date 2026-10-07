// Worker s (round 5): does e2b read the gold email better when the task is closer to
// pretraining (cloze / continuation) or to recognition (multiple choice) than to free
// generation? Notes: docs/premise-study/explore2/s.md
//
// s-gold (DIAGNOSTIC, gold-only harness, hits only, not selectable). Every model call is
// preceded by i-det's reset prompt (det mode "all", also in front of the raw-mode calls),
// so each form is computed from cache position 0 and does not depend on earlier calls.
// Forms (one answer each, stored in `renders`; the stored answer is `base`):
//   base   oracles' prompt exactly: sandwichPrompt(question, [gold email]), chat mode
//   pad    placebo: the base prompt padded with periods (u-opad's content-free control)
//   clz    cloze by continuation: e2b first rewrites the question into the beginning of a
//          statement that stops where the answer starts (short call, no email, generic
//          few-shot); the base prompt is then sent in raw mode with the model turn
//          prefilled by that stem; answer = stem + continuation
//   clzb   cloze as an explicit fill-in-the-blank task: "<stem> ___." with the email
//          (statement before and after the email, the question once at the top);
//          answer = the completed statement
//   mc     recognition: for typed questions (who / when / number / url-contact / named
//          entity) candidate spans of that type are extracted from the email
//          deterministically (headers, signatures, regexes), <= 6 options; e2b picks a
//          letter; score = mean log-softmax of each option's letter over two orderings
//          (a hash-shuffled order and its reverse); answer = the clz prefill continued
//          with the chosen span (stem + " " + span + continuation). Where MC does not
//          apply, or its span is what clz generated anyway, the clz answer is copied.
//   yn     recognition, pointwise: per option a YES/NO with the proposed answer before
//          the evidence (l's better form); score = logP(YES) - logP(NO); answer as mc.
// Raw calls (/api/generate raw: true, template rendered by hand as in u-lit.js) are
// counted in sRaw; their time is inside the question's wall time.

import { createHash } from "node:crypto"
import { sandwichPrompt } from "../../explore/variants.js"
import { generationOptions } from "../../ollama.js"
import { questionType, splitFile, parseFileHeader, contentWords } from "../../text.js"
import { renderUser, rawGen } from "./u-lit.js"
import { RESET_PROMPT } from "./i-det.js"
import { segmentThread, cleanName } from "./c-render.js"

const ms = (t0) => Math.round(performance.now() - t0)
const reset = (ctx) => ctx.generate({ prompt: RESET_PROMPT, options: generationOptions({ num_predict: 1 }) })

// ---------------------------------------------------------------- cloze rewrite

// v1/v2 used a completion-style few-shot block in one user turn; e2b echoed the first
// example or the question (S100-0 smoke). v3: the examples are chat turns.
const REWRITE_SYSTEM = "You turn a question into the beginning of a sentence that answers it. The sentence must stop right before the answer, so that the answer can be written next. Use the question's own words. Never answer the question and never add facts. Reply with the sentence beginning only, on one line."
const REWRITE_SHOTS = [
    ["Who sent the memo about the gas storage contract?", "The memo about the gas storage contract was sent by"],
    ["When is the budget review meeting scheduled, according to the email?", "According to the email, the budget review meeting is scheduled for"],
    ["What did Mark ask Susan to do with the draft agreement?", "Mark asked Susan to"],
    ["How much did the company agree to pay for the two turbines?", "For the two turbines, the company agreed to pay"],
    ["What is the phone number of the hotel in Houston mentioned in the email?", "The phone number of the hotel in Houston mentioned in the email is"],
    ["Why was the Thursday conference call postponed, and who will reschedule it?", "The Thursday conference call was postponed because"],
]
export function rewriteMessages(question) {
    return [
        { role: "system", content: REWRITE_SYSTEM },
        ...REWRITE_SHOTS.flatMap(([q, s]) => [{ role: "user", content: `Question: ${q}` }, { role: "assistant", content: s }]),
        { role: "user", content: `Question: ${question}` },
    ]
}
export const FALLBACK_STEM = "The answer is"
// A stem must not carry facts the question does not: at most 3 content words that are
// not in the question (e.g. "scheduled", "sent", "paid"); otherwise the fallback is used.
export function cleanStem(text, question = "") {
    let s = String(text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? ""
    s = s.replace(/^(statement|sentence beginning|sentence start|answer):\s*/i, "").replace(/^["']|["']$/g, "").replace(/\s*(_{2,}|\.{3}|…)\s*\.?$/, "").replace(/[.:]$/, "").trim()
    if (!s || s.length > 400 || /\?$/.test(s) || s.split(/\s+/).length < 2) return null
    if (question) {
        const qw = new Set(contentWords(question))
        const novel = contentWords(s).filter((w) => !qw.has(w) && !/^(sent|send|scheduled|schedule|paid|pay|asked|ask|wrote|write|forwarded|reason|because|person|name|named|answer|date|time|number|amount|phone|address|called|told|said|says|states|stated|mentioned|according)$/.test(w))
        if (novel.length > 3) return null
    }
    return s
}

export function blankPrompt(question, stem, email) {
    return `You fill in the blank in a statement using only the email below.

Question: ${question}
Statement: ${stem} ___.

Rules:
- Replace ___ with the words from the email that make the statement true and answer every part of the question.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the email.
- Reply with the completed statement only.

Email:
<<<EMAILS
[1]
${email}
EMAILS>>>

Statement: ${stem} ___.
Completed statement:`
}

// ---------------------------------------------------------------- candidate spans

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?"
const WDAY = "(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\\.?"
const TIME = "\\d{1,2}(?::\\d{2})?\\s*(?:[AaPp]\\.?[Mm]\\.?)(?:\\s*\\(?(?:CST|CDT|EST|EDT|PST|PDT|MST|MDT|GMT|Central|Eastern|Pacific)\\)?)?|\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*(?:[AaPp]\\.?[Mm]\\.?))?(?:\\s*\\(?(?:CST|CDT|EST|EDT|PST|PDT|MST|MDT|GMT|Central|Eastern|Pacific)\\)?)?"
const RE_DATE = [
    new RegExp(`\\b(?:${WDAY},?\\s+)?${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?(?:,?\\s+(?:at\\s+)?(?:${TIME}))?`, "g"),
    new RegExp(`\\b(?:${WDAY},?\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?`, "g"),
    new RegExp(`\\b(?:${WDAY},?\\s+)?\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?(?:\\s+(?:at\\s+)?(?:${TIME}))?`, "g"),
    new RegExp(`\\b${WDAY}(?:\\s+(?:morning|afternoon|evening|night|lunch(?:\\s*time)?))?(?:,?\\s+(?:at\\s+)?(?:${TIME}))?`, "g"),
    new RegExp(`\\b(?:${TIME})`, "g"),
    new RegExp(`\\b(?:${MONTH})\\s+\\d{4}\\b`, "g"),
    /\b(?:19|20)\d{2}\b/g,
    /\b(?:today|tomorrow|tonight|yesterday|next week|this week|end of (?:the )?(?:day|week|month)|noon)\b/gi,
]
const RE_NUMBER = [
    /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|MM|M|K|k|mm|bn)\b)?(?:\s?(?:\/|per)\s?\w+)?/g,
    /\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|cents?\b|dollars?\b|MW\b|mw\b|MWh\b|mwh\b|MMBtu\b|mmbtu\b|Dth\b|dth\b|bcf\b|Bcf\b|MMcf\b|mmcf\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|people\b|employees\b|questions?\b|deals?\b|points?\b)/g,
    /\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand)\b/g,
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b(?:\s+(?:hundred|thousand|million))?/gi,
    /\b\d[\d,]*(?:\.\d+)?\b/g,
]
const RE_CONTACT = [
    /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
    /(?:https?:\/\/|www\.)[^\s<>"')\]]+/g,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/g,
    /\b(?:ext\.?|x)\s?\d[\d-]{2,6}\b/gi,
    /\b\d{3}[\s.-]\d{4}\b/g,
]
const CAPWORD = "[A-Z][a-zA-Z'\\-]+"
const RE_NAME = new RegExp(`\\b${CAPWORD}(?:\\s+[A-Z]\\.?)?(?:\\s+${CAPWORD}){1,2}\\b`, "g")
const RE_ENTITY = [
    /"[^"\n]{3,80}"/g,
    /\b[\w\-. ]{2,60}\.(?:doc|xls|xlsx|ppt|pdf|txt|zip|htm|html)\b/gi,
    new RegExp(`\\b${CAPWORD}(?:\\s+(?:of|for|and|the|&|de|del)?\\s*${CAPWORD}){0,5}\\b`, "g"),
]
const NOT_NAME = new Set(`the this that these those please thanks thank regards best dear hello hi hey re fw fwd subject from to cc bcc sent date original message forwarded attached attachment monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december enron corp inc llc ltd company north america houston texas california new york let we i you he she they it if and or but for with on at by in of as our your their my his her its all any each every some no yes ok am pm cst est pst us usa ect hou ees ena ews gmt mr ms mrs dr call meeting group team department board office`.split(/\s+/))

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%@./]+/g, " ").trim()
const isQuestionOnly = (span, question) => norm(question).includes(norm(span))

// Typed question: who / when / number / url-contact, or "entity" for name/title-type
// "other" questions. null = no MC for this question.
export function mcType(question) {
    const t = questionType(question)
    if (t !== "other") return t
    if (/\b(?:name|title|called|which (?:company|organi[sz]ation|firm|bank|utility|project|document|file|report|plant|pipeline|newsletter|website|site|city|state|country|group|desk|team|department|product|deal|contract|agreement))\b/i.test(question)) return "entity"
    return null
}

function headerPeople(email) {
    const out = []
    const { header } = splitFile(email)
    const top = parseFileHeader(header)
    const add = (raw, role) => {
        for (const part of String(raw ?? "").split(/\s*[,;]\s*|\s+and\s+/)) {
            const n = cleanName(part).replace(/\s*<[^>]*>$/, "").trim()
            if (n && n.length >= 2 && n.length <= 60 && !/^\d/.test(n)) out.push({ text: n, role })
        }
    }
    add(top.sender, "sender")
    for (const r of top.recipients) add(r, "recipient")
    try {
        for (const b of segmentThread(email).blocks) {
            add(b.from, "from"); add(b.to, "to"); add(b.cc, "cc"); add(b.fwdBy, "fwd"); add(b.sentBy, "sentby")
        }
    } catch { /* segmenter failure: header names only */ }
    return out
}

function matchAll(text, regexes) {
    const out = []
    for (const re of regexes) for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) out.push({ text: m[0].trim(), at: m.index })
    return out
}

// Candidate spans of the question's type, ranked by the question words around their
// occurrences in the email (header names also get a bonus for role words).
export function candidates(question, email, type, { k = 6 } = {}) {
    const raw = []
    if (type === "who") {
        for (const p of headerPeople(email)) raw.push({ text: p.text, role: p.role })
        for (const m of matchAll(email, [RE_NAME])) {
            const words = m.text.split(/\s+/)
            if (words.some((w) => NOT_NAME.has(w.toLowerCase().replace(/\.$/, "")))) continue
            raw.push({ text: m.text })
        }
    } else if (type === "when") raw.push(...matchAll(email, RE_DATE))
    else if (type === "number") raw.push(...matchAll(email, RE_NUMBER))
    else if (type === "url-contact") raw.push(...matchAll(email, RE_CONTACT))
    else if (type === "entity") {
        // body only (the file header's Subject/File lines are not answers), plus the subject
        const { header, body } = splitFile(email)
        const subject = parseFileHeader(header).subject
        for (const m of matchAll(`${subject}\n${body}`, RE_ENTITY)) {
            const words = m.text.replace(/"/g, "").split(/\s+/)
            if (NOT_NAME.has(words[0].toLowerCase()) && (words.length === 1 || !/"/.test(m.text))) continue
            raw.push({ text: m.text })
        }
    }
    // de-duplicate (case/space-insensitive); prefer the longer of nested spans of one type
    const seen = new Map()
    for (const c of raw) {
        const text = c.text.replace(/\s+/g, " ").replace(/[,;:.]+$/, "").trim()
        if (text.length < 2 || text.length > 120) continue
        const key = norm(text)
        if (!key || (type !== "number" && /^\d{1,2}$/.test(key))) continue
        if (!seen.has(key)) seen.set(key, { text, role: c.role ?? null })
    }
    let list = [...seen.values()]
    // drop spans contained in a longer candidate (e.g. "October 2" inside "Monday, October 2, 2000")
    list = list.filter((c) => !list.some((d) => d !== c && norm(d.text).length > norm(c.text).length && ` ${norm(d.text)} `.includes(` ${norm(c.text)} `)))
    // ranking: question content words within +-200 chars of any occurrence
    const qWords = contentWords(question)
    const lower = email.toLowerCase()
    const roleWords = /\b(sent|send|sender|wrote|write|from|forward|forwarded|recipient|received|addressed|to whom|cc|copied)\b/i.test(question)
    const scored = list.map((c) => {
        let best = 0
        const needle = c.text.toLowerCase()
        let at = lower.indexOf(needle)
        let guard = 0
        while (at >= 0 && guard++ < 20) {
            const win = lower.slice(Math.max(0, at - 200), at + needle.length + 200)
            const s = qWords.filter((w) => win.includes(w)).length
            best = Math.max(best, s)
            at = lower.indexOf(needle, at + 1)
        }
        const bonus = c.role && roleWords ? 1.5 : c.role ? 0.5 : 0
        const inQ = isQuestionOnly(c.text, question) ? -2 : 0
        return { ...c, score: best + bonus + inQ }
    })
    scored.sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    return { all: scored, top: scored.slice(0, k) }
}

// The candidate a generated answer commits to: the first candidate (of `list`) that the
// continuation text contains, by position in the text.
export function spanIn(text, list) {
    const t = ` ${norm(text)} `
    let best = null
    for (const c of list) {
        const n = norm(c.text)
        if (!n) continue
        const at = t.indexOf(` ${n} `)
        if (at >= 0 && (best === null || at < best.at || (at === best.at && n.length > norm(best.c.text).length))) best = { c, at }
    }
    return best?.c ?? null
}

// ---------------------------------------------------------------- recognition prompts

const LETTERS = "ABCDEFGH"
export const NONE = "None of the above"
export function mcPrompt(question, email, options) {
    const opts = options.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n")
    return `Answer a multiple-choice question about the email below.

Question: ${question}
Options:
${opts}

Email:
<<<EMAILS
[1]
${email}
EMAILS>>>

Question: ${question}
Options:
${opts}

Which option answers the question according to the email? Reply with only the letter.`
}
export function ynPrompt(question, email, option) {
    return `Question: ${question}
Proposed answer: ${option}

Email:
<<<EMAILS
[1]
${email}
EMAILS>>>

Question: ${question}
Proposed answer: ${option}
Is the proposed answer correct according to this email? Reply with only YES or NO.`
}

const FLOOR = -30
function letterScores(data, n) {
    const top = data?.logprobs?.[0]?.top_logprobs ?? []
    const lp = new Array(n).fill(null)
    for (const t of top) {
        const s = String(t.token).replace(/[\s)*.:]/g, "")
        const i = LETTERS.indexOf(s)
        if (s.length === 1 && i >= 0 && i < n && lp[i] === null) lp[i] = t.logprob
    }
    const filled = lp.map((x) => (x === null ? FLOOR : x))
    const m = Math.max(...filled)
    const z = Math.log(filled.reduce((a, x) => a + Math.exp(x - m), 0)) + m
    return filled.map((x) => x - z)
}
function ynScore(data) {
    const top = data?.logprobs?.[0]?.top_logprobs ?? []
    let yes = null, no = null
    for (const t of top) {
        const s = String(t.token).trim().toUpperCase()
        if (s === "YES" && yes === null) yes = t.logprob
        if (s === "NO" && no === null) no = t.logprob
    }
    return (yes ?? FLOOR) - (no ?? FLOOR)
}
const shuffleOf = (n, seed) => {
    const h = createHash("sha256").update(seed).digest()
    return [...Array(n).keys()].sort((a, b) => h[a] - h[b] || a - b)
}

// ---------------------------------------------------------------- the diagnostic

const pad = (p) => `${". ".repeat(Math.round(p.length / 4))}

${p}`
const r1 = (x) => Math.round(x * 1000) / 1000

async function goldForms(ctx, record, { forms = ["base", "pad", "clz", "clzb", "mc", "yn"] } = {}) {
    if (record.stratum !== "hit") return { status: "skipped", answer: "", contextPaths: [record.path] }
    const q = record.question
    const email = ctx.emailOf(record.path)
    const P = sandwichPrompt(q, [email])
    const renders = {}
    const info = { raw: 0, rawMs: 0, resets: 0, t: {} }
    const chat = async (prompt, options) => { await reset(ctx); info.resets++; return ctx.generate({ prompt, ...(options ? { options } : {}) }) }
    const raw = async (prompt, numPredict = 160) => {
        await reset(ctx); info.resets++
        const r = await rawGen(ctx, prompt, { numPredict })
        info.raw++; info.rawMs += r.wall
        return r
    }
    const lp1 = async (prompt) => { await reset(ctx); info.resets++; return ctx.chatRaw({ messages: [{ role: "user", content: prompt }], logprobs: true, top_logprobs: 20, options: generationOptions({ num_predict: 1 }) }) }
    let t0 = performance.now()
    const b = await chat(P)
    renders.base = { status: b.status, answer: b.answer ?? "" }
    info.t.base = ms(t0)
    if (forms.includes("pad")) {
        t0 = performance.now()
        const r = await chat(pad(P))
        renders.pad = { status: r.status, answer: r.answer ?? "" }
        info.t.pad = ms(t0)
    }
    // cloze stem
    t0 = performance.now()
    await reset(ctx); info.resets++
    const rw = await ctx.generate({ messages: rewriteMessages(q), options: generationOptions({ num_predict: 100 }) })
    const stem = cleanStem(rw.answer, q) ?? FALLBACK_STEM
    info.stem = stem
    info.stemRaw = (rw.answer ?? "").slice(0, 300)
    info.t.rewrite = ms(t0)
    const P0 = renderUser(P)
    let clzText = null
    if (forms.includes("clz") || forms.includes("mc") || forms.includes("yn")) {
        t0 = performance.now()
        const r = await raw(P0 + stem)
        clzText = r.text ?? ""
        const answer = `${stem}${/^[\s,.;:]/.test(clzText) ? "" : " "}${clzText}`.replace(/\s+$/, "")
        renders.clz = { status: r.error ? "http_error" : r.done === "length" ? "output_limit" : "ok", answer }
        info.t.clz = ms(t0)
    }
    if (forms.includes("clzb")) {
        t0 = performance.now()
        const r = await chat(blankPrompt(q, stem, email))
        renders.clzb = { status: r.status, answer: r.answer ?? "" }
        info.t.clzb = ms(t0)
    }
    // recognition
    const type = mcType(q)
    info.type = type
    if ((forms.includes("mc") || forms.includes("yn")) && type) {
        const { all, top } = candidates(q, email, type)
        const options = [...top]
        // make sure the span clz generated is an option (if it is a candidate at all)
        const clzSpan = spanIn(clzText ?? "", all)
        if (clzSpan && !options.some((o) => norm(o.text) === norm(clzSpan.text))) {
            if (options.length >= 6) options.pop()
            options.push(clzSpan)
        }
        info.options = options.map((o) => o.text)
        info.clzSpan = clzSpan?.text ?? null
        info.nCand = all.length
        const finalFor = async (span, name) => {
            if (clzSpan && norm(span) === norm(clzSpan.text)) return { ...renders.clz, copied: "clz" }
            for (const other of ["mc", "yn"]) if (renders[other]?.span && norm(renders[other].span) === norm(span)) return { ...renders[other], copied: other, span }
            const t1 = performance.now()
            const prefix = `${stem} ${span}`
            const r = await raw(P0 + prefix, 120)
            info.t[`${name}Final`] = ms(t1)
            const cont = r.text ?? ""
            return { status: r.error ? "http_error" : "ok", answer: `${prefix}${/^[\s,.;:]/.test(cont) ? "" : " "}${cont}`.replace(/\s+$/, ""), span }
        }
        if (options.length >= 2) {
            if (forms.includes("mc")) {
                t0 = performance.now()
                // the real options in two orderings; "None of the above" is always the last
                // letter (index n); choosing it keeps the clz answer
                const n = options.length
                const order1 = shuffleOf(n, `s-mc|${record.questionKey}`)
                const order2 = [...order1].reverse()
                const sum = new Array(n + 1).fill(0)
                const per = []
                for (const order of [order1, order2]) {
                    const d = await lp1(mcPrompt(q, email, [...order.map((i) => options[i].text), NONE]))
                    const s = letterScores(d, n + 1)
                    per.push([...order, n].map((i, pos) => [i, r1(s[pos])]))
                    ;[...order, n].forEach((i, pos) => { sum[i] += s[pos] / 2 })
                }
                const best = sum.indexOf(Math.max(...sum))
                info.mc = { scores: sum.map(r1), per, pick: best === n ? NONE : options[best].text }
                info.t.mc = ms(t0)
                renders.mc = best === n ? { ...renders.clz, copied: "clz-none" } : { ...(await finalFor(options[best].text, "mc")), span: options[best].text }
            }
            if (forms.includes("yn")) {
                // pointwise; if every option gets more NO than YES, keep the clz answer
                t0 = performance.now()
                const s = []
                for (const o of options) s.push(ynScore(await lp1(ynPrompt(q, email, o.text))))
                const best = s.indexOf(Math.max(...s))
                const none = s[best] < 0
                info.yn = { scores: s.map(r1), pick: none ? NONE : options[best].text }
                info.t.yn = ms(t0)
                renders.yn = none ? { ...renders.clz, copied: "clz-none" } : { ...(await finalFor(options[best].text, "yn")), span: options[best].text }
            }
        }
    }
    // forms that did not act: the clz answer (mc/yn), marked as copied
    for (const name of ["mc", "yn"]) if (forms.includes(name) && !renders[name] && renders.clz) renders[name] = { ...renders.clz, copied: "clz-na" }
    info.rawMs = Math.round(info.rawMs)
    return { status: renders.base.status, answer: renders.base.answer, contextPaths: [record.path], readPaths: [record.path], renders, s: info }
}

export const VARIANTS = {
    "s-gold": { version: 3, diagnostic: true, describe: "DIAGNOSTIC (gold-only harness, hits only; reset before every call as det all): base (oracles prompt), pad (placebo), clz (cloze by stem prefill), clzb (fill-in-the-blank), mc (multiple choice over extracted typed spans + None of the above, letter logprob over two orderings), yn (pointwise YES/NO per option, answer before email; all NO keeps clz); answer = base", run: (ctx, record) => goldForms(ctx, record) },
}

// ---------------------------------------------------------------- refinements (fixed after S300-1)
// S300-1 showed the clz losses concentrate on multi-part questions, where one stem cannot
// hold two slots ("... is, and the name of ... is"), and on the fallback stem. Rules fixed
// at 11:20 ET from S300-1 only, before S300-2 was graded; replayed offline from stored
// renders by tools/s-replay.js (exact: every form is computed behind its own reset).
export const MULTI_PART = /(?:\band\b|,|;)\s+(?:(?:on|in|at|by|for|from|to|with|of|under)\s+)?(?:what|who|whom|whose|when|where|why|how|which)\b|\?.*\?/i
export const isMultiPart = (question) => MULTI_PART.test(question)
