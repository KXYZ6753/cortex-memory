// Worker `a` hybrids: gates plus a model-driven extra step.
//   a1  attribute-and-reread: gates answers; the harness finds the email the answer
//       came from (most of the answer's novel words) and asks again with that email
//       alone (sandwich prompt). Hypothesis: on hits, gates' errors are mostly
//       distraction by the other four emails (gold-only "oracles" reads hits 1.8 pts
//       better); the model's own answer is a better selector than asking it to pick.
//       An abstaining or failed reread keeps gates' answer.
import { sandwichPrompt, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { contentWords, normaliseForMatch } from "../../text.js"
import { gatesCore, attribute, ok } from "./a-common.js"
import { pickPrompt, parsePick, listLines } from "./a-agent.js"

// Blend signal (failure analyst, f.md): the answer pulls in a second email.
export const BLEND = /\b(additionally|also (?:mentions?|mentioned|states?|notes?|says)|(?:was|is|as) (?:mentioned|stated|noted) in (?:an|the|another) email|in (?:an|the|another) email from|email \[?\d\]?)/i

async function rereadHybrid(ctx, record, { minShare = 0, onlyBlend = false } = {}) {
    const core = await gatesCore(ctx, record)
    const base = { contextPaths: core.contexts[0], readPaths: core.contexts.slice(0, core.used).flat(), switched: core.switched, used: core.used, gatesAnswer: core.result.answer ?? "" }
    if (!ok(core.result) || isAbstain(core.result.answer)) return { status: core.result.status, answer: core.result.answer ?? "", ...base, step: "gates" }
    if (onlyBlend && !BLEND.test(core.result.answer)) return { status: core.result.status, answer: core.result.answer, ...base, step: "clean" }
    const source = attribute(core.result.answer, record.question, core.final, ctx.emailOf)
    if (!source || source.share < minShare) return { status: core.result.status, answer: core.result.answer, ...base, step: "noattr" }
    const reread = await ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(source.path)]) })
    if (!ok(reread) || isAbstain(reread.answer) || !String(reread.answer ?? "").trim()) return { status: core.result.status, answer: core.result.answer, ...base, step: "keep", rereadPath: source.path, rereadShare: source.share, reread: reread.answer }
    return { status: reread.status, answer: reread.answer, ...base, step: "reread", rereadPath: source.path, rereadShare: source.share }
}

// a5: gates, plus one agent step (a2's list pick over <= 15 candidates). Escalate only
// when the model points outside gates' final context AND the picked email covers the
// question's content words clearly better (>= +0.15) than the email gates' answer came
// from; then the picked email is read alone and its answer replaces gates' (unless it
// abstains). Threshold chosen offline on S300-2 (in-sample): validate on S100 sets.
async function pickEscalation(ctx, record, { margin = 0.15 } = {}) {
    const core = await gatesCore(ctx, record)
    const base = { contextPaths: core.contexts[0], readPaths: core.contexts.slice(0, core.used).flat(), switched: core.switched, used: core.used, gatesAnswer: core.result.answer ?? "" }
    const keep = (step, extra = {}) => ({ status: core.result.status, answer: core.result.answer ?? "", ...base, step, ...extra })
    if (!ok(core.result)) return keep("gates")
    const shown = [...new Set([...core.contexts[0], ...core.contexts[1], ...byHeaderRank(record.question, core.mailboxRanked, ctx.emailOf, { k: 20 })])].slice(0, 15)
    const pick = await ctx.generate({ prompt: pickPrompt(record.question, listLines(ctx, record, shown)), options: generationOptions({ num_predict: 12 }) })
    const n = parsePick(pick.answer, shown.length)
    if (!n || core.final.includes(shown[n - 1])) return keep("agree", { pick: pick.answer })
    const qw = contentWords(record.question)
    const cov = (path) => { const lower = normaliseForMatch(ctx.emailOf(path)); return qw.filter((w) => lower.includes(w)).length / Math.max(1, qw.length) }
    const source = isAbstain(core.result.answer) ? null : attribute(core.result.answer, record.question, core.final, ctx.emailOf)
    const srcCov = source ? cov(source.path) : 0
    const pickCov = cov(shown[n - 1])
    if (pickCov < srcCov + margin) return keep("outside-weak", { pick: pick.answer, pickCov, srcCov })
    const result = await ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(shown[n - 1])]) })
    if (!ok(result) || isAbstain(result.answer) || !String(result.answer ?? "").trim()) return keep("escalated-abstain", { pick: pick.answer, pickCov, srcCov })
    return { status: result.status, answer: result.answer, ...base, readPaths: [...base.readPaths, shown[n - 1]], step: "escalated", pick: pick.answer, pickPath: shown[n - 1], pickCov, srcCov }
}

export const VARIANTS = {
    a5: { version: 1, describe: "gates + agent pick over 15 listed emails; escalate (read pick alone) only if pick is outside gates' context and covers the question better (+0.15)", run: (ctx, record) => pickEscalation(ctx, record) },
    a1: { version: 1, describe: "gates, then reread the answer's source email alone (attribution by answer words)", run: (ctx, record) => rereadHybrid(ctx, record) },
    a4: { version: 1, describe: "a1 only when gates' answer blends in another email (Additionally / also mentions / in the email from / email [n])", run: (ctx, record) => rereadHybrid(ctx, record, { onlyBlend: true }) },
}
