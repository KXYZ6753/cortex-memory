// Worker l (self-verification) DIAGNOSTICS: score stored candidate answers with e2b's
// pointwise YES/NO verification. Not deployable (candidates come from other variants'
// stored answers; the file is built by tools/l-build.js). Notes: explore2/l.md
//
//   l-v1  on "mixed" questions (>= 1 right and >= 1 wrong stored candidate), for each of
//         <= 8 candidates: verify against
//           G  the gold email                      (forms: after, no)
//           Y  x1's YES email (commit check / found; W0 top-1 if none)  (form: after)
//           O  the candidate's own reading context (form: after)
//         answer = the candidate with the highest Y-after score (ties: priority order).
//         Other questions: x1's stored answer, no calls.
//   l-v2  same questions, hits only (v2); forms before (G, Y) and plain (G).
//   l-v3  re-scores the candidates an l-xs1 run generated and verified (tools/l-build2.js ->
//         l-xs-cands.json) with the "before" form against the same YES email; answer = x1's
//         answer unless an alternative scores > 1 higher (as l-xs1). No other calls.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { verify } from "./l-common.js"

const loadCands = (ctx) => ctx.resource("l-cands", () => JSON.parse(readFileSync(join(ctx.dataDir, "explore", "l-cands.json"), "utf8")))

async function diag(ctx, record, configs, { hitsOnly = false } = {}) {
    const all = await loadCands(ctx)
    const q = all[record.questionKey]
    if (!q) throw new Error(`no candidates for ${record.questionKey}`)
    const x1 = q.x1
    if (!q.mixed || (hitsOnly && record.stratum !== "hit")) return { status: "ok", answer: x1.answer, skipped: true, step: x1.step }
    const yesPath = x1.yesPath ?? x1.W0?.[0] ?? null
    const evOf = (ev, c) => (ev === "G" ? [record.path] : ev === "Y" ? (yesPath ? [yesPath] : []) : c.ctx ?? [])
    const memo = new Map()
    const scores = q.cands.map(() => ({}))
    for (const [ev, form] of configs) {
        // own contexts: group candidates by context so the shared prefix stays cached
        const order = q.cands.map((c, i) => i)
        if (ev === "O") order.sort((a, b) => JSON.stringify(q.cands[a].ctx).localeCompare(JSON.stringify(q.cands[b].ctx)) || a - b)
        for (const i of order) {
            const c = q.cands[i]
            const paths = evOf(ev, c)
            if (!paths.length) { scores[i][`${ev}-${form}`] = null; continue }
            const mk = `${form}|${paths.join(",")}|${c.text}`
            if (!memo.has(mk)) memo.set(mk, await verify(ctx, { form, question: record.question, answer: c.text, emails: paths.map((p) => ctx.emailOf(p)) }))
            scores[i][`${ev}-${form}`] = memo.get(mk)
        }
    }
    const main = `${configs[0][0]}-${configs[0][1]}`
    const pickKey = configs.some(([e, f]) => e === "Y" && f === "after") ? "Y-after" : main
    let best = 0
    scores.forEach((s, i) => { if ((s[pickKey]?.s ?? -Infinity) > (scores[best][pickKey]?.s ?? -Infinity)) best = i })
    return {
        status: "ok", answer: q.cands[best].text, step: x1.step, picked: best, pickKey, yesPath, yesIsGold: yesPath === record.path,
        verify: q.cands.map((c, i) => ({ text: c.text.slice(0, 300), sources: c.sources, ctx: c.ctx, ...Object.fromEntries(Object.entries(scores[i]).map(([k, v]) => [k, v && { s: v.s, yes: v.yes, no: v.no, reply: v.reply, ms: v.ms, pt: v.pt }])) })),
        uniqueCalls: memo.size,
    }
}

async function rescore(ctx, record, { form = "before", margin = 1 } = {}) {
    const all = await ctx.resource("l-xs-cands", () => JSON.parse(readFileSync(join(ctx.dataDir, "explore", "l-xs-cands.json"), "utf8")))
    const q = all[record.questionKey]
    if (!q) return { status: "ok", answer: "", skipped: true, error: "no l-xs1 candidates" }
    const email = ctx.emailOf(q.yesPath)
    const scored = []
    for (const c of q.cands) scored.push({ ...c, v: await verify(ctx, { form, question: record.question, answer: c.text, emails: [email] }) })
    const def = scored.find((c) => c.srcs.includes("x1")) ?? scored[0]
    let best = def
    for (const c of scored) if (c !== def && (c.v.s ?? -Infinity) > (best.v.s ?? -Infinity)) best = c
    const pick = best !== def && (best.v.s ?? -Infinity) - (def.v.s ?? -Infinity) > margin ? best : def
    return { status: "ok", answer: pick.text, yesPath: q.yesPath, kept: pick.srcs.join("+"), rescored: scored.map((c) => ({ srcs: c.srcs, s: c.v.s, yes: c.v.yes, no: c.v.no, ms: c.v.ms })) }
}

export const VARIANTS = {
    "l-v1": { version: 1, describe: "DIAGNOSTIC: pointwise YES/NO verification of stored candidate answers on mixed questions (gold: after/no; x1 YES email: after; own context: after); answer = best Y-after", run: (ctx, record) => diag(ctx, record, [["Y", "after"], ["G", "after"], ["G", "no"], ["O", "after"]]) },
    "l-v3": { version: 1, describe: "DIAGNOSTIC: re-score l-xs1's own candidates (S300-1/S300-3 runs) with the 'before' verification form against the same YES email; x1's answer unless an alternative scores > 1 higher", run: (ctx, record) => rescore(ctx, record) },
    "l-v2": { version: 2, describe: "DIAGNOSTIC: as l-v1 on mixed hit questions only, with the answer before the evidence (gold, YES email) and a 'correct only' form (gold)", run: (ctx, record) => diag(ctx, record, [["Y", "before"], ["G", "before"], ["G", "plain"]], { hitsOnly: true }) },
}
