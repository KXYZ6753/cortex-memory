// Worker x: fused e2b agent (k3 commit/explore loop x g5 native-tools loop).
// See docs/premise-study/explore2/x.md.
//
//   x1  0. harness first search = gates' contexts (W0, W1), as k3.
//       1. COMMIT CHECK (model): per-email YES/NO on W0 in rank order (w7's probe),
//          stop at the first YES. Probes go through /api/chat with logprobs so the
//          YES/NO token margin is logged for offline study (same prompt as k3's).
//       2. On a YES: answer with gates' exact prompt over W0 (with logprobs). If that
//          answer is confident (mean token logprob >= tau, no hedge, no abstention;
//          worker n's gate) -> done. Otherwise the commit is doubted and the question is
//          handed to the g5 native-tools agent (own query, top 3 full + previews,
//          read/answer), whose answer is used.
//       3. No YES: k3's explore exactly (cross-encoder-ordered list, model pick + YES/NO
//          check, one FROM/TO/ABOUT search, <= 3 opens), answer over the working set.
// Offline simulation from stored k3 / g5 / n-g5 answers (tools/x-sim.js, x-tau.js):
// S300-2 87.0, S300-1 86.7 (gates 85.1 / 83.9; k3 86.1 / 86.6).
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { sandwichPrompt, byHeaderRank, clip } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { toBm25Query } from "../../../../src/bm25.js"
import { relevancePrompt } from "./w-map.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { pickPrompt, parsePick, listLines } from "./a-agent.js"
import { planPrompt, parsePlan } from "./k-agent.js"
import { lpCall, meanLp, HEDGE } from "./n-conf.js"
import { VARIANTS as G } from "./g-agent.js"
import { buildContexts } from "./p-perfect.js"
import { snippetText } from "../tools/p-common.js"

const PICK = () => generationOptions({ num_predict: 12 })
const PLAN = () => generationOptions({ num_predict: 40, stop: ["\n\n"] })
const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

// YES/NO probe with logprobs (same prompt text as k3's probe; 3 output tokens).
async function lpProbe(ctx, record, path, log) {
    const r = await lpCall(ctx, { prompt: relevancePrompt(record.question, clip(ctx.emailOf(path), 3000)), numPredict: 3, topK: 5 })
    const yes = ok(r) && /^\W*YES\b/i.test(r.answer ?? "")
    const top = r.tops?.[0] ?? []
    const lpOf = (word) => { const hit = top.find(([t]) => t.trim().toUpperCase() === word); return hit ? hit[1] : null }
    log.push({ act: "check", path, reply: String(r.answer ?? "").trim().slice(0, 10), yes, yesLp: r3(lpOf("YES")), noLp: r3(lpOf("NO")) })
    return yes
}

async function plannedSearch(ctx, record, plan, k = 20) {
    const db = await ctx.resource("k-fts", () => {
        const handle = new DatabaseSync(join(ctx.dataDir, "corpus.sqlite"), { readOnly: true })
        return { handle, stmt: handle.prepare("SELECT path FROM docs WHERE docs MATCH ? AND user = ? ORDER BY rank LIMIT ?"), close: () => handle.close() }
    })
    const NAME_STOP = new Set("the and email person sender recipient someone unknown enron mr mrs ms dr".split(" "))
    const nameTokens = (s) => [...new Set((String(s).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !NAME_STOP.has(w)))]
    const terms = toBm25Query(`${plan.about} ${record.question}`)
    if (!terms) return []
    const started = performance.now()
    const filters = []
    const from = nameTokens(plan.from), to = nameTokens(plan.to)
    if (from.length) filters.push(from.map((w) => `sender : "${w}"`).join(" OR "))
    if (to.length) filters.push(to.map((w) => `recipients : "${w}"`).join(" OR "))
    let paths = []
    try {
        if (filters.length) paths = db.stmt.all(`(${filters.map((f) => `(${f})`).join(" AND ")}) AND (${terms})`, record.user, k).map((row) => row.path)
        if (!paths.length && from.length) paths = db.stmt.all(`(${filters[0]}) AND (${terms})`, record.user, k).map((row) => row.path)
    } catch { paths = [] }
    ctx.searchExtraMs = (ctx.searchExtraMs ?? 0) + performance.now() - started
    if (!paths.length) paths = await ctx.search(`${plan.about} ${record.question}`, k, record.user)
    return paths
}

async function fusedAgent(ctx, record, { tau = -0.1, maxOpens = 3, listSize = 15, handover = "g5" } = {}) {
    const question = record.question
    const log = []
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 30, record.user)
    const hdr = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    const mailbox = hdr.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const [W0, W1] = switched ? [mailbox, global] : [global, mailbox]
    const prompt = (paths) => sandwichPrompt(question, paths.map((p) => ctx.emailOf(p)))

    // 1. commit check
    let yesAt = -1
    for (let i = 0; i < W0.length; i++) if (await lpProbe(ctx, record, W0[i], log)) { yesAt = i; break }

    if (yesAt >= 0) {
        // 2. committed: gates' exact answer (logprobs); doubt -> hand over to g5
        const first = await lpCall(ctx, { prompt: prompt(W0) })
        const mean = meanLp(first)
        const unsure = isAbstain(first.answer) || HEDGE.test(first.answer ?? "") || mean < tau || !ok(first)
        const diag = { yesAt, firstMean: r3(mean), unsure, gatesAnswer: first.answer, switched, log }
        if (!unsure) return { status: first.status, answer: first.answer, contextPaths: W0, readPaths: W0, used: 1, step: "commit", ...diag }
        const g = await G[handover].run(ctx, record)
        return { ...g, step: `commit-${handover}`, g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, ...diag }
    }

    // 3. explore (k3)
    const answerFrom = async (first, extra) => {
        let result = await ctx.generate({ prompt: prompt(first) })
        let used = 1
        if (result.status === "ok" && isAbstain(result.answer) && W1.length) { result = await ctx.generate({ prompt: prompt(W1) }); used = 2 }
        return { status: result.status, answer: result.answer ?? "", contextPaths: first, readPaths: used === 2 ? [...first, ...W1] : first, switched, used, log, ...extra }
    }
    const seen = new Set(W0)
    const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
    const cands = [...new Set([...W1, ...mailboxRanked])].filter((p) => !seen.has(p))
    const scores = await model.score(question, cands.map((p) => rerankText(ctx.emailOf(p))))
    let pool = cands.map((p, i) => ({ p, s: scores[i] })).sort((a, b) => b.s - a.s).map((x) => x.p).slice(0, listSize)
    const opened = []
    let found = null, firstPick = null, searched = false
    while (opened.length < maxOpens && !found) {
        if (!pool.length) break
        const lines = listLines(ctx, record, pool)
        const pick = await ctx.generate({ prompt: pickPrompt(question, lines), options: PICK() })
        const n = parsePick(pick.answer, pool.length)
        log.push({ act: "pick", reply: String(pick.answer ?? "").trim().slice(0, 12), path: n ? pool[n - 1] : null, listed: pool.slice() })
        if (n) {
            const path = pool[n - 1]
            opened.push(path); seen.add(path); firstPick ??= path
            if (await lpProbe(ctx, record, path, log)) { found = path; break }
        }
        if (!searched) {
            searched = true
            const planReply = await ctx.generate({ prompt: planPrompt(question), options: PLAN() })
            const plan = parsePlan(planReply.answer)
            const results = await plannedSearch(ctx, record, plan)
            log.push({ act: "search", reply: String(planReply.answer ?? "").trim().slice(0, 160), plan, results: results.slice(0, 10) })
            pool = [...new Set([...results.slice(0, 10), ...pool])].filter((p) => !seen.has(p)).slice(0, listSize)
        } else {
            pool = pool.filter((p) => !seen.has(p))
            if (!n) break
        }
    }
    const final = found ? [found, ...W0.filter((p) => p !== found).slice(0, 4)] : firstPick ? [...W0.slice(0, 4), firstPick] : W0
    return answerFrom(final, { step: found ? "found" : firstPick ? "nofound" : "nopick", checks: log.filter((l) => l.act === "check").length, openedPaths: opened, foundPath: found })
}

// x2 / x3: k3 whose first working set is p3's triggered-swap context (lead's suggestion),
// optionally with a doubted-YES rule (x3): a YES whose token logprob is below doubtLp
// does not stop the agent; it keeps checking W0 for a confident YES, and if none,
// explores (k3) for a new YES email. A new YES email E -> answer over [E, W0 top 4];
// none -> gates' prompt over W0 (as a normal commit, so hit prompts only change when a
// new YES email is found).
const P3 = { trigger: 0, nswap: 2, bestLast: true, drop: "foreign", pick: "maxsnip" }
async function p3Agent(ctx, record, { doubtLp = null, maxOpens = 3, listSize = 15 } = {}) {
    const question = record.question
    const log = []
    // p3 retrieval (p-perfect.js perfect(), same lists and CE scoring)
    const globalHits = ctx.bm25.search(question, 20)
    const global = globalHits.map((hit) => hit.path)
    const globalScores = globalHits.slice(0, 2).map((hit) => hit.score)
    const mailboxWide = await ctx.search(question, 50, record.user)
    const memo = new Map()
    const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
    const scoreCe = async (paths) => {
        const todo = [...new Set(paths)].filter((p) => !memo.has(p))
        if (todo.length) { const s = await model.score(question, todo.map((p) => rerankText(ctx.emailOf(p)))); todo.forEach((p, i) => memo.set(p, s[i])) }
        return new Map(paths.map((p) => [p, memo.get(p)]))
    }
    const scoreSnip = async (paths) => {
        const std = await scoreCe(paths)
        const todo = paths.filter((p) => snippetText(question, ctx.emailOf(p)) !== rerankText(ctx.emailOf(p)))
        const s = todo.length ? await model.score(question, todo.map((p) => snippetText(question, ctx.emailOf(p)))) : []
        todo.forEach((p, i) => std.set(p, s[i]))
        return std
    }
    const { contexts, switched, swapped } = await buildContexts({ question, user: record.user, lists: { global, mailbox: mailboxWide, dense: null, globalScores }, emailOf: ctx.emailOf, scoreCe, scoreSnip, opts: P3 })
    const [W0, W1] = contexts
    const mailboxRanked = mailboxWide.slice(0, 30)
    const prompt = (paths) => sandwichPrompt(question, paths.map((p) => ctx.emailOf(p)))
    const answerFrom = async (first, extra) => {
        let result = await ctx.generate({ prompt: prompt(first) })
        let used = 1
        if (result.status === "ok" && isAbstain(result.answer) && W1.length) { result = await ctx.generate({ prompt: prompt(W1) }); used = 2 }
        return { status: result.status, answer: result.answer ?? "", contextPaths: first, readPaths: used === 2 ? [...first, ...W1] : first, switched, swapped, used, log, ...extra }
    }
    // 1. commit check (stop at the first YES; with doubtLp, at the first confident YES)
    let doubted = null
    for (let i = 0; i < W0.length; i++) {
        if (!(await lpProbe(ctx, record, W0[i], log))) continue
        const lp = log[log.length - 1].yesLp ?? 0
        if (doubtLp === null || lp >= doubtLp) return answerFrom(W0, { step: "commit", yesAt: i, doubted })
        doubted ??= W0[i]
    }
    // 2. explore (k3): CE-ordered list, pick + check, one FROM/TO/ABOUT search, <= 3 opens
    const seen = new Set(W0)
    const cands = [...new Set([...W1, ...mailboxRanked])].filter((p) => !seen.has(p))
    const ce = await scoreCe(cands)
    let pool = [...cands].sort((a, b) => ce.get(b) - ce.get(a)).slice(0, listSize)
    const opened = []
    let found = null, firstPick = null, searched = false
    while (opened.length < maxOpens && !found) {
        if (!pool.length) break
        const lines = listLines(ctx, record, pool)
        const pick = await ctx.generate({ prompt: pickPrompt(question, lines), options: PICK() })
        const n = parsePick(pick.answer, pool.length)
        log.push({ act: "pick", reply: String(pick.answer ?? "").trim().slice(0, 12), path: n ? pool[n - 1] : null, listed: pool.slice() })
        if (n) {
            const path = pool[n - 1]
            opened.push(path); seen.add(path); firstPick ??= path
            if (await lpProbe(ctx, record, path, log)) { found = path; break }
        }
        if (!searched) {
            searched = true
            const planReply = await ctx.generate({ prompt: planPrompt(question), options: PLAN() })
            const plan = parsePlan(planReply.answer)
            const results = await plannedSearch(ctx, record, plan)
            log.push({ act: "search", reply: String(planReply.answer ?? "").trim().slice(0, 160), plan, results: results.slice(0, 10) })
            pool = [...new Set([...results.slice(0, 10), ...pool])].filter((p) => !seen.has(p)).slice(0, listSize)
        } else {
            pool = pool.filter((p) => !seen.has(p))
            if (!n) break
        }
    }
    const extra = { checks: log.filter((l) => l.act === "check").length, openedPaths: opened, foundPath: found, doubted }
    if (doubted) {
        // doubted commit: only a new YES email changes the prompt
        if (found) return answerFrom([found, ...W0.filter((p) => p !== found).slice(0, 4)], { step: "doubt-found", ...extra })
        return answerFrom(W0, { step: "doubt-kept", ...extra })
    }
    const final = found ? [found, ...W0.filter((p) => p !== found).slice(0, 4)] : firstPick ? [...W0.slice(0, 4), firstPick] : W0
    return answerFrom(final, { step: found ? "found" : firstPick ? "nofound" : "nopick", ...extra })
}

export const VARIANTS = {
    x2: { version: 1, describe: "k3 agent whose first working set is p3's triggered CE-swap context (commit check sees swapped emails in slots 4-5); probes with logprobs", run: (ctx, record) => p3Agent(ctx, record) },
    x3: { version: 1, describe: "x2 + doubted YES: a YES with token logprob < -0.2 does not stop; keep checking W0, else explore (k3); a new YES email goes first, otherwise W0 unchanged", run: (ctx, record) => p3Agent(ctx, record, { doubtLp: -0.2 }) },
    x1: { version: 1, describe: "Fused agent: k3 commit check (YES/NO, logprobs logged); committed + confident gates answer kept, committed + unsure (n's gate, tau -0.1) handed to the g5 native-tools agent; no YES -> k3 explore", run: (ctx, record) => fusedAgent(ctx, record) },
}
