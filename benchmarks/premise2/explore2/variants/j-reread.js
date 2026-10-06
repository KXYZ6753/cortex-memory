// Worker j: hit-side reading on top of x1 (docs/premise-study/explore2/j.md).
//
// x1 (variants/x-agent.js) is run unchanged except for one step: when its commit check
// found a YES email but gates' answer over W0 is unsure (mean token logprob < -0.1, a
// hedge or an abstention), x1 hands the question to the g5 tools agent. On FULL-0
// (stored answers) those handed-over hits are 85% right with g5, 84% with gates'
// answer, and 88% for the gold-only oracle when the YES email is the gold (103 -> 107
// of 120): an unsure answer over five emails reads better from the one email that the
// model itself judged to answer the question.
//
//   j1  unsure commit -> answer from the YES email alone (sandwich prompt, as oracles);
//       if that answer abstains or hedges -> g5 (x1's handover).
//   j2  as j1, but the single-email answer must also be confident (mean token logprob
//       >= -0.1), else g5.
// Everything else is x1 byte for byte (same calls in the same order). Implementation:
// x1 is called as is; its g5 handover is intercepted for the duration of the call (the
// stub returns a marker, no model call), then the wrapper does the re-read with the YES
// email from x1's own probe log, and calls the real g5 only when the rule says so.
// Both also re-ask with num_predict 400 when x1's final single-context answer was cut by
// the 160-token limit (45 such hit answers across stored runs, 2% right).
import { sandwichPrompt } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { lpCall, meanLp, HEDGE } from "./n-conf.js"
import { VARIANTS as X } from "./x-agent.js"
import { VARIANTS as G } from "./g-agent.js"

const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
const MARK = Symbol("j-handover")

async function x1Deferred(ctx, record) {
    const real = G.g5
    G.g5 = { ...real, run: async () => ({ [MARK]: true, status: "ok", answer: "" }) }
    try {
        return { result: await X.x1.run(ctx, record), g5: real }
    } finally {
        G.g5 = real
    }
}

async function reread(ctx, record, { tau = null } = {}) {
    const { result, g5 } = await x1Deferred(ctx, record)
    let out = result
    if (result[MARK]) {
        const { [MARK]: _, ...base } = result
        const yesPath = (base.log ?? []).find((l) => l.act === "check" && l.yes)?.path
        const single = yesPath ? await lpCall(ctx, { prompt: sandwichPrompt(record.question, [ctx.emailOf(yesPath)]) }) : null
        const mean = single ? meanLp(single) : -Infinity
        const bad = !single || !ok(single) || isAbstain(single.answer) || HEDGE.test(single.answer ?? "") || (tau !== null && mean < tau)
        const diag = { yesPath, singleAnswer: single?.answer ?? null, singleMean: r3(mean) }
        if (!bad) out = { ...base, status: single.status, answer: single.answer, contextPaths: [yesPath], readPaths: [yesPath], used: 1, step: "commit-single", j: diag }
        else {
            const g = await g5.run(ctx, record)
            out = { ...base, ...g, step: "commit-g5", g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, j: diag }
        }
    }
    // a final answer cut by the output limit: same prompt, longer limit (single-context paths only)
    if (out.status === "output_limit" && out.used === 1 && ["commit", "commit-single", "found", "nofound", "nopick"].includes(out.step) && out.contextPaths?.length) {
        const longer = await lpCall(ctx, { prompt: sandwichPrompt(record.question, out.contextPaths.map((p) => ctx.emailOf(p))), numPredict: 400 })
        if (ok(longer) && longer.answer) out = { ...out, status: longer.status, answer: longer.answer, truncatedAnswer: out.answer, relonged: true }
    }
    return out
}

export const VARIANTS = {
    j1: { version: 1, describe: "x1; an unsure committed answer is re-read from the YES email alone (sandwich prompt) instead of the g5 handover (g5 only if that abstains/hedges); truncated answers re-asked with num_predict 400", run: (ctx, record) => reread(ctx, record) },
    j2: { version: 1, describe: "j1, but the single-email answer must also be confident (mean token logprob >= -0.1), else the g5 handover", run: (ctx, record) => reread(ctx, record, { tau: -0.1 }) },
}
