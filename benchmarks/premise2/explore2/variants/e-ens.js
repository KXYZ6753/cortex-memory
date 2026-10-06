// Worker e: ensembles and answer selection across systems. Notes: docs/premise-study/explore2/e.md
//
// e1  = x1 (frozen champion, run unchanged) + an agreement vote on its one two-answer step.
//       x1 commits (YES in W0) and answers with gates' prompt; when that answer is unsure it
//       hands over to the g5 agent and uses g5's answer. So on "commit-g5" questions two
//       answers already exist: g5's (x1's final) and gates' (x1.gatesAnswer).
//       If they agree (e-common sim >= 0.5) -> x1's answer, unchanged.
//       If they disagree -> a third, cheap opinion: the o4 prompt (rules after the emails)
//       over gates' first context W0. Take gates' answer iff the third agrees with gates and
//       not with g5; else keep g5 (= x1).
//       Diagnostics (logged, not used by e1's answer): a second third (r5: gates' prompt with
//       the best cross-encoder mailbox email in slot 5; = gates' answer when switched) and an
//       e2b pairwise choose step (decision prompt that does not share any answer prompt's
//       prefix, both A/B orders, first-token logprobs). They let the alternative selection
//       rules be evaluated exactly offline (replay variant e1o supplies the other text's verdict).
// e1o = REPLAY (no model calls): reads e1's stored row; on e1's disagreement questions outputs
//       the candidate e1 did not choose (g5 or gates), else e1's answer. Graded only so that both
//       candidate texts carry a J1 verdict; never a candidate system.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { byHeaderRank, clip } from "../../explore/variants.js"
import { generationOptions } from "../../ollama.js"
import { VARIANTS as X } from "./x-agent.js"
import { rulesLastPrompt } from "./o-reading.js"
import { rerankGate } from "./r-rerank.js"
import { lpCall } from "./n-conf.js"
import { sim, AGREE } from "./e-common.js"

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

async function gatesW0(ctx, record) {
    const q = record.question
    const global = (await ctx.search(q, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(q, 30, record.user)
    const mailbox = byHeaderRank(q, mailboxRanked.slice(0, 20), ctx.emailOf).slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    return { W0: switched ? mailbox : global, switched }
}

export function choosePrompt(question, a, b, emails) {
    return `Decide which of two answers to a question is supported by the emails.

Question: ${question}
Answer A: ${a}
Answer B: ${b}

Emails:
<<<EMAILS
${emails.map((e, i) => `[${i + 1}]\n${e}`).join("\n\n")}
EMAILS>>>

Question: ${question}
Answer A: ${a}
Answer B: ${b}
Which answer do the emails support? Reply with one letter: A or B.`
}

// first-token logprob of A and B (null if not in the top-k)
function abLp(r) {
    const top = r.tops?.[0] ?? []
    const of = (L) => { const hit = top.filter(([t]) => t.replace(/[^A-Za-z]/g, "").toUpperCase() === L); return hit.length ? Math.max(...hit.map((h) => h[1])) : null }
    return { A: of("A"), B: of("B"), reply: String(r.answer ?? "").trim().slice(0, 8) }
}

async function chooseStep(ctx, record, g5Text, gxText, W0, g5Paths) {
    const paths = [...new Set([...W0.slice(0, 3), ...(g5Paths ?? []).slice(0, 3)])].slice(0, 6)
    const emails = paths.map((p) => clip(ctx.emailOf(p), 1500))
    const q = record.question
    // order 1: A = g5, B = gates; order 2: A = gates, B = g5
    const o1 = abLp(await lpCall(ctx, { prompt: choosePrompt(q, g5Text, gxText, emails), numPredict: 2, topK: 10 }))
    const o2 = abLp(await lpCall(ctx, { prompt: choosePrompt(q, gxText, g5Text, emails), numPredict: 2, topK: 10 }))
    const lo = -20
    const score = ((o1.A ?? lo) - (o1.B ?? lo)) + ((o2.B ?? lo) - (o2.A ?? lo)) // > 0: g5 preferred
    return { paths, o1, o2, g5Score: r3(score) }
}

async function ensemble(ctx, record, { diag = true } = {}) {
    const x = await X.x1.run(ctx, record)
    if (x.step !== "commit-g5") return { ...x, eStep: "x1" }
    const q = record.question
    const g5Text = x.answer ?? "", gxText = x.gatesAnswer ?? ""
    const agree = sim(g5Text, gxText, q)
    if (agree >= AGREE) return { ...x, eStep: "agree", eSim: r3(agree) }
    const { W0, switched } = await gatesW0(ctx, record)
    // third opinion: o4 prompt over W0
    const o4 = await ctx.generate({ prompt: rulesLastPrompt(q, W0.map((p) => ctx.emailOf(p))) })
    const o4Text = o4.answer ?? ""
    const toGx = sim(gxText, o4Text, q) >= AGREE, toG5 = sim(g5Text, o4Text, q) >= AGREE
    const pickGates = toGx && !toG5
    const e = { eStep: "disagree", eSim: r3(agree), eW0: W0, eSwitched: switched, g5Answer: g5Text, o4Answer: o4Text, pick: pickGates ? "gates" : "g5" }
    if (diag) {
        if (!switched) { const r5 = await rerankGate(ctx, record, { mode: "gates", margin: -Infinity }); e.r5Answer = r5.answer ?? ""; e.r5Swapped = r5.swapped }
        else e.r5Answer = null // r5 == gates' context and prompt when switched
        e.choose = await chooseStep(ctx, record, g5Text, gxText, W0, x.contextPaths)
    }
    if (!pickGates) return { ...x, ...e }
    return { ...x, ...e, answer: gxText, status: "ok", contextPaths: W0, readPaths: [...new Set([...(x.readPaths ?? []), ...W0])] }
}

// replay: the candidate e1 did not choose (for grading only)
let e1Rows = null
function e1Row(questionKey, variant = "e1") {
    if (!e1Rows) {
        e1Rows = new Map()
        for (const line of readFileSync(join(".data/premise2/explore", "answers.jsonl"), "utf8").split("\n")) {
            if (!line.includes(`"variant":"${variant}"`)) continue
            const a = JSON.parse(line)
            if (a.variant === variant) e1Rows.set(a.questionKey, a)
        }
    }
    return e1Rows.get(questionKey)
}
function replayOther(ctx, record) {
    const a = e1Row(record.questionKey)
    if (!a) return { status: "error", answer: "", error: "no e1 row" }
    if (a.eStep !== "disagree") return { status: a.status, answer: a.answer, contextPaths: a.contextPaths, readPaths: a.readPaths, replay: "same" }
    const other = a.pick === "gates" ? a.g5Answer : a.gatesAnswer
    return { status: "ok", answer: other, contextPaths: a.contextPaths, readPaths: a.readPaths, replay: a.pick === "gates" ? "g5" : "gates" }
}

export const VARIANTS = {
    e1: { version: 1, describe: "x1 + agreement vote on x1's handover step: when g5's answer and gates' answer disagree, a third opinion (o4 prompt over gates' W0) decides; gates' answer only if the third agrees with it and not with g5 (diag: r5 third + e2b pairwise choose, both orders, logged)", run: (ctx, record) => ensemble(ctx, record) },
    e1o: { version: 1, describe: "REPLAY of e1 (no model calls): on e1's disagreement questions the candidate e1 did not pick; for J1 grading of both candidates only", run: async (ctx, record) => replayOther(ctx, record) },
}
