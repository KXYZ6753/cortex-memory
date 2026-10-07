// Worker q (round 5): stack the small mechanism-verified gains onto x1 and measure the
// stack behind det(). See docs/premise-study/explore2/q.md.
//
//   q1 = x1 + d8 + m2's recovery (miss and handover side; answer prompts unchanged)
//        d6 part of d8: on x1's explore path (no YES in W0) the 15-line pick list is the CE
//            over own-mailbox W1 ∪ BM25 top 30 ∪ owner-stripped BM25 20 ∪ subject-weighted
//            BM25 20 (d-agent.js lexicalPoolCtx, imported).
//        seeding part of d8: when the unsure commit is handed to g5, g5's first own mailbox
//            search returns [first-YES email, ...BM25(query) top 20] (then g5's header rerank).
//        m2: when the first YES's token logprob is < -0.1, YES/NO probes down snip50m top 6
//            (after gates' answer A, as in m2); the first YES with logprob >= the first YES's
//            (E) is answered first: [E, W0 top 4], sandwich prompt, abstain retry over W1.
//   q2 = q1 + thread labels on chain emails in every answer prompt (c-agent.js renderingCtx,
//        render "thread1", imported): A, m2's answer, g5's final answer, explore's final answer.
//
// Where the components meet (decision tree on a commit; yes1 = first W0 YES, A = gates'
// answer over W0, already computed by x1 itself):
//   yes1 lp >= -0.1, A sure    -> A                                   (x1 = d8 = m2)
//   yes1 lp >= -0.1, A unsure  -> g5 seeded with yes1                  (d8)
//   yes1 lp <  -0.1, E found   -> m2's answer over [E, W0 top 4]       (m2; A sure or unsure)
//   yes1 lp <  -0.1, no E, A sure   -> A (after the probes)            (m2 = x1)
//   yes1 lp <  -0.1, no E, A unsure -> m2's probes, then g5 seeded with yes1   (m2 + d8)
//   no YES in W0               -> explore with d6's list                (d8 = d6)
// d6's list and m2's recovery never act on the same question (explore = no YES; m2 needs a
// YES). The one shared point is a doubted, unsure commit: m2 goes first; an accepted E
// replaces the handover (no g5 call, so no seed), and only when m2 finds no E does g5 run,
// seeded with yes1 exactly as d8 would. Dev evidence for both choices (q.md §1):
//   - d8r's seeding on handovers with a doubted yes1: hits +6/-1, misses +3/-1 vs x1;
//   - on m2's recover-unsure misses (S300-1/2): m2 8 right, d8r (seeded g5) 6, x1 6.
//
// Implementation (no copy of x1, d8 or m2): x1 (x-agent.js) runs unchanged on a ctx that
// carries d6's explore list (lexicalPoolCtx); its g5 handover is deferred for the length of
// that call (stub, no model call; the y-stack.js / j-reread.js trick). The wrapper then
// runs m2's recovery with m-agent.js's exported helpers (x1Contexts, recoveryLists,
// lpProbe) on the plain ctx (not the d6 ctx, so the recovery's CE load cannot trigger d6's
// widening) and calls the real g5 when the rule says so, on the d6 ctx with the seeding
// hook armed. The seed is the first YES in x1's own log (identical to d8's prompt-matched
// dYesPath on 696/696 stored handovers, tools/q-peek.js). So every path where m2 does not
// fire issues d8's calls in d8's order, and every m2 path issues m2's calls in m2's order
// (stub check: tools/q-check.js).
import { sandwichPrompt } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { lpProbe, recoveryLists, x1Contexts } from "./m-agent.js"
import { lexicalPoolCtx } from "./d-agent.js"
import { renderingCtx } from "./c-agent.js"
import { det } from "./i-det.js"
import { VARIANTS as X } from "./x-agent.js"
import { VARIANTS as G } from "./g-agent.js"

const MARK = Symbol("q-handover")
const M2 = { doubtLp: -0.1, recN: 6 }

// x1 with the g5 handover deferred (stub returns a marker; no model call)
async function deferred(ctx, record) {
    const real = G.g5
    G.g5 = { ...real, run: async () => ({ [MARK]: true, status: "ok", answer: "" }) }
    try {
        return { result: await X.x1.run(ctx, record), g5: real }
    } finally {
        G.g5 = real
    }
}

// d8's seeding hook: while armed, g5's first own mailbox search (k 20, the asker's mailbox,
// a query other than the question) returns [seed, ...results] cut to 20 (d-agent.js
// withSeededG5, same condition and list).
function seedHook(w, record) {
    const state = { armed: false, seed: null, seeded: 0 }
    const inner = w.search
    w.search = async (query, k, user = null) => {
        const paths = await inner(query, k, user)
        if (!state.armed || k !== 20 || user !== record.user || query === record.question || state.seeded || !state.seed) return paths
        state.seeded = 1
        return [...new Set([state.seed, ...paths])].slice(0, 20)
    }
    return state
}

async function stackQ(ctx, record, { render = null, explore = true, seedG5 = true, m2 = true, doubtLp = M2.doubtLp, recN = M2.recN } = {}) {
    const base = render ? renderingCtx(ctx, render) : ctx       // q2: labels on every answer prompt
    const w = explore ? lexicalPoolCtx(base, record) : Object.create(base)  // d6 explore list
    const seed = seedHook(w, record)
    const { result, g5 } = await deferred(w, record)
    const handover = Boolean(result[MARK])
    const { [MARK]: _, ...res } = result
    let out = res
    const q = { yesLp1: null, m2Fired: false, recovered: null, seed: null, seeded: 0 }
    if (handover || res.step === "commit") {
        const log = res.log ?? []
        const yes1 = log.find((l) => l.act === "check" && l.yes) ?? null
        q.yesLp1 = yes1?.yesLp ?? null
        let E = null, W0 = null, W1 = null
        if (m2 && (yes1?.yesLp ?? -9) < doubtLp) {
            // m2's recovery (same helpers and arguments as m2 / y1), on the plain ctx
            q.m2Fired = true
            ;({ W0, W1 } = await x1Contexts(base, record))
            const { snip50 } = await recoveryLists(base, record, W0, { mailboxOnly: true, rrfList: false })
            for (const p of snip50.slice(0, recN)) {
                const e = await lpProbe(base, record, p, log, "rec")
                if (e.yes && (e.yesLp ?? -9) >= (yes1?.yesLp ?? -9)) { E = p; break }
            }
            q.recovered = E
        }
        if (E) {
            // m2's answer over [E, W0 top 4] (ctx.generate, abstain retry over W1)
            const final = [E, ...W0.slice(0, 4)]
            const prompt = (paths) => sandwichPrompt(record.question, paths.map((p) => base.emailOf(p)))
            let r = await base.generate({ prompt: prompt(final) })
            let used = 1
            if (r.status === "ok" && isAbstain(r.answer) && W1.length) { r = await base.generate({ prompt: prompt(W1) }); used = 2 }
            const firstUnsure = res.unsure ?? handover
            out = { ...res, status: r.status, answer: r.answer ?? "", contextPaths: final, readPaths: used === 2 ? [...final, ...W1] : final, used, step: firstUnsure ? "recover-unsure" : "recover-sure", g5: undefined }
        } else if (handover) {
            // d8's seeded handover (real g5, on the d6 ctx with the hook armed)
            if (seedG5 && yes1?.path) { seed.seed = yes1.path; q.seed = yes1.path }
            seed.armed = true
            let g
            try { g = await g5.run(w, record) } finally { seed.armed = false }
            q.seeded = seed.seeded
            out = { ...res, ...g, step: "commit-g5", g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, switched: res.switched, log }
        }
    }
    return { ...out, q, dAdded: w.dAdded ?? [], dMasked: w.dMasked ?? 0, dExtraMs: Math.round(w.dExtraMs ?? 0), ...(base.cStats ? { c: { ...base.cStats, opts: render } } : {}) }
}

const T1 = { render: "thread1" }
const q1 = (ctx, record) => stackQ(ctx, record)
const q2 = (ctx, record) => stackQ(ctx, record, { render: T1 })

export { stackQ }
export const VARIANTS = {
    q1: { version: 1, describe: "x1 + d8 (d6 lexical CE explore list; g5 handover seeded with the first-YES email) + m2 recovery (doubted first YES, lp < -0.1: YES/NO probes down snip50m top 6, accepted E answered first [E, W0 top 4]); answer prompts unchanged", run: q1 },
    q2: { version: 1, describe: "q1 + thread labels on chain emails in every answer prompt (c-agent renderingCtx thread1)", run: q2 },
    "q-det-q1": { version: 1, describe: "q1 behind det() (mode all: fixed reset call before every model call; compare with i-det-x1 v2)", run: det(q1, { mode: "all" }) },
    "q-det-q2": { version: 1, describe: "q2 behind det() (mode all; compare with i-det-x1 v2)", run: det(q2, { mode: "all" }) },
}
