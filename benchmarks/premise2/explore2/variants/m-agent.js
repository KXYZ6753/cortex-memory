// Worker m: recall-side improvements to x1 on misses. See docs/premise-study/explore2/m.md.
//
//   m-diag (diagnostic, no answer): x1's gates contexts; YES/NO probes (logprobs) on ALL
//     of W0 and on the top of two recovery lists (W0 excluded): snip50 = max(CE std,
//     CE question-snippet) over mailbox BM25 top 50 + global top 10 (p3's score), and
//     rrf3 = RRF(CE std, owner-name-stripped mailbox BM25, subject x3/sender x2 mailbox
//     BM25). For YES emails: a single-email extract answer (own template, logprobs) and,
//     for the first W0 YES vs the best recovery YES, a pairwise "which email" probe in
//     both orders. Logged for offline simulation of doubt/recovery rules.
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { clip, byHeaderRank, sandwichPrompt } from "../../explore/variants.js"
import { generationOptions } from "../../ollama.js"
import { toBm25Query } from "../../../../src/bm25.js"
import { pickPrompt, parsePick, listLines } from "./a-agent.js"
import { planPrompt, parsePlan } from "./k-agent.js"
import { HEDGE } from "./n-conf.js"
import { VARIANTS as G } from "./g-agent.js"
import { openBm25 } from "../../bm25.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { relevancePrompt } from "./w-map.js"
import { lpCall, meanLp } from "./n-conf.js"
import { snippetText } from "../tools/p-common.js"
import { ownerTokens } from "./m-common.js"
import { isAbstain } from "../../prompts.js"

const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)

// Same probe as x1 (x-agent.js lpProbe): relevancePrompt, email clipped to 3,000 chars, 3 tokens.
export async function lpProbe(ctx, record, path, log, tag = "check") {
    const r = await lpCall(ctx, { prompt: relevancePrompt(record.question, clip(ctx.emailOf(path), 3000)), numPredict: 3, topK: 5 })
    const yes = ok(r) && /^\W*YES\b/i.test(r.answer ?? "")
    const top = r.tops?.[0] ?? []
    const lpOf = (word) => { const hit = top.find(([t]) => t.trim().toUpperCase() === word); return hit ? hit[1] : null }
    const entry = { act: tag, path, reply: String(r.answer ?? "").trim().slice(0, 10), yes, yesLp: r3(lpOf("YES")), noLp: r3(lpOf("NO")) }
    log.push(entry)
    return entry
}

// Single-email extract answer: email first (no shared prefix with the sandwich answer prompt).
export const extractPrompt = (question, email) => `Email:
<<<EMAIL
${email}
EMAIL>>>

Using only the email above, answer the question in one sentence. If the email does not contain the answer, reply with exactly: NOT IN EMAILS

Question: ${question}
Answer:`

export const pairPrompt = (question, a, b) => `Which of the two emails below contains the answer to the question? Reply with only 1 or 2.

Question: ${question}

Email 1:
<<<EMAIL
${a}
EMAIL>>>

Email 2:
<<<EMAIL
${b}
EMAIL>>>

Question: ${question}
Which email contains the answer (1 or 2)?`

export async function pairProbe(ctx, record, a, b) {
    const r = await lpCall(ctx, { prompt: pairPrompt(record.question, clip(ctx.emailOf(a), 3000), clip(ctx.emailOf(b), 3000)), numPredict: 3, topK: 5 })
    const top = r.tops?.[0] ?? []
    const lpOf = (word) => { const hit = top.find(([t]) => t.trim() === word); return hit ? hit[1] : null }
    const pick = /^\W*1/.test(r.answer ?? "") ? 1 : /^\W*2/.test(r.answer ?? "") ? 2 : 0
    return { pick, lp1: r3(lpOf("1")), lp2: r3(lpOf("2")), reply: String(r.answer ?? "").trim().slice(0, 6) }
}

export async function extract(ctx, record, path) {
    const r = await lpCall(ctx, { prompt: extractPrompt(record.question, clip(ctx.emailOf(path), 3000)), numPredict: 60, topK: 1 })
    return { path, answer: String(r.answer ?? "").slice(0, 200), abstain: isAbstain(r.answer) || /NOT IN (THE )?EMAIL/i.test(r.answer ?? ""), mean: r3(meanLp(r)), status: r.status }
}

const rrf = (lists, k = 10) => {
    const s = new Map()
    for (const l of lists) l.forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (k + i + 1)))
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
}

// Recovery lists (W0 excluded). Returns { snip50, rrf3, ceStd, ceMax } (score maps for logging).
export async function recoveryLists(ctx, record, W0, { mailboxOnly = false, rrfList = true } = {}) {
    const question = record.question
    const seen = new Set(W0)
    const mailboxWide = await ctx.search(question, 50, record.user)
    const global10 = mailboxOnly ? [] : await ctx.search(question, 10)
    const pool = [...new Set(mailboxOnly ? mailboxWide : [...mailboxWide, ...global10])].filter((p) => !seen.has(p))
    const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
    const std = pool.length ? await model.score(question, pool.map((p) => rerankText(ctx.emailOf(p)))) : []
    const snipIdx = pool.map((p, i) => [p, i]).filter(([p]) => snippetText(question, ctx.emailOf(p)) !== rerankText(ctx.emailOf(p)))
    const sn = snipIdx.length ? await model.score(question, snipIdx.map(([p]) => snippetText(question, ctx.emailOf(p)))) : []
    const ceStd = new Map(pool.map((p, i) => [p, std[i]]))
    const ceMax = new Map(ceStd)
    snipIdx.forEach(([p], j) => ceMax.set(p, Math.max(ceStd.get(p), sn[j])))
    const snip50 = [...pool].sort((a, b) => ceMax.get(b) - ceMax.get(a))
    const ce50 = [...pool].sort((a, b) => ceStd.get(b) - ceStd.get(a))
    if (!rrfList) return { snip50, rrf3: [], ceStd, ceMax, mailboxWide }
    // owner-stripped and subject-weighted mailbox BM25
    const own = ownerTokens(question, record.user)
    const stripped = question.split(/\s+/).filter((w) => { const t = w.toLowerCase().replace(/[^a-z]/g, ""); return !own.has(t) && !own.has(t.replace(/s$/, "")) }).join(" ")
    const strip = (await ctx.search(stripped, 50, record.user)).filter((p) => !seen.has(p))
    const weighted = await ctx.resource("m-bm25-subj", () => openBm25(join(ctx.dataDir, "corpus.sqlite"), { weights: [0, 0, 3, 2, 1, 1] }))
    const t0 = performance.now()
    const subj = weighted.search(question, 50, record.user).map((h) => h.path).filter((p) => !seen.has(p))
    ctx.searchExtraMs = (ctx.searchExtraMs ?? 0) + performance.now() - t0
    return { snip50, rrf3: rrf([ce50, strip, subj]), ceStd, ceMax, mailboxWide }
}

// x1's gates contexts (x-agent.js fusedAgent step 0).
export async function x1Contexts(ctx, record) {
    const question = record.question
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 30, record.user)
    const hdr = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    const mailbox = hdr.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const [W0, W1] = switched ? [mailbox, global] : [global, mailbox]
    return { W0, W1, switched, mailboxRanked }
}

async function diag(ctx, record, { nList = 10, maxExtract = 5 } = {}) {
    const log = []
    const { W0, switched } = await x1Contexts(ctx, record)
    const w0 = []
    for (const p of W0) w0.push(await lpProbe(ctx, record, p, log, "w0"))
    const { snip50, rrf3, ceMax } = await recoveryLists(ctx, record, W0)
    const order = [...new Set([...snip50.slice(0, nList), ...rrf3.slice(0, nList)])]
    const rec = []
    for (const p of order) rec.push(await lpProbe(ctx, record, p, log, "rec"))
    const yesAll = [...w0, ...rec].filter((e) => e.yes)
    const extracts = []
    for (const e of yesAll.slice(0, maxExtract)) extracts.push(await extract(ctx, record, e.path))
    const yes1 = w0.find((e) => e.yes)
    const recYes = rec.filter((e) => e.yes).sort((a, b) => (b.yesLp ?? -9) - (a.yesLp ?? -9))
    let pair = null
    if (yes1 && recYes.length) {
        const b = recYes[0].path
        pair = { a: yes1.path, b, ab: await pairProbe(ctx, record, yes1.path, b), ba: await pairProbe(ctx, record, b, yes1.path) }
    }
    return {
        status: "diagnostic", answer: "", switched, W0,
        snip50: snip50.slice(0, 15), rrf3: rrf3.slice(0, 15), ce: Object.fromEntries(snip50.slice(0, 15).map((p) => [p, r3(ceMax.get(p))])),
        log, extracts, pair,
    }
}

// ---- x1 re-implemented with recovery hooks (x-agent.js fusedAgent; unchanged paths are
// call-for-call identical to x1) ----
const PICK = () => generationOptions({ num_predict: 12 })
const PLAN = () => generationOptions({ num_predict: 40, stop: ["\n\n"] })

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

// Options (defaults = x1):
//   doubt(info) -> bool    which commits run the recovery (info: unsure, yesLp, yesAt); null = never
//   recN                   recovery probes over snip50 (W0 excluded), in order, stop at the first accepted YES
//   accept(entry, yes1)    accept a recovery YES (entry/yes1 carry yesLp)
//   place                  "slot5" (W0 top 4 + E) or "first" (E + W0 top 4)
//   recUnsureOnly          recovery replaces the g5 handover only (sure commits untouched)
//   exploreList            "x1" (CE over W1 ∪ mailbox 30) or "snip50"
//   extraProbes            after an unsuccessful explore, probe that many unopened snip50 emails
export async function mAgent(ctx, record, opt = {}) {
    const { tau = -0.1, maxOpens = 3, listSize = 15, handover = "g5", doubt = null, recN = 6, accept = (e) => e.yes, place = "slot5", exploreList = "x1", extraProbes = 0, mailboxOnly = true } = opt
    const question = record.question
    const log = []
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 30, record.user)
    const hdr = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    const mailbox = hdr.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const [W0, W1] = switched ? [mailbox, global] : [global, mailbox]
    const prompt = (paths) => sandwichPrompt(question, paths.map((p) => ctx.emailOf(p)))
    const answerFrom = async (first, extra) => {
        let result = await ctx.generate({ prompt: prompt(first) })
        let used = 1
        if (result.status === "ok" && isAbstain(result.answer) && W1.length) { result = await ctx.generate({ prompt: prompt(W1) }); used = 2 }
        return { status: result.status, answer: result.answer ?? "", contextPaths: first, readPaths: used === 2 ? [...first, ...W1] : first, switched, used, log, ...extra }
    }
    let lists = null
    const getLists = async () => (lists ??= await recoveryLists(ctx, record, W0, { mailboxOnly, rrfList: false }))

    // 1. commit check (x1)
    let yesAt = -1
    for (let i = 0; i < W0.length; i++) if ((await lpProbe(ctx, record, W0[i], log)).yes) { yesAt = i; break }

    if (yesAt >= 0) {
        const yes1 = log[log.length - 1]
        const first = await lpCall(ctx, { prompt: prompt(W0) })
        const mean = meanLp(first)
        const unsure = isAbstain(first.answer) || HEDGE.test(first.answer ?? "") || mean < tau || !ok(first)
        const diag = { yesAt, firstMean: r3(mean), unsure, gatesAnswer: first.answer, switched, log }
        // 2'. recovery on a doubted commit (m)
        if (doubt && doubt({ unsure, yesLp: yes1.yesLp ?? -9, yesAt })) {
            const { snip50 } = await getLists()
            let E = null
            for (const p of snip50.slice(0, recN)) {
                const e = await lpProbe(ctx, record, p, log, "rec")
                if (e.yes && accept(e, yes1)) { E = p; break }
            }
            if (E) {
                const final = place === "first" ? [E, ...W0.slice(0, 4)] : [...W0.slice(0, 4), E]
                return answerFrom(final, { step: unsure ? "recover-unsure" : "recover-sure", recovered: E, ...diag, log })
            }
        }
        if (!unsure) return { status: first.status, answer: first.answer, contextPaths: W0, readPaths: W0, used: 1, step: "commit", ...diag }
        const g = await G[handover].run(ctx, record)
        return { ...g, step: `commit-${handover}`, g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, ...diag }
    }

    // 3. explore (k3 / x1), optionally over the snip50 list and with extra probes
    const seen = new Set(W0)
    let pool
    if (exploreList === "snip50") pool = (await getLists()).snip50.filter((p) => !seen.has(p)).slice(0, listSize)
    else {
        const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
        const cands = [...new Set([...W1, ...mailboxRanked])].filter((p) => !seen.has(p))
        const scores = await model.score(question, cands.map((p) => rerankText(ctx.emailOf(p))))
        pool = cands.map((p, i) => ({ p, s: scores[i] })).sort((a, b) => b.s - a.s).map((x) => x.p).slice(0, listSize)
    }
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
            if ((await lpProbe(ctx, record, path, log)).yes) { found = path; break }
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
    let extraFound = false
    if (!found && extraProbes > 0) {
        const { snip50 } = await getLists()
        for (const p of snip50.filter((x) => !seen.has(x)).slice(0, extraProbes)) {
            seen.add(p)
            if ((await lpProbe(ctx, record, p, log, "xprobe")).yes) { found = p; extraFound = true; break }
        }
    }
    const final = found ? [found, ...W0.filter((p) => p !== found).slice(0, 4)] : firstPick ? [...W0.slice(0, 4), firstPick] : W0
    return answerFrom(final, { step: found ? (extraFound ? "found-x" : "found") : firstPick ? "nofound" : "nopick", checks: log.filter((l) => l.act === "check").length, openedPaths: opened, foundPath: found })
}

const M1 = { doubt: ({ yesLp }) => yesLp < -0.1, recN: 6, accept: (e, yes1) => e.yes && (e.yesLp ?? -9) >= (yes1.yesLp ?? -9), place: "slot5", mailboxOnly: true }

export const VARIANTS = {
    m1: { version: 1, describe: "x1 + recall step on a doubted YES (first-YES token logprob < -0.1): YES/NO probes down snip50m (asker's mailbox BM25 top 50 by max(CE std, CE snippet), W0 excluded) top 6; a YES with logprob >= the first YES's goes into slot 5 (W0 top 4 + E, gates' prompt); otherwise x1 unchanged", run: (ctx, record) => mAgent(ctx, record, M1) },
    m2: { version: 1, describe: "m1 with the recovered email first (E + W0 top 4)", run: (ctx, record) => mAgent(ctx, record, { ...M1, place: "first" }) },
    m3: { version: 1, describe: "m1 + after an unsuccessful explore (no YES email found), YES/NO probes on the top 3 unopened snip50m emails; a YES becomes the found email (first, as in x1's found path)", run: (ctx, record) => mAgent(ctx, record, { ...M1, extraProbes: 3 }) },
    "m-diag": { version: 1, describe: "DIAGNOSTIC (no answer): YES/NO logprob probes on all of W0 + top 10 of snip50 and rrf3 recovery lists; single-email extract answers for YES emails; pairwise first-W0-YES vs best recovery YES (both orders)", run: (ctx, record) => diag(ctx, record) },
}
