// Worker b (round 5): in-domain few-shot demonstrations (docs/premise-study/explore2/b.md).
// Helpers and the demo bank: b-common.js. The demos are injected by a ctx wrapper
// (withDemos) into every sandwich answer prompt; probes, picks, plans and g5's tool
// turns are untouched, so gates and x1 are called unchanged (imports, not copies).
//
// Families:
//   b-o*  gold-only reading harness (the gold email alone, sandwich prompt, as
//         explore/variants.js `oracles`), diagnostic: isolates reading from retrieval.
//   b-g*  gates (one-shot) with demos in its answer prompt(s).
//   b-x*  x1 (agent) with demos in its answer prompts: the commit answer (lpCall,
//         also the logprob gate's input), the explore final answer, g5's final answer.
import { sandwichPrompt, VARIANTS as BASE } from "../../explore/variants.js"
import { withDemos } from "./b-common.js"
import { VARIANTS as X } from "./x-agent.js"
import { gatesContexts, lpCall, meanLp, HEDGE } from "./n-conf.js"
import { isAbstain } from "../../prompts.js"

const diag = (out, info) => ({ ...out, bDemo: info })
const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

// Targeted: gates' answer (with logprobs, as x1's commit answer); only when it is unsure
// (n's gate: mean token logprob < tau, a hedge, or a bad status) is the same context
// re-read with demos, and the demo answer is used unless it abstains. An abstention
// keeps gates' retry on the other context (no demos).
async function gatesTargeted(ctx, record, opts, { tau = -0.1 } = {}) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const prompt = (paths) => sandwichPrompt(record.question, paths.map((p) => ctx.emailOf(p)))
    const first = await lpCall(ctx, { prompt: prompt(contexts[0]) })
    const mean = meanLp(first)
    const base = { contextPaths: contexts[0], switched, firstMean: r3(mean), firstAnswer: first.answer }
    if (first.status === "ok" && isAbstain(first.answer)) {
        const r = contexts[1].length ? await ctx.generate({ prompt: prompt(contexts[1]) }) : first
        return { ...base, status: r.status, answer: r.answer ?? "", readPaths: [...contexts[0], ...contexts[1]], used: 2, step: "abstain-retry" }
    }
    const unsure = !ok(first) || HEDGE.test(first.answer ?? "") || mean < tau
    if (!unsure) return { ...base, status: first.status, answer: first.answer, readPaths: contexts[0], used: 1, step: "sure" }
    const { ctx: c, info } = await withDemos(ctx, record, opts)
    const second = await lpCall(c, { prompt: prompt(contexts[0]) })
    const use = ok(second) && second.answer && !isAbstain(second.answer)
    return { ...base, status: use ? second.status : first.status, answer: use ? second.answer : first.answer, readPaths: contexts[0], used: 1, step: use ? "unsure-demo" : "unsure-kept", demoMean: r3(meanLp(second)), bDemo: info }
}

// gold-only harness: one call, the gold email alone
async function goldOnly(ctx, record, opts = null) {
    const { ctx: c, info } = opts ? await withDemos(ctx, record, opts) : { ctx, info: null }
    const result = await c.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(record.path)]) })
    return diag({ status: result.status, answer: result.answer ?? "", contextPaths: [record.path] }, info)
}

const wrapRun = (base, opts) => async (ctx, record) => {
    const { ctx: c, info } = await withDemos(ctx, record, opts)
    return diag(await base.run(c, record), info)
}

const S4 = { k: 4, mode: "sim", format: "chat", context: "gold", answer: "gold" }
const F4 = { ...S4, mode: "fixed" }
const S8 = { ...S4, k: 8 }
const I4 = { ...S4, format: "inline" }
const T4 = { ...S4, mode: "type" }
const N4 = { ...S4, answer: "norm" }

export const VARIANTS = {
    "b-o0": { version: 1, describe: "DIAGNOSTIC gold-only reading baseline: the gold email alone, sandwich prompt (= oracles)", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record) },
    "b-o4s": { version: 1, describe: "DIAGNOSTIC gold-only + 4 in-domain demos (BM25-similar DEMO questions from other mailboxes; each its gold email alone + verbatim gold answer) as prior chat turns", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, S4) },
    "b-o4f": { version: 1, describe: "DIAGNOSTIC gold-only + 4 fixed hand-picked demos (who/forward, when/forward header, extension, two-part who), chat turns", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, F4) },
    "b-o8s": { version: 1, describe: "DIAGNOSTIC gold-only + 8 similar demos, chat turns", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, S8) },
    "b-o4i": { version: 1, describe: "DIAGNOSTIC gold-only + 4 similar demos as one inline example block before the sandwich prompt", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, I4) },
    "b-o4t": { version: 1, describe: "DIAGNOSTIC gold-only + 4 similar demos of the same question type, chat turns", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, T4) },
    "b-o4n": { version: 1, describe: "DIAGNOSTIC gold-only + 4 similar demos with the trailing 'according to the email ...' clause cut from the demo answers", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, N4) },
    "b-g4f": { version: 1, describe: "gates with the 4 fixed hand-picked demos (chat turns) before each sandwich answer prompt", run: wrapRun(BASE.gates, F4) },
    "b-g8s": { version: 1, describe: "gates with 8 similar demos (chat turns) before each sandwich answer prompt", run: wrapRun(BASE.gates, S8) },
    "b-g2c": { version: 1, describe: "gates with 2 similar demos shown in gates' own 5-email context for the demo question (gold inside, retrieval distractors; emails clipped at 2,500 chars)", run: wrapRun(BASE.gates, { ...S4, k: 2, context: "ctx5" }) },
    "b-gu4f": { version: 1, describe: "gates (answer with logprobs); only an unsure answer (mean token logprob < -0.1, hedge) is re-read over the same context with the 4 fixed demos, and the demo answer is used", run: (ctx, record) => gatesTargeted(ctx, record, F4) },
    "b-g4s": { version: 1, describe: "gates with 4 in-domain similar demos (chat turns, gold email per demo, verbatim gold answer) before each sandwich answer prompt", run: wrapRun(BASE.gates, S4) },
    "b-o4L": { version: 1, describe: "DIAGNOSTIC gold-only + 4 similar demos whose gold answers are >= 140 chars (complete, multi-detail answers), chat turns", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, { ...S4, minGold: 140 }) },
    "b-o4e": { version: 1, describe: "DIAGNOSTIC gold-only + 4 demos chosen by nomic-embed similarity of the questions (CPU), chat turns", diagnostic: true, run: (ctx, record) => goldOnly(ctx, record, { ...S4, sim: "emb" }) },
    "b-x4f": { version: 1, describe: "x1 with the 4 fixed hand-picked demos (chat turns) before each sandwich answer prompt", run: wrapRun(X.x1, F4) },
    "b-x4s": { version: 1, describe: "x1 with 4 in-domain similar demos (chat turns, gold email per demo, verbatim gold answer) before each sandwich answer prompt (commit answer, explore answer, g5 final)", run: wrapRun(X.x1, S4) },
}
