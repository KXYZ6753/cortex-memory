// Round 6, lead: read the commit check's YES email alone (docs/premise-study/explore-journal.md
// "Round 6"). Offline (tools/lead-yesalone.js, FULL-2/3 + S300-4/5): where q1's first YES
// email is the gold, the gold-only sandwich read beats det gates by net +25 of 1,300 hits.
// j1 (j.md) tried a single-email re-read only on x1's doubted handover and lost; here it
// replaces gates' answer on every commit.
//
//   lead-ya   gates' first context W0; YES/NO commit check in rank order (x1's probe:
//             relevancePrompt over the email clipped to 3,000 chars, logprobs, 3 tokens),
//             stop at the first YES. YES: sandwich prompt over that email alone (unclipped,
//             = explore `oracles` when it is the gold). If that read fails, abstains or
//             hedges, or no email gets a YES: gates unchanged (explore gates.run), so those
//             questions are byte-identical to i-det-gates behind det.
//   lead-yas  as lead-ya, but only a sure YES (YES token logprob >= -0.1) is read alone.
import { VARIANTS as BASE, sandwichPrompt, clip } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { relevancePrompt, gatesContexts } from "./w-map.js"
import { lpCall, HEDGE } from "./n-conf.js"
import { det } from "./i-det.js"

const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

async function probe(ctx, record, path, log) {
    const r = await lpCall(ctx, { prompt: relevancePrompt(record.question, clip(ctx.emailOf(path), 3000)), numPredict: 3, topK: 5 })
    const yes = ok(r) && /^\W*YES\b/i.test(r.answer ?? "")
    const top = r.tops?.[0] ?? []
    const lpOf = (word) => { const hit = top.find(([t]) => t.trim().toUpperCase() === word); return hit ? hit[1] : null }
    const entry = { act: "check", path, reply: String(r.answer ?? "").trim().slice(0, 10), yes, yesLp: r3(lpOf("YES")), noLp: r3(lpOf("NO")) }
    log.push(entry)
    return entry
}

async function yesAlone(ctx, record, { minYesLp = -Infinity } = {}) {
    const { contexts, switched } = await gatesContexts(ctx, record)
    const W0 = contexts[0]
    const log = []
    let yes = null
    for (const path of W0) {
        const entry = await probe(ctx, record, path, log)
        if (entry.yes) { yes = entry; break }
    }
    if (yes && (yes.yesLp ?? -Infinity) >= minYesLp) {
        const single = await ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(yes.path)]) })
        const answer = single.answer ?? ""
        if (single.status === "ok" && answer && !isAbstain(answer) && !HEDGE.test(answer)) {
            return { status: single.status, answer, contextPaths: [yes.path], readPaths: [yes.path], switched, used: 1, step: "yes-alone", yesPath: yes.path, yesLp: yes.yesLp, log }
        }
        log.push({ act: "fallback", status: single.status, answer: answer.slice(0, 200) })
    }
    const g = await BASE.gates.run(ctx, record)
    return { ...g, step: yes ? "yes-fallback" : "no-yes", yesPath: yes?.path ?? null, yesLp: yes?.yesLp ?? null, log }
}

export const VARIANTS = {
    "lead-ya": { version: 1, describe: "Round 6 lead: gates' W0 commit check; first YES email read alone (sandwich); else gates. Behind det(all).", run: det((ctx, record) => yesAlone(ctx, record), { mode: "all" }) },
    "lead-yas": { version: 1, describe: "Round 6 lead: as lead-ya, but only a sure YES (logprob >= -0.1) is read alone. Behind det(all).", run: det((ctx, record) => yesAlone(ctx, record, { minYesLp: -0.1 }), { mode: "all" }) },
}
