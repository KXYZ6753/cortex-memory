// Worker h, round 4: hit-side reading on x1's unsure-commit (handover) path.
// Notes: docs/premise-study/explore2/h.md (section "Round 4").
//
// Base = j2 (variants/j-reread.js): x1; an unsure committed answer (gates' answer over W0
// with mean token logprob < -0.1, a hedge or an abstention) is re-read from the first YES
// email alone and kept if that single read is confident (>= -0.1), else x1's g5 handover.
// Offline (tools/h-handover.js, h-agree.js, h-vague.js): on the handover path, answers
// that are vague ("something", "the website", "a report", "does not specify", a leaked
// path) are right only ~1/3 of the time on hits, although the YES email names the
// specific thing in 5 of the 6 wrong cases checked (light rail, Midmarket, AOPL's
// website, Deal Volume Tracking report, the sick-time question).
//
//   h7  j2 + specificity re-ask: on the handover path only, when the final answer is
//       vague / hedged / leaks a path, ask once more over the YES email with a prompt
//       that demands the exact name/number/date/document as written; the new answer
//       replaces the old one only if it is usable (not abstained, hedged or vague) and
//       adds a specific token (capitalised word, number, URL, quoted span) that the old
//       answer and the question lack.
//   h8  h7 + YES-filtered context (hypothesis a): on unsure commits the rest of W0 is
//       probed (x1's YES/NO probe); with >= 2 YES emails the question is first answered
//       over the YES emails only (rank order, sandwich prompt) and that answer is kept if
//       confident (>= -0.1, no hedge/abstention); otherwise j2's cascade (single read of
//       the first YES email if confident, else g5). The specificity re-ask then reads
//       the YES emails.
// Every path other than the handover is x1 byte for byte (same calls in the same order);
// the handover path is j2's until the extra steps.
import { sandwichPrompt, byHeaderRank, clip } from "../../explore/variants.js"
import { isAbstain, ABSTAIN } from "../../prompts.js"
import { lpCall, meanLp, HEDGE } from "./n-conf.js"
import { relevancePrompt } from "./w-map.js"
import { VARIANTS as X } from "./x-agent.js"
import { VARIANTS as G } from "./g-agent.js"
import { VARIANTS as J } from "./j-reread.js"

const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
const MARK = Symbol("h-handover")
const TAU = -0.1

// Vague / incomplete answer shapes (PART in j.md's taxonomy) + hedges + leaked paths.
export const VAGUE = /\b(something|someone|somebody|a (certain|specific|particular) \w+|(the|a|their|his|her) website\b|a (document|report|file|attachment|project|matter|issue|topic|request|program|position|role|company|person)\b(?! (named|titled|called))|not (specified|mentioned|stated|named)|(does|do|did) not (specify|provide|mention|state|name|give|say)|unspecified|unnamed)\b/i
const LEAK = /\b[a-z]+-[a-z]\/[a-z_]+\//
export const vagueAnswer = (t) => !!t && (VAGUE.test(t) || HEDGE.test(t) || LEAK.test(t))

// Specific tokens: capitalised words, numbers, URLs, quoted spans; minus sentence glue.
const GLUE = new Set("the he she they it this that these those his her their its according email emails in on at a an and or but if as mr ms mrs dr i we you".split(" "))
function specificTokens(t) {
    const out = new Set()
    for (const m of String(t ?? "").matchAll(/https?:\/\/\S+|www\.\S+|"[^"]{3,80}"|\b\d[\d,.:\/-]*\b|\b[A-Z][A-Za-z0-9&'.-]{1,}\b/g)) {
        const tok = m[0].replace(/[.,;:]+$/, "").toLowerCase()
        if (tok && !GLUE.has(tok)) out.add(tok)
    }
    return out
}
export const novelSpecific = (answer, old, question) => {
    const have = String(`${old ?? ""} ${question ?? ""}`).toLowerCase()
    return [...specificTokens(answer)].filter((tok) => !have.includes(tok.replace(/^"|"$/g, "")))
}

// Specificity prompt. Starts with its own instruction (no shared prefix with the
// sandwich answer prompt).
export const specPrompt = (question, emails) => `Find the exact detail that answers the question in the email${emails.length > 1 ? "s" : ""} below.

Question: ${question}

Rules:
- Give the specific thing the question asks for, copied as written in the email: the exact name, title, file name, number, amount, date, time, website, organisation or role.
- Do not answer with a general description such as "a document", "a report", "the website", "something" or "someone". If the email refers to it indirectly (for example "our website", "the attached file", "your question"), say what it refers to, using the email's own words (sender's organisation, attachment name, the forwarded text).
- Answer every part of the question in one or two sentences. No preamble.
- If the emails do not contain the answer, reply with exactly: ${ABSTAIN}

Emails:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}
EMAILS>>>

Question: ${question}
Exact answer:`

// x1's YES/NO probe (same prompt, options and parsing as x-agent.js lpProbe).
async function probe(ctx, record, path) {
    const r = await lpCall(ctx, { prompt: relevancePrompt(record.question, clip(ctx.emailOf(path), 3000)), numPredict: 3, topK: 5 })
    const yes = ok(r) && /^\W*YES\b/i.test(r.answer ?? "")
    const top = r.tops?.[0] ?? []
    const hit = top.find(([t]) => t.trim().toUpperCase() === "YES")
    return { act: "check2", path, reply: String(r.answer ?? "").trim().slice(0, 10), yes, yesLp: r3(hit ? hit[1] : null) }
}

// x1's W0 (same retrieval calls as x-agent.js fusedAgent; BM25 only, deterministic).
async function x1W0(ctx, record) {
    const question = record.question
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 30, record.user)
    const mailbox = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf).slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    return switched ? mailbox : global
}

async function x1Deferred(ctx, record) {
    const real = G.g5
    G.g5 = { ...real, run: async () => ({ [MARK]: true, status: "ok", answer: "" }) }
    try {
        return { result: await X.x1.run(ctx, record), g5: real }
    } finally {
        G.g5 = real
    }
}

const usable = (r) => r && ok(r) && r.answer && !isAbstain(r.answer) && !HEDGE.test(r.answer)

// h8's handover: YES-filtered context first, then j2's cascade. Returns j2-shaped output.
async function yesCtxHandover(ctx, record) {
    const { result, g5 } = await x1Deferred(ctx, record)
    if (!result[MARK]) return result
    const { [MARK]: _, ...base } = result
    const question = record.question
    const checks = (base.log ?? []).filter((l) => l.act === "check")
    const yesPath = checks.find((l) => l.yes)?.path
    const W0 = await x1W0(ctx, record)
    const extra = []
    const at = W0.indexOf(yesPath)
    if (at >= 0) for (const path of W0.slice(at + 1)) extra.push(await probe(ctx, record, path))
    const yesPaths = [yesPath, ...extra.filter((l) => l.yes).map((l) => l.path)].filter(Boolean)
    const h = { yesPath, yesPaths, w0Match: at >= 0, extraProbes: extra }
    if (yesPaths.length >= 2) {
        const y = await lpCall(ctx, { prompt: sandwichPrompt(question, yesPaths.map((p) => ctx.emailOf(p))) })
        h.yesCtxAnswer = y.answer; h.yesCtxMean = r3(meanLp(y))
        if (usable(y) && meanLp(y) >= TAU) return { ...base, status: y.status, answer: y.answer, contextPaths: yesPaths, readPaths: yesPaths, used: 1, step: "commit-yesctx", h }
    }
    const single = yesPath ? await lpCall(ctx, { prompt: sandwichPrompt(question, [ctx.emailOf(yesPath)]) }) : null
    const mean = single ? meanLp(single) : -Infinity
    const diag = { yesPath, singleAnswer: single?.answer ?? null, singleMean: r3(mean) }
    if (usable(single) && mean >= TAU) return { ...base, status: single.status, answer: single.answer, contextPaths: [yesPath], readPaths: [yesPath], used: 1, step: "commit-single", j: diag, h }
    const g = await g5.run(ctx, record)
    return { ...base, ...g, step: "commit-g5", g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, j: diag, h }
}

async function specVariant(ctx, record, { yesCtx = false } = {}) {
    let out = yesCtx ? await yesCtxHandover(ctx, record) : await J.j2.run(ctx, record)
    // j2 re-asks truncated single-context answers with num_predict 400; h8 does not go
    // through j2, so it mirrors that step here.
    if (yesCtx && out.status === "output_limit" && out.used === 1 && ["commit", "commit-single", "commit-yesctx", "found", "nofound", "nopick"].includes(out.step) && out.contextPaths?.length) {
        const longer = await lpCall(ctx, { prompt: sandwichPrompt(record.question, out.contextPaths.map((p) => ctx.emailOf(p))), numPredict: 400 })
        if (ok(longer) && longer.answer) out = { ...out, status: longer.status, answer: longer.answer, truncatedAnswer: out.answer, relonged: true }
    }
    if (!["commit-single", "commit-g5", "commit-yesctx"].includes(out.step)) return out
    if (!vagueAnswer(out.answer)) return out
    const paths = yesCtx ? (out.h?.yesPaths ?? []) : [out.j?.yesPath].filter(Boolean)
    if (!paths.length) return out
    const r = await lpCall(ctx, { prompt: specPrompt(record.question, paths.map((p) => ctx.emailOf(p))) })
    const novel = ok(r) ? novelSpecific(r.answer, out.answer, record.question) : []
    const accept = usable(r) && !vagueAnswer(r.answer) && novel.length > 0
    const spec = { fired: true, paths, answer: r.answer, status: r.status, mean: r3(meanLp(r)), novel: novel.slice(0, 8), accepted: accept, oldAnswer: out.answer, oldStep: out.step }
    if (!accept) return { ...out, spec }
    return { ...out, status: r.status, answer: r.answer, step: `${out.step}+spec`, spec }
}

export const VARIANTS = {
    h7: { version: 1, describe: "j2 (x1 + confident single re-read of the YES email on unsure commits) + specificity re-ask: on the handover path only, a vague/hedged/path-leaking answer is re-asked over the YES email with an exact-detail prompt; replaced if the new answer is usable, not vague and adds a specific token", run: (ctx, record) => specVariant(ctx, record) },
    h8: { version: 1, describe: "h7 + YES-filtered context: on unsure commits the rest of W0 is probed; with >= 2 YES emails answer over the YES emails only (kept if confident), else j2's cascade; specificity re-ask over the YES emails", run: (ctx, record) => specVariant(ctx, record, { yesCtx: true }) },
}
