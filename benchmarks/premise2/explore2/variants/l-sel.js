// Worker l (self-verification): DEPLOYABLE selection among x1's own candidate answers by
// e2b's pointwise YES/NO verification. Notes: docs/premise-study/explore2/l.md
//
// x1 runs unchanged (same calls, same order). When x1 ends on a path listed in `on` (sure
// commit, unsure commit -> g5 handover, explore "found") it has an answer-bearing email by
// its own judgement (the first YES of the commit check, or the found email). After all of
// x1's calls for the question, extra candidates are generated (sources below), every
// distinct usable candidate is verified against that YES email with one 1-token call each
// (l-common.js verifyPrompt "after": the email first, then the question and the proposed
// answer, so the candidates share the cached prefix), and the best-scored alternative
// replaces x1's answer only if its score beats x1's answer's by more than `margin`
// (score = logP(YES) - logP(NO) of the first output token). Diagnostic logging: every
// candidate's text and score, plus its lexical grounding in the YES email, so other
// selection rules can be scored offline after l-grade.js grades the candidate texts.
//
// Candidate sources (all generated in the run; no stored answers):
//   x1      x1's final answer (the default)
//   commit  x1's commit answer (gates' prompt over W0; differs from x1's answer only on the handover)
//   single  the YES email read alone (sandwich prompt, as oracles / j1)
//   labels  gates' prompt with thread labels on chain emails (c-render.js thread1) over x1's
//           final context (W0 on commits, [found, W0 top 4] on found)
// Abstentions, hedges, empty and failed candidates are never chosen over x1's answer.
import { sandwichPrompt } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { lpCall, meanLp, HEDGE, gatesContexts } from "./n-conf.js"
import { VARIANTS as X } from "./x-agent.js"
import { cPrompt } from "./c-render.js"
import { verify } from "./l-common.js"

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
const ok = (s) => s === "ok" || s === "output_limit"
export const yesOf = (base) => {
    if (["commit", "commit-g5"].includes(base.step)) return (base.log ?? []).find((l) => l.act === "check" && l.yes)?.path ?? null
    if (base.step === "found") return base.foundPath ?? null
    return null
}
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
export const lexGround = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? r3(ws.filter((w) => es.has(w)).length / ws.length) : 0
}

export async function selectAmong(ctx, record, base, { sources = ["commit", "single"], margin = 1, form = "after" } = {}) {
    const q = record.question
    const yesPath = yesOf(base)
    if (!yesPath) return { ...base, l: { skipped: "no YES email" } }
    const yesEmail = ctx.emailOf(yesPath)
    const t0 = performance.now()
    const cands = [{ src: "x1", text: String(base.answer ?? "").trim(), status: base.status }]
    if (sources.includes("commit") && base.gatesAnswer) cands.push({ src: "commit", text: String(base.gatesAnswer).trim(), status: "ok" })
    for (const s of sources) {
        if (s === "single") {
            const r = await lpCall(ctx, { prompt: sandwichPrompt(q, [yesEmail]) })
            cands.push({ src: "single", text: r.answer, status: r.status, mean: r3(meanLp(r)) })
        } else if (s === "labels") {
            const paths = base.step === "commit-g5" ? (await gatesContexts(ctx, record)).contexts[0] : base.contextPaths
            const r = await lpCall(ctx, { prompt: cPrompt(q, paths.map((p) => ctx.emailOf(p)), { render: "thread1" }) })
            cands.push({ src: "labels", text: r.answer, status: r.status, mean: r3(meanLp(r)) })
        }
    }
    const genMs = Math.round(performance.now() - t0)
    const usable = (c) => ok(c.status) && c.text && !isAbstain(c.text) && !HEDGE.test(c.text)
    const distinct = new Map()
    for (const c of cands) if (c.src === "x1" || usable(c)) { if (!distinct.has(c.text)) distinct.set(c.text, { text: c.text, srcs: [] }); distinct.get(c.text).srcs.push(c.src) }
    const list = [...distinct.values()]
    const t1 = performance.now()
    if (list.length >= 2) for (const c of list) c.v = await verify(ctx, { form, question: q, answer: c.text, emails: [yesEmail] })
    const verMs = Math.round(performance.now() - t1)
    const def = list[0]
    let best = def
    for (const c of list.slice(1)) if ((c.v?.s ?? -Infinity) > (best.v?.s ?? -Infinity)) best = c
    const switchTo = best !== def && (best.v?.s ?? -Infinity) - (def.v?.s ?? -Infinity) > margin ? best : def
    const l = {
        yesPath, genMs, verMs, verified: list.length >= 2 ? list.length : 0, kept: switchTo.srcs.join("+"), margin,
        cands, scores: list.map((c) => ({ srcs: c.srcs, s: c.v?.s ?? null, yes: c.v?.yes ?? null, no: c.v?.no ?? null, ms: c.v?.ms ?? null, lex: lexGround(q, c.text, yesEmail) })),
    }
    if (switchTo === def) return { ...base, l }
    return { ...base, answer: switchTo.text, status: "ok", x1Answer: base.answer, x1Step: base.step, step: `${base.step}>l:${switchTo.srcs[0]}`, l }
}

const verSel = (opts) => async (ctx, record) => {
    const base = await X.x1.run(ctx, record)
    if (!(opts.on ?? ["commit", "commit-g5", "found"]).includes(base.step)) return base
    return selectAmong(ctx, record, base, opts)
}

export const VARIANTS = {
    "l-xs1": { version: 1, describe: "x1; on sure/unsure commits and explore-found, candidates {x1's answer, commit answer, YES email read alone, thread-labelled answer} verified by e2b's pointwise YES/NO against the YES email; switch from x1 only if the best alternative scores > 1 higher (all candidates and scores logged)", run: verSel({ on: ["commit", "commit-g5", "found"], sources: ["commit", "single", "labels"], margin: 1 }) },
    "l-xs2": { version: 1, describe: "l-xs1 without the thread-labelled candidate: {x1's answer, commit answer, YES email read alone}, margin 1", run: verSel({ on: ["commit", "commit-g5", "found"], sources: ["commit", "single"], margin: 1 }) },
}
