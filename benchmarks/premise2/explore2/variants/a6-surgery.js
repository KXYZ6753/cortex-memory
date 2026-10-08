// Worker a6 (round 6): error-class surgery on hits. See docs/premise-study/explore2/a6.md.
//
// Target class: genuine multi-part questions ("What X, and what Y?"), found by a
// deterministic splitter (splitParts below; s-cloze's isMultiPart also fires on
// "According to X, what ..." preambles, 21% of hits, while real multi-part questions are
// ~8%). On the dev sets every system reads them at 75-78% (vs 89% on the rest) and the
// gold-only oracle at 87% (vs 92%). Every other question keeps its parent's exact prompts.
//
//   a6-det-oracle   DIAGNOSTIC: gold email only, sandwich prompt (= `oracles`), behind det(all);
//                   hits only (misses are "skipped", no call). Gives the gold-only column of
//                   the taxonomy on the dev sets S300-4/5, FULL-2/3, which have no oracle run.
//   a6-gold         DIAGNOSTIC (gold-only harness, split multi-part hits only; reset before every
//                   call): forms stored in `renders`, answer = base:
//                     base   oracles' sandwich prompt
//                     pad    placebo: base prompt padded with periods (u-opad / s-gold)
//                     plist  sandwich prompt whose length rule reads "one or two sentences per
//                            part" and whose final question lists the parts ("The question has 2
//                            parts: 1. ... 2. ... Answer every part.")
//                     dec    one call per part: sandwich prompt with the part as the question and
//                            the full question named once as context; answers joined
//                     decs   one call per part, the part alone as the question; answers joined
//                   a decomposed form whose part answer abstains falls back to base.
//   a6-g-*          end to end on gates behind det(all): gates unchanged; when the question
//                   splits and gates did not abstain, the final context gates read is
//                   re-answered with the form and that answer replaces gates' answer.
//   a6-q-*          the same on q1 behind det(all) (= q-det-q1 on every unsplit question); the
//                   re-answer reads q1's final readPaths (the emails its final answer read: W0
//                   on commits, [E, W0 top 4] on m2 recoveries, g5's reads on handovers).
//   top2 / top3     (added after the first dev replays) the parent's own sandwich prompt over
//                   only the first 2 / 3 emails of its final context: on split hits the gold is
//                   first in ~80% of final contexts, yet read right only ~78% of the time,
//                   against ~93-97% for the gold alone; fewer distractors for this class only.
//   a6-rg-* / a6-rq-*  DEV REPLAYS of a6-g-* / a6-q-* (z-replay.js pattern): read the stored det
//                   parent answer (i-det-gates@2 / q-det-q1@1, same set, set name from the CLI);
//                   unsplit or abstained questions return it unchanged (no call; det makes the
//                   real variant byte-identical there, a6-check.js), split ones run only the
//                   form over the parent's stored final context, behind det. Wall/calls of the
//                   real variant = parent's + the form's (parentWallMs / parentCalls stored).
import { latestAnswers } from "../../explore/grade.js"
import { readFileSync } from "node:fs"
import { attribute } from "./a-common.js"
import { sandwichPrompt } from "../../explore/variants.js"
import { VARIANTS as BASE } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { det } from "./i-det.js"
import { generationOptions } from "../../ollama.js"
import { questionType } from "../../text.js"
import { VARIANTS as Q } from "./q-stack.js"

// ------------------------------------------------------------ the splitter (no model)

const PREP = String.raw`(?:(?:on|in|at|by|for|from|to|with|of|under)\s+)?`
const WH_ALL = /\b(what|who|whom|whose|when|where|why|how|which)\b/i
// "and"-joined parts may start with any wh-word; a bare comma / semicolon only before
// what / who / when / why / how (", which ...", ", where ..." are relative clauses)
const SEP = new RegExp(String.raw`(\s*(?:,\s*and|;\s*and|,\s*as well as|\band)\s+(?=${PREP}(?:what|who|whom|whose|when|where|why|how|which)\b)|\s*[,;]\s+(?=${PREP}(?:what|who|when|why|how)\b))`, "gi")

export function splitParts(question) {
    const s = String(question).trim().replace(/\s+/g, " ")
    const raw = []
    for (const piece of s.split(/\?\s+(?=[A-Z])/)) raw.push(...piece.split(SEP).filter((_, i) => i % 2 === 0))
    // a piece without a wh-word, or shorter than 3 words, is a preamble ("According to X")
    // and is merged into the next part; a trailing one goes to the previous part
    const parts = []
    let carry = ""
    for (const p of raw.map((x) => x.trim()).filter(Boolean)) {
        if (!WH_ALL.test(p) || p.split(/\s+/).length < 3) { carry = carry ? `${carry}, ${p}` : p; continue }
        parts.push(carry ? `${carry}, ${p}` : p)
        carry = ""
    }
    if (carry) { if (parts.length) parts[parts.length - 1] += `, ${carry}`; else parts.push(carry) }
    const clean = parts.map((p) => {
        let x = p.replace(/[\s,;]+$/, "").replace(/^(and|also)\s+/i, "")
        if (!/\?$/.test(x)) x += "?"
        return x[0].toUpperCase() + x.slice(1)
    })
    return clean.length >= 2 ? clean : null
}

// Question cells where the taxonomy (a6.md §1b) shows the gold-only oracle well above every
// system (context-sensitive cells): split multi-part, who, header-field, when. First match wins.
export const HDR_Q = /\bwho (?:sent|wrote|forwarded|is the sender|was the sender|is the author|authored)\b|\b(?:sender|recipients?|addressee)\b|\bto whom\b|\bwho (?:received|was (?:the (?:email|message|memo) )?(?:sent|addressed|forwarded|copied|cc'?d)|were (?:the (?:email|message) )?(?:sent|addressed|copied))\b|\b(?:sent|addressed|forwarded|copied|cc'?d) to\b|\bsubject (?:line|of)\b/i
export function cellOf(question) {
    if (splitParts(question)) return "split"
    const t = questionType(question)
    if (t === "who") return "who"
    if (HDR_Q.test(question)) return "hdr"
    if (t === "when") return "when"
    return null
}

// ------------------------------------------------------------ prompts

const LENGTH_RULE = "- Answer every part of the question in one or two sentences. No preamble."
const pad = (p) => `${". ".repeat(Math.round(p.length / 4))}

${p}`

export function plistPrompt(question, parts, emails) {
    const P = sandwichPrompt(question, emails)
    const at = P.lastIndexOf("\n\nQuestion: ")
    const list = parts.map((p, i) => `${i + 1}. ${p}`).join("\n")
    const head = P.slice(0, at).replace(LENGTH_RULE, "- Answer every part of the question, one or two sentences per part. No preamble.")
    return `${head}\n\nQuestion: ${question}\nThe question has ${parts.length} parts:\n${list}\nAnswer every part.\nAnswer:`
}

export function partPrompt(question, part, k, n, emails) {
    const P = sandwichPrompt(part, emails)
    return P.replace(`Question: ${part}\n\nRules:`, `Question: ${part}\n(This is part ${k} of ${n} of the question: "${question}")\n\nRules:`)
}

const joinAnswers = (answers) => answers.map((a) => a.trim().replace(/\s+/g, " ")).join(" ")

// Answers `question` over `emails` with a decomposed form; null if any part abstains.
async function decomposed(ctx, question, parts, emails, { context = true } = {}) {
    const answers = []
    let status = "ok"
    for (const [i, part] of parts.entries()) {
        const prompt = context ? partPrompt(question, part, i + 1, parts.length, emails) : sandwichPrompt(part, emails)
        const r = await ctx.generate({ prompt })
        if (r.status !== "ok" && r.status !== "output_limit") return { status: r.status, answer: r.answer ?? "", failed: true }
        if (r.status === "output_limit") status = "output_limit"
        if (isAbstain(r.answer)) return null
        answers.push(r.answer ?? "")
    }
    return { status, answer: joinAnswers(answers), parts: answers }
}

export async function formAnswer(ctx, form, question, parts, emails) {
    if (form === "plist") {
        const r = await ctx.generate({ prompt: plistPrompt(question, parts, emails) })
        return { status: r.status, answer: r.answer ?? "" }
    }
    if (form === "dec" || form === "decs") return decomposed(ctx, question, parts, emails, { context: form === "dec" })
    // topK: the parent's sandwich prompt over only the first K emails of its final context
    const top = form.match(/^top([0-9])$/)
    if (top) {
        const r = await ctx.generate({ prompt: sandwichPrompt(question, emails.slice(0, Number(top[1]))) })
        if (r.status === "ok" && isAbstain(r.answer)) return null
        return { status: r.status, answer: r.answer ?? "" }
    }
    throw new Error(`form ${form}`)
}

// ------------------------------------------------------------ diagnostics

async function oracleHit(ctx, record) {
    if (record.stratum !== "hit") return { status: "skipped", answer: "", contextPaths: [record.path] }
    const result = await ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(record.path)]) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: [record.path], readPaths: [record.path] }
}

async function goldForms(ctx, record, { forms = ["pad", "plist", "dec", "decs"] } = {}) {
    const parts = splitParts(record.question)
    if (record.stratum !== "hit" || !parts) return { status: "skipped", answer: "", contextPaths: [record.path] }
    const q = record.question
    const emails = [ctx.emailOf(record.path)]
    const P = sandwichPrompt(q, emails)
    const renders = {}
    const t = {}
    let t0 = performance.now()
    const b = await ctx.generate({ prompt: P })
    renders.base = { status: b.status, answer: b.answer ?? "" }
    t.base = Math.round(performance.now() - t0)
    for (const form of forms) {
        t0 = performance.now()
        if (form === "pad") {
            const r = await ctx.generate({ prompt: pad(P) })
            renders.pad = { status: r.status, answer: r.answer ?? "" }
        } else {
            const r = await formAnswer(ctx, form, q, parts, emails)
            renders[form] = r ?? { ...renders.base, fallback: "abstain" }
        }
        t[form] = Math.round(performance.now() - t0)
    }
    return { status: renders.base.status, answer: renders.base.answer, contextPaths: [record.path], readPaths: [record.path], renders, a6: { parts, t } }
}

// ------------------------------------------------------------ end to end on gates

async function gatesSurgery(ctx, record, { form }) {
    const result = await BASE.gates.run(ctx, record)
    const parts = splitParts(record.question)
    const out = { ...result, a6: { parts, fired: false, parentAnswer: result.answer } }
    if (!parts || result.status !== "ok" || isAbstain(result.answer)) return out
    const final = result.used === 1 ? result.contextPaths : result.readPaths.slice(result.contextPaths.length)
    const r = await formAnswer(ctx, form, record.question, parts, final.map((path) => ctx.emailOf(path)))
    out.a6.fired = true
    if (!r || r.failed) { out.a6.kept = r ? "error" : "abstain"; return out }
    out.a6.kept = form
    out.a6.partAnswers = r.parts ?? null
    return { ...out, status: r.status, answer: r.answer }
}

async function q1Surgery(ctx, record, { form }) {
    const result = await Q.q1.run(ctx, record)
    const parts = splitParts(record.question)
    const out = { ...result, a6: { parts, fired: false, parentAnswer: result.answer } }
    const final = (result.readPaths?.length ? result.readPaths : result.contextPaths) ?? []
    if (!parts || !final.length || result.status !== "ok" || isAbstain(result.answer)) return out
    const r = await formAnswer(ctx, form, record.question, parts, final.map((path) => ctx.emailOf(path)))
    out.a6.fired = true
    out.a6.final = final
    if (!r || r.failed) { out.a6.kept = r ? "error" : "abstain"; return out }
    out.a6.kept = form
    out.a6.partAnswers = r.parts ?? null
    return { ...out, status: r.status, answer: r.answer }
}

const setName = () => (process.argv[2] === "run" ? process.argv[3] : process.env.A6_SET)
async function storedParent(ctx, record, parent) {
    const index = await ctx.resource(`a6-${parent}-${setName()}`, () => {
        const map = new Map()
        for (const a of latestAnswers(ctx.dataDir)) if (`${a.variant}@${a.version}` === parent && a.set === setName()) map.set(a.questionKey, a)
        return { map, close() {} }
    })
    return index.map.get(record.questionKey) ?? null
}
const gatesFinal = (a) => (a.used === 1 ? a.contextPaths : a.readPaths.slice(a.contextPaths.length))
const q1Final = (a) => (a.readPaths?.length ? a.readPaths : a.contextPaths) ?? []

// TRUNC repair: an answer cut at the 160-token limit is re-asked once over the same final
// context (sandwich prompt) with num_predict 400.
async function truncRepair(ctx, question, emails) {
    const r = await ctx.generate({ prompt: sandwichPrompt(question, emails), options: generationOptions({ num_predict: 400 }) })
    return { status: r.status, answer: r.answer ?? "" }
}

async function replaySurgery(ctx, record, { parent, finalOf, form, cells = null }) {
    const a = await storedParent(ctx, record, parent)
    if (!a) return { status: "http_error", answer: "", error: `no stored ${parent} answer` }
    const parts = splitParts(record.question)
    const keep = { status: a.status, answer: a.answer, contextPaths: a.contextPaths, readPaths: a.readPaths, step: a.step ?? null, used: a.used, parentWallMs: a.wallMs, parentCalls: a.calls, parentResets: a.det?.resets ?? 0, a6: { parts, fired: false, replayOf: parent } }
    const final = finalOf(a)
    if (form === "trunc") {
        if (a.status !== "output_limit" || !final?.length) return keep
        const r = await truncRepair(ctx, record.question, final.map((path) => ctx.emailOf(path)))
        keep.a6 = { ...keep.a6, fired: true, final, parentAnswer: a.answer, kept: "trunc" }
        return { ...keep, status: r.status, answer: r.answer }
    }
    const cell = cellOf(record.question)
    if (cells ? !cells.includes(cell) : !parts) return keep
    if (!final?.length || a.status !== "ok" || isAbstain(a.answer)) return keep
    const r = await formAnswer(ctx, form, record.question, parts, final.map((path) => ctx.emailOf(path)))
    keep.a6 = { ...keep.a6, fired: true, cell, final, parentAnswer: a.answer }
    if (!r || r.failed) { keep.a6.kept = r ? "error" : "abstain"; return keep }
    keep.a6.kept = form
    keep.a6.partAnswers = r.parts ?? null
    return { ...keep, status: r.status, answer: r.answer }
}

// ------------------------------------------------------------ the package (config in a6-final.json)
// After the dev replays: (1) TRUNC repair; (2) "top2" for the configured question cells: the
// parent's own sandwich prompt over only the first 2 emails of its final context, except when
// the parent's answer is attributed (a-common attribute, share >= 0.5) to email 3-5 of that
// context (guard: do not drop the email the answer came from). Config read once per run.
const pkgConfig = () => JSON.parse(readFileSync(new URL("./a6-final.json", import.meta.url), "utf8"))
async function pkgOnParent(ctx, record, a, final, cfg) {
    // returns null (keep the parent's answer) or { status, answer, a6 }
    if (cfg.trunc && a.status === "output_limit" && final.length) {
        const r = await truncRepair(ctx, record.question, final.map((path) => ctx.emailOf(path)))
        return { ...r, a6: { fired: true, kept: "trunc" } }
    }
    const cell = cellOf(record.question)
    if (!cell || !cfg.cells.includes(cell) || final.length <= 2 || a.status !== "ok" || isAbstain(a.answer)) return null
    if (cfg.guard) {
        const att = attribute(a.answer, record.question, final, ctx.emailOf)
        if (att && att.index >= 2 && att.share >= 0.5) return null
    }
    const r = await ctx.generate({ prompt: sandwichPrompt(record.question, final.slice(0, 2).map((path) => ctx.emailOf(path))) })
    if (r.status === "ok" && isAbstain(r.answer)) return null
    return { status: r.status, answer: r.answer ?? "", a6: { fired: true, kept: "top2", cell } }
}
async function replayPkg(ctx, record, { parent, finalOf }) {
    const cfg = await ctx.resource("a6-final", () => ({ ...pkgConfig(), close() {} }))
    const a = await storedParent(ctx, record, parent)
    if (!a) return { status: "http_error", answer: "", error: `no stored ${parent} answer` }
    const keep = { status: a.status, answer: a.answer, contextPaths: a.contextPaths, readPaths: a.readPaths, step: a.step ?? null, used: a.used, parentWallMs: a.wallMs, parentCalls: a.calls, parentResets: a.det?.resets ?? 0, a6: { fired: false, replayOf: parent, cfg: { cells: cfg.cells, guard: cfg.guard, trunc: cfg.trunc } } }
    const final = finalOf(a) ?? []
    const r = await pkgOnParent(ctx, record, a, final, cfg)
    if (!r) return keep
    return { ...keep, status: r.status, answer: r.answer, a6: { ...keep.a6, ...r.a6, final, parentAnswer: a.answer } }
}
// deployable versions: the parent runs unchanged, then the package on its result
async function livePkg(ctx, record, { parentRun, finalOf }) {
    const cfg = await ctx.resource("a6-final", () => ({ ...pkgConfig(), close() {} }))
    const a = await parentRun(ctx, record)
    const r = await pkgOnParent(ctx, record, a, finalOf(a) ?? [], cfg)
    return r ? { ...a, status: r.status, answer: r.answer, a6: { ...r.a6, parentAnswer: a.answer } } : { ...a, a6: { fired: false } }
}

export const VARIANTS = {
    "a6-det-oracle": { version: 1, diagnostic: true, describe: "DIAGNOSTIC: gold email only, sandwich prompt (= oracles), behind det(all); hits only", run: det(oracleHit, { mode: "all" }) },
    "a6-gold": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (gold-only harness, multi-part hits by splitParts only; det all): base, pad (placebo), plist (parts listed), dec (one call per part, full question as context, joined), decs (part alone, joined); answer = base", run: det(goldForms, { mode: "all" }) },
    "a6-g-dec": { version: 1, describe: "det gates; multi-part questions (splitParts) re-answered over gates' final context one part per call (full question named as context), answers joined", run: det((ctx, record) => gatesSurgery(ctx, record, { form: "dec" }), { mode: "all" }) },
    "a6-g-plist": { version: 1, describe: "det gates; multi-part questions (splitParts) re-answered over gates' final context with the parts listed and 1-2 sentences per part", run: det((ctx, record) => gatesSurgery(ctx, record, { form: "plist" }), { mode: "all" }) },
    "a6-q-dec": { version: 1, describe: "det q1; multi-part questions (splitParts) re-answered over q1's final readPaths one part per call (full question named as context), answers joined", run: det((ctx, record) => q1Surgery(ctx, record, { form: "dec" }), { mode: "all" }) },
    "a6-q-plist": { version: 1, describe: "det q1; multi-part questions (splitParts) re-answered over q1's final readPaths with the parts listed and 1-2 sentences per part", run: det((ctx, record) => q1Surgery(ctx, record, { form: "plist" }), { mode: "all" }) },
    "a6-rg-dec": { version: 1, diagnostic: true, describe: "DEV REPLAY of a6-g-dec on stored i-det-gates@2+cold (split questions only re-answered, behind det)", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal, form: "dec" }), { mode: "all" }) },
    "a6-rg-plist": { version: 1, diagnostic: true, describe: "DEV REPLAY of a6-g-plist on stored i-det-gates@2+cold", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal, form: "plist" }), { mode: "all" }) },
    "a6-rq-dec": { version: 1, diagnostic: true, describe: "DEV REPLAY of a6-q-dec on stored q-det-q1@1+cold", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final, form: "dec" }), { mode: "all" }) },
    "a6-rq-plist": { version: 1, diagnostic: true, describe: "DEV REPLAY of a6-q-plist on stored q-det-q1@1+cold", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final, form: "plist" }), { mode: "all" }) },
    "a6-rg-trunc": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored i-det-gates@2+cold: answers cut at 160 tokens re-asked over the final context with num_predict 400", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal, form: "trunc" }), { mode: "all" }) },
    "a6-rq-trunc": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored q-det-q1@1+cold: answers cut at 160 tokens re-asked over the final readPaths with num_predict 400", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final, form: "trunc" }), { mode: "all" }) },
    "a6-rg-top2": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored i-det-gates@2+cold: split questions re-answered over the first 2 emails of the final context", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal, form: "top2" }), { mode: "all" }) },
    "a6-rg-top3": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored i-det-gates@2+cold: split questions re-answered over the first 3 emails of the final context", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal, form: "top3" }), { mode: "all" }) },
    "a6-rq-top2": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored q-det-q1@1+cold: split questions re-answered over the first 2 emails of the final readPaths", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final, form: "top2" }), { mode: "all" }) },
    "a6-rq-top3": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored q-det-q1@1+cold: split questions re-answered over the first 3 emails of the final readPaths", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final, form: "top3" }), { mode: "all" }) },
    "a6-rg-top2x": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored i-det-gates@2+cold: who / header-field / when questions (not split) re-answered over the first 2 emails of the final context (compose with a6-rg-top2 for split ones)", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal, form: "top2", cells: ["who", "hdr", "when"] }), { mode: "all" }) },
    "a6-rq-top2x": { version: 1, diagnostic: true, describe: "DEV REPLAY on stored q-det-q1@1+cold: who / header-field / when questions (not split) re-answered over the first 2 emails of the final readPaths (compose with a6-rq-top2)", run: det((ctx, record) => replaySurgery(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final, form: "top2", cells: ["who", "hdr", "when"] }), { mode: "all" }) },
    "a6-rg-pkg": { version: 1, diagnostic: true, describe: "REPLAY on stored i-det-gates@2+cold of the a6 package (a6-final.json: TRUNC repair + top2 for the configured cells, attribution guard)", run: det((ctx, record) => replayPkg(ctx, record, { parent: "i-det-gates@2+cold", finalOf: gatesFinal }), { mode: "all" }) },
    "a6-rq-pkg": { version: 1, diagnostic: true, describe: "REPLAY on stored q-det-q1@1+cold of the a6 package (a6-final.json)", run: det((ctx, record) => replayPkg(ctx, record, { parent: "q-det-q1@1+cold", finalOf: q1Final }), { mode: "all" }) },
    "a6-g-pkg": { version: 1, describe: "det gates + the a6 package (a6-final.json: TRUNC repair + top2 for the configured cells, attribution guard)", run: det((ctx, record) => livePkg(ctx, record, { parentRun: (c, r) => BASE.gates.run(c, r), finalOf: gatesFinal }), { mode: "all" }) },
    "a6-q-pkg": { version: 1, describe: "det q1 + the a6 package (a6-final.json)", run: det((ctx, record) => livePkg(ctx, record, { parentRun: (c, r) => Q.q1.run(c, r), finalOf: q1Final }), { mode: "all" }) },
}
