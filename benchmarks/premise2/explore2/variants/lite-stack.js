// Worker lite (round 5): cheaper points on the accuracy-energy frontier. t-lk (commit check +
// one CE-list pick, no g5 handover) plus q1's retrieval mechanisms, with the g5 handover
// dropped or kept only where both confidence signals doubt the commit.
// See docs/premise-study/explore2/lite.md.
//
//   lite-a  = t-lk + d6 explore list + m2 recovery exactly as in q1 (first YES's token logprob
//             < -0.1, A sure or unsure); no g5 at all. ("q1 without the handover and with
//             t-lk's lean explore")
//   lite-u  = t-lk + d6 explore list + m2 recovery only on doubted AND unsure commits (first
//             YES lp < -0.1 and A unsure: the questions where q1's recovery replaces the g5
//             handover); no g5. Sure commits keep A without recovery probes.
//   lite-ub = lite-u + d8's seeded g5 handover where the recovery found no E (doubted, unsure,
//             no E: q1's "m2 probes, then g5 seeded with yes1" route). Unsure commits with a
//             confident first YES keep A (no handover).
//
// Decision tree on a commit (yes1 = first W0 YES; A = gates' answer over W0, computed by t-lk):
//   yes1 lp >= -0.1                      -> A (sure or unsure)               all three = t-lk
//   yes1 lp <  -0.1, A sure              -> lite-a: m2 (E -> [E, W0 top 4], else A); lite-u/ub: A
//   yes1 lp <  -0.1, A unsure, E         -> m2's answer over [E, W0 top 4]   (= q1 recover-unsure)
//   yes1 lp <  -0.1, A unsure, no E      -> lite-a/u: A; lite-ub: g5 seeded with yes1 (= q1)
//   no YES in W0                          -> t-lk's lean explore over d6's list
//
// Implementation (no copy of t-lk, m2, d6 or g5): t-lk (t-ladder.js simpleX1 via VARIANTS)
// runs unchanged on d6's ctx (d-agent.js lexicalPoolCtx: the CE list hook fires only on the
// explore path, where t-lk loads the CE). Afterwards the wrapper runs m2's recovery with
// m-agent.js's exported helpers (x1Contexts, recoveryLists, lpProbe) on the plain ctx, with
// q1's arguments (mailbox-only snip50m, top 6, accept the first YES with lp >= yes1's), and
// answers [E, W0 top 4] with the sandwich prompt and abstain retry over W1, as q1/m2 do. lite-ub
// then runs g-agent.js's g5 on the same d6 ctx with a search hook that puts yes1 on top of g5's
// first own mailbox search (d8's rule: k 20, the asker's mailbox, a query other than the
// question, once). Call order on every path equals the parent's: probes -> A -> (recovery
// probes -> E answer | g5). Stub check: tools/lite-check.js.
import { sandwichPrompt } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { lpProbe, recoveryLists, x1Contexts } from "./m-agent.js"
import { lexicalPoolCtx } from "./d-agent.js"
import { det } from "./i-det.js"
import { VARIANTS as T } from "./t-ladder.js"
import { VARIANTS as G } from "./g-agent.js"

const M2 = { doubtLp: -0.1, recN: 6 }

// d8's seed: while armed, the first search with k 20 in the asker's mailbox for a query other
// than the question returns [seed, ...results] cut to 20 (g5 header-reranks it as usual).
function armSeed(w, record) {
    const state = { armed: false, seed: null, seeded: 0 }
    const inner = w.search
    w.search = async (query, k, user = null) => {
        const paths = await inner(query, k, user)
        if (!state.armed || state.seeded || !state.seed || k !== 20 || user !== record.user || query === record.question) return paths
        state.seeded = 1
        return [...new Set([state.seed, ...paths])].slice(0, 20)
    }
    return state
}

async function liteStack(ctx, record, { m2On = "doubted", g5OnDoubted = false, doubtLp = M2.doubtLp, recN = M2.recN } = {}) {
    const w = lexicalPoolCtx(ctx, record)          // d6 explore list (explore path only)
    const seed = armSeed(w, record)
    const res = await T["t-lk"].run(w, record)
    const lite = { yesLp1: null, m2Fired: false, recovered: null, g5: false, seeded: 0 }
    const extra = () => ({ lite, dAdded: w.dAdded ?? [], dMasked: w.dMasked ?? 0, dExtraMs: Math.round(w.dExtraMs ?? 0) })
    if (res.step !== "commit" && res.step !== "commit-unsure") return { ...res, ...extra() }
    const unsure = res.step === "commit-unsure"
    const log = res.log ?? []
    const yes1 = log.find((l) => l.act === "check" && l.yes) ?? null
    lite.yesLp1 = yes1?.yesLp ?? null
    const doubted = (yes1?.yesLp ?? -9) < doubtLp
    if (!doubted || (m2On === "unsure" && !unsure)) return { ...res, ...extra() }
    // m2's recovery (q1's helpers and arguments), on the plain ctx
    lite.m2Fired = true
    const { W0, W1 } = await x1Contexts(ctx, record)
    const { snip50 } = await recoveryLists(ctx, record, W0, { mailboxOnly: true, rrfList: false })
    let E = null
    for (const p of snip50.slice(0, recN)) {
        const e = await lpProbe(ctx, record, p, log, "rec")
        if (e.yes && (e.yesLp ?? -9) >= (yes1?.yesLp ?? -9)) { E = p; break }
    }
    lite.recovered = E
    if (E) {
        const final = [E, ...W0.slice(0, 4)]
        const prompt = (paths) => sandwichPrompt(record.question, paths.map((p) => ctx.emailOf(p)))
        let r = await ctx.generate({ prompt: prompt(final) })
        let used = 1
        if (r.status === "ok" && isAbstain(r.answer) && W1.length) { r = await ctx.generate({ prompt: prompt(W1) }); used = 2 }
        return { ...res, status: r.status, answer: r.answer ?? "", contextPaths: final, readPaths: used === 2 ? [...final, ...W1] : final, used, step: unsure ? "recover-unsure" : "recover-sure", log, ...extra() }
    }
    if (g5OnDoubted && unsure) {
        // d8's seeded handover (real g5 on the d6 ctx, hook armed with yes1)
        if (yes1?.path) seed.seed = yes1.path
        seed.armed = true
        let g
        try { g = await G.g5.run(w, record) } finally { seed.armed = false }
        lite.g5 = true
        lite.seeded = seed.seeded
        return { ...res, ...g, step: "commit-g5", g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, switched: res.switched, log, ...extra() }
    }
    return { ...res, log, ...extra() }
}

const A = { m2On: "doubted" }
const U = { m2On: "unsure" }
const UB = { m2On: "unsure", g5OnDoubted: true }
const run = (opt) => (ctx, record) => liteStack(ctx, record, opt)

export { liteStack }
export const VARIANTS = {
    "lite-a": { version: 1, describe: "t-lk + d6 lexical CE explore list + m2 recovery as in q1 (first-YES lp < -0.1: YES/NO probes down snip50m top 6, accepted E answered first [E, W0 top 4]); no g5 handover", run: run(A) },
    "lite-u": { version: 1, describe: "t-lk + d6 explore list + m2 recovery only on doubted AND unsure commits (first-YES lp < -0.1 and gates' answer unsure); no g5 handover", run: run(U) },
    "lite-ub": { version: 1, describe: "lite-u + d8-seeded g5 handover only on doubted, unsure commits where the recovery found no E (unsure commits with a confident first YES keep gates' answer)", run: run(UB) },
    "lite-det-a": { version: 1, describe: "lite-a behind det() (mode all; compare with i-det-x1 v2, q-det-q1, i-det-tlk v2)", run: det(run(A), { mode: "all" }) },
    "lite-det-u": { version: 1, describe: "lite-u behind det() (mode all)", run: det(run(U), { mode: "all" }) },
    "lite-det-ub": { version: 1, describe: "lite-ub behind det() (mode all)", run: det(run(UB), { mode: "all" }) },
}
