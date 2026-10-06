// Worker y (round 4): stack the two round-3 add-ons that act on different paths of x1.
// See docs/premise-study/explore2/y.md.
//
//   m2 (m-agent.js, +0.1 vs x1 pooled): when the commit check's first YES has token
//      logprob < -0.1, YES/NO-probe down snip50m (asker's mailbox BM25 top 50 ordered by
//      max(CE std, CE snippet), W0 excluded) top 6; the first YES whose logprob is >= the
//      first YES's (E) is answered first: [E, W0 top 4], sandwich prompt, abstain retry.
//   j2 (j-reread.js, +0.55): at x1's handover point (committed answer unsure: mean token
//      logprob < -0.1, hedge or abstention) re-read the YES email alone; keep that answer
//      only if it is itself confident (mean >= -0.1, no hedge/abstention), else g5.
//
//   y1 = x1 + m2 + j2.   y2 = the same on t-lx (x1 with lean explore, t-ladder.js).
//
// Decision tree on a commit (first YES = yes1, gates' answer A over W0 already computed by
// the base agent, exactly as x1 does it):
//   yesLp1 >= -0.1 : A sure -> A (x1).  A unsure -> j2 on yes1 (single read, else g5).
//   yesLp1 <  -0.1 : m2's recovery probes (same calls, same order as m2: after A).
//       no E accepted: as above (A sure -> A; A unsure -> j2 on yes1, else g5).
//       E accepted, A sure   -> m2's answer over [E, W0 top 4] (m2 exactly).
//       E accepted, A unsure -> m2's answer R over [E, W0 top 4]; then j2 re-reads E (the
//           accepted, first-placed YES email, whose YES logprob is >= yes1's) alone and
//           keeps it only if confident, else keeps R. The fallback is m2's answer, not
//           g5: m2 replaced the handover there (and won on it: m1 unsure branch +4/-0).
// Explore (no YES in W0) is the base agent's, untouched (x1 or t-lx).
//
// Implementation (no copy of x1): the base variant (x1 or t-lx) is called unchanged with
// its g5 handover intercepted for the duration of the call (stub, no model call; as
// j-reread.js does). The wrapper then runs m2's recovery (exported helpers from
// m-agent.js) and j2's re-read, and calls the real g5 only when the rule says so. So
// every path where neither add-on fires is the base agent call for call; the m2 path is
// m2's call sequence; the j2 path (yesLp1 >= -0.1) is j2's call sequence.
// j2's long re-ask of truncated single-context answers (num_predict 400) is kept.
import { sandwichPrompt } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { lpCall, meanLp, HEDGE } from "./n-conf.js"
import { lpProbe, recoveryLists, x1Contexts } from "./m-agent.js"
import { VARIANTS as X } from "./x-agent.js"
import { VARIANTS as T } from "./t-ladder.js"
import { VARIANTS as G } from "./g-agent.js"

const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
const MARK = Symbol("y-handover")

// base agent with the g5 handover deferred (stub returns a marker; no model call)
async function deferred(base, ctx, record) {
    const real = G.g5
    G.g5 = { ...real, run: async () => ({ [MARK]: true, status: "ok", answer: "" }) }
    try {
        return { result: await base.run(ctx, record), g5: real }
    } finally {
        G.g5 = real
    }
}

// j2's single read: sandwich prompt over one email; kept only if confident
async function singleRead(ctx, record, path, tau) {
    const single = await lpCall(ctx, { prompt: sandwichPrompt(record.question, [ctx.emailOf(path)]) })
    const mean = meanLp(single)
    const keep = ok(single) && !isAbstain(single.answer) && !HEDGE.test(single.answer ?? "") && !(mean < tau)
    return { single, keep, diag: { yesPath: path, singleAnswer: single.answer ?? null, singleMean: r3(mean) } }
}

const M2 = { doubtLp: -0.1, recN: 6 }

async function stack(base, ctx, record, { tau = -0.1, doubtLp = M2.doubtLp, recN = M2.recN, j2 = true, m2 = true } = {}) {
    const { result, g5 } = await deferred(base, ctx, record)
    const handover = Boolean(result[MARK])
    const { [MARK]: _, ...res } = result
    let out = res
    const committed = handover || res.step === "commit"
    if (committed) {
        const log = res.log ?? []
        const yes1 = log.find((l) => l.act === "check" && l.yes)
        const { W0, W1 } = await x1Contexts(ctx, record)
        const y = { yesLp1: yes1?.yesLp ?? null, m2Fired: false, recovered: null, j2Fired: false }
        // m2: recovery probes on a doubted YES (after gates' answer, as in m2)
        let E = null
        if (m2 && (yes1?.yesLp ?? -9) < doubtLp) {
            y.m2Fired = true
            const { snip50 } = await recoveryLists(ctx, record, W0, { mailboxOnly: true, rrfList: false })
            for (const p of snip50.slice(0, recN)) {
                const e = await lpProbe(ctx, record, p, log, "rec")
                if (e.yes && (e.yesLp ?? -9) >= (yes1?.yesLp ?? -9)) { E = p; break }
            }
            y.recovered = E
        }
        if (E) {
            // m2's answer over [E, W0 top 4] (ctx.generate, abstain retry over W1)
            const final = [E, ...W0.slice(0, 4)]
            const prompt = (paths) => sandwichPrompt(record.question, paths.map((p) => ctx.emailOf(p)))
            let r = await ctx.generate({ prompt: prompt(final) })
            let used = 1
            if (r.status === "ok" && isAbstain(r.answer) && W1.length) { r = await ctx.generate({ prompt: prompt(W1) }); used = 2 }
            const firstUnsure = res.unsure ?? handover
            out = { ...res, status: r.status, answer: r.answer ?? "", contextPaths: final, readPaths: used === 2 ? [...final, ...W1] : final, used, step: firstUnsure ? "recover-unsure" : "recover-sure", recoveredAnswer: r.answer ?? "", g5: undefined }
            if (j2 && firstUnsure && used === 1) {
                // j2 at the handover point: re-read E (the accepted, first-placed YES email) alone
                y.j2Fired = true
                const s = await singleRead(ctx, record, E, tau)
                out.j = s.diag
                if (s.keep) out = { ...out, status: s.single.status, answer: s.single.answer, contextPaths: [E], readPaths: [E], used: 1, step: "recover-single" }
            }
        } else if (handover) {
            const yesPath = yes1?.path
            let kept = null
            if (j2 && yesPath) {
                y.j2Fired = true
                const s = await singleRead(ctx, record, yesPath, tau)
                res.j = s.diag
                if (s.keep) kept = { ...res, status: s.single.status, answer: s.single.answer, contextPaths: [yesPath], readPaths: [yesPath], used: 1, step: "commit-single" }
            }
            if (kept) out = kept
            else {
                const g = await g5.run(ctx, record)
                out = { ...res, ...g, step: "commit-g5", g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths } }
            }
        }
        out.y = y
    }
    // j2: a final single-context answer cut by the output limit -> same prompt, longer limit
    if (j2 && out.status === "output_limit" && out.used === 1 && ["commit", "commit-single", "recover-sure", "recover-unsure", "recover-single", "found", "nofound", "nopick"].includes(out.step) && out.contextPaths?.length) {
        const longer = await lpCall(ctx, { prompt: sandwichPrompt(record.question, out.contextPaths.map((p) => ctx.emailOf(p))), numPredict: 400 })
        if (ok(longer) && longer.answer) out = { ...out, status: longer.status, answer: longer.answer, truncatedAnswer: out.answer, relonged: true }
    }
    return out
}

export const VARIANTS = {
    y1: { version: 1, describe: "x1 + m2 + j2: doubted first YES (token lp < -0.1) -> m2 recovery probes over snip50m top 6, accepted E answered first [E, W0 top 4]; unsure commit -> j2 single read of the YES email (E if accepted, else the first YES), kept if confident, else g5 (or m2's answer when E was accepted); truncated answers re-asked at 400 tokens", run: (ctx, record) => stack(X.x1, ctx, record) },
    y2: { version: 1, describe: "y1 on t-lx (x1 with lean explore: one CE-list pick + YES/NO check, no model search, no 2nd/3rd open)", run: (ctx, record) => stack(T["t-lx"], ctx, record) },
}
