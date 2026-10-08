// Round 6, lead: lite + the sure-YES email read alone, live (docs/premise-study/explore-journal.md
// "Round 6", Thu 00:10 ET; derived offline by tools/lead-q1yas.js with parent lite-det-ub).
//
//   lead-liteyas   gates' W0 commit check exactly as lead-ya (x1's probe, rank order, stop at the
//                  first YES). Sure first YES (token logprob >= -0.1): sandwich read of that email
//                  alone; accepted (ok, not abstain, not hedge) -> that answer, and gates' answer A
//                  over W0 is never computed. Otherwise lite-ub (lite-stack.js) runs unchanged.
//
// lite's t-lk repeats the same W0 probes (same prompt, same email, same options) on 2,699 of
// 2,700 development questions. A memo over chatRaw returns the first probe's reply for an
// identical request body instead of calling the model again. The memo sits above det(), so a
// memoised call also skips its reset; every real call keeps its reset. Behind det each call's
// output depends only on its own request, so the answers equal the offline derivation
// (lite-det-ub + lead-ya); tools/lead-liteyas-check.js compares them.
import { sandwichPrompt, clip } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { relevancePrompt, gatesContexts } from "./w-map.js"
import { lpCall, HEDGE } from "./n-conf.js"
import { det } from "./i-det.js"
import { liteStack } from "./lite-stack.js"

const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
const UB = { m2On: "unsure", g5OnDoubted: true }

function memoCtx(ctx) {
    const memo = new Map()
    const stats = { hits: 0 }
    const m = Object.create(ctx)
    m.chatRaw = async (body) => {
        const key = JSON.stringify(body)
        if (memo.has(key)) { stats.hits++; return memo.get(key) }
        const data = await ctx.chatRaw(body)
        memo.set(key, data)
        return data
    }
    return { m, stats }
}

async function liteYas(ctx, record, { minYesLp = -0.1 } = {}) {
    const { m, stats } = memoCtx(ctx)
    const { contexts, switched } = await gatesContexts(m, record)
    const W0 = contexts[0]
    const yasLog = []
    let yes = null
    for (const path of W0) {
        const r = await lpCall(m, { prompt: relevancePrompt(record.question, clip(m.emailOf(path), 3000)), numPredict: 3, topK: 5 })
        const top = r.tops?.[0] ?? []
        const lpOf = (word) => { const hit = top.find(([t]) => t.trim().toUpperCase() === word); return hit ? hit[1] : null }
        const entry = { act: "check", path, reply: String(r.answer ?? "").trim().slice(0, 10), yes: ok(r) && /^\W*YES\b/i.test(r.answer ?? ""), yesLp: r3(lpOf("YES")), noLp: r3(lpOf("NO")) }
        yasLog.push(entry)
        if (entry.yes) { yes = entry; break }
    }
    const yas = { yesPath: yes?.path ?? null, yesLp: yes?.yesLp ?? null, read: null }
    if (yes && (yes.yesLp ?? -Infinity) >= minYesLp) {
        const single = await m.generate({ prompt: sandwichPrompt(record.question, [m.emailOf(yes.path)]) })
        const answer = single.answer ?? ""
        if (single.status === "ok" && answer && !isAbstain(answer) && !HEDGE.test(answer))
            return { status: single.status, answer, contextPaths: [yes.path], readPaths: [yes.path], switched, used: 1, step: "yes-alone", yas: { ...yas, read: "accepted" }, log: yasLog, memoHits: stats.hits }
        yas.read = { status: single.status, answer: answer.slice(0, 200) }
    }
    const res = await liteStack(m, record, UB)
    return { ...res, yas, memoHits: stats.hits }
}

export const VARIANTS = {
    "lead-liteyas": { version: 1, describe: "lite-ub + lead-yas: gates' W0 commit check; a sure first YES (lp >= -0.1) is read alone (sandwich) and answered when accepted, without gates' A; otherwise lite-ub unchanged (its repeated W0 probes served from a per-question memo)", run: det((ctx, record) => liteYas(ctx, record), { mode: "all" }) },
}
