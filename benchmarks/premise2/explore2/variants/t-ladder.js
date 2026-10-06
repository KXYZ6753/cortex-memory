// Worker t: understand and simplify x1. See docs/premise-study/explore2/t.md.
//
// Ablation ladder from the frozen plain-text agent (`agent`, premise2-agent-v1) to x1.
// Interface rungs (new here); each adds ONE component to the previous rung and keeps the
// frozen agent's semantics otherwise (global BM25 search, 10 results per search, results
// as frozen snippet lines = subject | sender | first 200 chars, open <= 3 emails of up to
// 12,000 chars, 5 rounds of search/open then a forced answer, frozen answer rules):
//   t1  + native tool calls (Ollama /api/chat `tools`: search / open / answer) instead of
//       the SEARCH:/OPEN:/ANSWER: text protocol. The answer is the agent's own text.
//   t2  t1 + the top 3 results of every search shown IN FULL (clipped at 3,500 chars, as
//       g5), the other 7 as frozen snippet lines. Own answer text.
//   t3  t2 + the final answer is a separate sandwich-prompt call over the emails the
//       agent saw in full (explicit opens first, then full-shown results; <= 5), not the
//       agent's own text. No gates fallback: with nothing read, the agent's text is used.
// The next rungs are stored variants: g5 (= t3 + mailbox-only search, query-focused
// previews, 3 tool calls, empty-turn re-ask, gates fallback/abstain retry), g2 (harness
// runs the first search: gates' context in full), k1 (per-email YES/NO commit check +
// model list-pick explore), k3 (cross-encoder-ordered pick list), x1 (logprob handover).
//
//   t-x1r   x1 re-run under a new id (identical code path) for run-to-run variation.
import { join } from "node:path"
import { sandwichPrompt, byHeaderRank, clip } from "../../explore/variants.js"
import { ABSTAIN, isAbstain } from "../../prompts.js"
import { relevancePrompt } from "./w-map.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { pickPrompt, parsePick, listLines } from "./a-agent.js"
import { lpCall, meanLp, HEDGE } from "./n-conf.js"
import { VARIANTS as G } from "./g-agent.js"
import { generationOptions } from "../../ollama.js"
import { newEpisodeState, snippetLine, renderOpened, conversationTokens, textTokens, MAX_ROUNDS, SEARCH_K } from "../../agent.js"
import { TOKEN_CAP } from "../../prompts.js"
import { VARIANTS as X } from "./x-agent.js"

const FULL_CHARS = 3500
const RESERVE = 1200 // output + tool-definition allowance (tokens, conservative)
const clipFull = (email) => (email.length <= FULL_CHARS ? email : `${email.slice(0, FULL_CHARS)}\n[... email truncated ...]`)

const TOOLS = (full) => [
    { type: "function", function: { name: "search", description: full ? `Search all emails. Returns the ${SEARCH_K} best matches: the best ${full} in full, the others with an id, subject, sender and the start of the email.` : `Search all emails. Returns the ${SEARCH_K} best matches, each with an id, subject, sender and the start of the email.`, parameters: { type: "object", properties: { query: { type: "string", description: "keywords" } }, required: ["query"] } } },
    { type: "function", function: { name: "open", description: "Show up to 3 full emails from the search results.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "integer" }, description: "email ids, e.g. [2, 5]" } }, required: ["ids"] } } },
    { type: "function", function: { name: "answer", description: "Give your final answer and end the task.", parameters: { type: "object", properties: { text: { type: "string", description: "the answer" } }, required: ["text"] } } },
]

// The frozen agent's first message, reworded for tools (same rules, same budget).
const firstMessage = (question, full) => `You answer a question about a person's email archive. You cannot see the archive, but you can search it.

Use the tools, one call per turn:
- search(query): searches all emails and lists the ${SEARCH_K} best matches${full ? `; the best ${full} are shown in full, the others` : ","} each with an id, subject, sender and the start of the email
- open(ids): shows up to 3 full emails from the search results
- answer(text): gives your final answer and ends the task

You have ${MAX_ROUNDS} rounds of search or open before you must answer.

Answer rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, answer with exactly: ${ABSTAIN}

Question: ${question}`

const footer = (left) => (left > 0 ? `Rounds left: ${left}.` : "No rounds left. Call answer now.")
const normIds = (ids) => (Array.isArray(ids) ? ids : [ids]).map((v) => Number(String(v).replace(/\D/g, ""))).filter((n) => Number.isInteger(n) && n > 0)

async function toolAgent(ctx, record, { full = 0, final = "own" } = {}) {
    const question = record.question
    const state = newEpisodeState()
    const messages = [{ role: "user", content: firstMessage(question, full) }]
    const fullShown = []   // paths shown in full by a search, in order
    const opens = []       // paths opened explicitly, in order
    const shown = []
    const actions = []
    const room = () => TOKEN_CAP - RESERVE - conversationTokens(messages)
    let rounds = 0, invalidRun = 0, forcedEarly = false, agentText = null, status = "ok"

    const runSearch = async (query) => {
        const paths = await ctx.search(query, SEARCH_K)
        if (!paths.length) return `No emails matched the search "${query}".`
        const lines = []
        let budget = room() - 200
        for (const [i, path] of paths.entries()) {
            if (!shown.includes(path)) shown.push(path)
            const line = snippetLine(state, path, ctx.emailOf)
            const already = state.opened.has(path) || fullShown.includes(path)
            if (i < full && !already) {
                const block = `[${state.idOf.get(path)}] (full email)\n${clipFull(ctx.emailOf(path))}`
                if (textTokens(block) <= budget - textTokens(line) * (paths.length - i)) { lines.push(block); budget -= textTokens(block); fullShown.push(path); continue }
            }
            lines.push(line)
            budget -= textTokens(line)
        }
        return `Search results for "${query}":\n${lines.join("\n")}`
    }

    for (;;) {
        const forced = rounds >= MAX_ROUNDS || forcedEarly
        const body = { messages, options: generationOptions({ num_predict: 160 }), truncate: false, tools: forced ? TOOLS(full).filter((t) => t.function.name === "answer") : TOOLS(full) }
        const data = await ctx.chatRaw(body)
        if (data.error) { actions.push({ name: "error", error: String(data.error).slice(0, 200) }); status = /context|length|exceed/i.test(data.error) ? "context_overflow" : "http_error"; break }
        const call = data.message?.tool_calls?.[0]
        let name = call?.function?.name ?? "text"
        let args = call?.function?.arguments ?? {}
        if (typeof args === "string") { try { args = JSON.parse(args) } catch { args = {} } }
        const content = String(data.message?.content ?? "")
        if (name === "text") args = { text: content }
        actions.push({ name, args: name === "text" ? { text: content.slice(0, 200) } : args, forced })
        if (data.done_reason === "length" && name === "text") status = "output_limit"
        if (name === "answer" || (name === "text" && content.trim()) || forced) {
            agentText = name === "answer" || name === "text" ? String(args.text ?? "").trim() : ""
            break
        }
        messages.push({ role: "assistant", content, tool_calls: data.message?.tool_calls ?? [] })
        rounds++
        let reply
        if (name === "search") {
            invalidRun = 0
            reply = await runSearch(String(args.query ?? "").trim() || question)
        } else if (name === "open") {
            invalidRun = 0
            const r = renderOpened(normIds(args.ids), state, ctx.emailOf, room() - 64)
            for (const p of r.opened) opens.push(p)
            reply = r.text || "Nothing opened."
        } else {
            // empty turn or unknown tool: a fixed correction consumes the round (frozen rule)
            invalidRun++
            if (invalidRun >= 2) forcedEarly = true
            reply = "That reply had no valid tool call. Call search, open or answer."
        }
        messages.push({ role: name === "text" ? "user" : "tool", ...(name === "text" ? {} : { tool_name: name }), content: `${reply}\n\n${footer(forcedEarly ? 0 : MAX_ROUNDS - rounds)}` })
    }

    const read = [...opens, ...fullShown.filter((p) => !opens.includes(p))]
    const base = {
        actions, rounds, shownPaths: shown, openedPaths: [...opens], fullShownPaths: fullShown, agentText,
        nSearch: actions.filter((a) => a.name === "search").length, nOpen: actions.filter((a) => a.name === "open").length,
        goldShown: shown.includes(record.path), goldFull: read.includes(record.path),
    }
    if (final === "sandwich" && read.length) {
        const ctxPaths = read.slice(0, 5)
        const result = await ctx.generate({ prompt: sandwichPrompt(question, ctxPaths.map((p) => ctx.emailOf(p))) })
        return { status: result.status, answer: result.answer ?? "", contextPaths: ctxPaths, readPaths: ctxPaths, ...base }
    }
    return { status: agentText ? status : status === "ok" ? "empty" : status, answer: agentText ?? "", contextPaths: [], readPaths: read, ...base }
}

// ---- simplified x1 ----
// x1's exact call sequence (same probe / answer calls, logprobs on probes and the commit
// answer) with two simplifications, each optional:
//   explore "lean": one model pick from the CE-ordered list + its YES/NO check; no model-
//     written FROM/TO/ABOUT search, no 2nd/3rd open (x1 logs: the search produced the
//     found email in 1/24 and 2/21 finds, opens 2-3 in 5/24 and 5/21).
//   handover "none": a committed answer is kept even when unsure (the g5 handover is a
//     coin flip vs k3: x.md). The unsure flag is still logged.
const PICK = () => generationOptions({ num_predict: 12 })
const ok = (r) => r.status === "ok" || r.status === "output_limit"
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
async function lpProbe(ctx, record, path, log) {
    const r = await lpCall(ctx, { prompt: relevancePrompt(record.question, clip(ctx.emailOf(path), 3000)), numPredict: 3, topK: 5 })
    const yes = ok(r) && /^\W*YES\b/i.test(r.answer ?? "")
    const top = r.tops?.[0] ?? []
    const lpOf = (word) => { const hit = top.find(([t]) => t.trim().toUpperCase() === word); return hit ? hit[1] : null }
    log.push({ act: "check", path, reply: String(r.answer ?? "").trim().slice(0, 10), yes, yesLp: r3(lpOf("YES")), noLp: r3(lpOf("NO")) })
    return yes
}
async function simpleX1(ctx, record, { tau = -0.1, handover = "g5", maxOpens = 1, listSize = 15 } = {}) {
    const question = record.question
    const log = []
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 30, record.user)
    const hdr = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    const mailbox = hdr.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const [W0, W1] = switched ? [mailbox, global] : [global, mailbox]
    const prompt = (paths) => sandwichPrompt(question, paths.map((p) => ctx.emailOf(p)))
    let yesAt = -1
    for (let i = 0; i < W0.length; i++) if (await lpProbe(ctx, record, W0[i], log)) { yesAt = i; break }
    if (yesAt >= 0) {
        const first = await lpCall(ctx, { prompt: prompt(W0) })
        const mean = meanLp(first)
        const unsure = isAbstain(first.answer) || HEDGE.test(first.answer ?? "") || mean < tau || !ok(first)
        const diag = { yesAt, firstMean: r3(mean), unsure, gatesAnswer: first.answer, switched, log }
        if (!unsure || handover === "none") return { status: first.status, answer: first.answer, contextPaths: W0, readPaths: W0, used: 1, step: unsure ? "commit-unsure" : "commit", ...diag }
        const g = await G[handover].run(ctx, record)
        return { ...g, step: `commit-${handover}`, g5: { actions: g.actions, goldShown: g.goldShown, readPaths: g.readPaths }, ...diag }
    }
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
    let found = null, firstPick = null
    while (opened.length < maxOpens && !found && pool.length) {
        const pick = await ctx.generate({ prompt: pickPrompt(question, listLines(ctx, record, pool)), options: PICK() })
        const n = parsePick(pick.answer, pool.length)
        log.push({ act: "pick", reply: String(pick.answer ?? "").trim().slice(0, 12), path: n ? pool[n - 1] : null, listed: pool.slice() })
        if (!n) break
        const path = pool[n - 1]
        opened.push(path); seen.add(path); firstPick ??= path
        if (await lpProbe(ctx, record, path, log)) { found = path; break }
        pool = pool.filter((p) => !seen.has(p))
    }
    const final = found ? [found, ...W0.filter((p) => p !== found).slice(0, 4)] : firstPick ? [...W0.slice(0, 4), firstPick] : W0
    return answerFrom(final, { step: found ? "found" : firstPick ? "nofound" : "nopick", checks: log.filter((l) => l.act === "check").length, openedPaths: opened, foundPath: found })
}

export const VARIANTS = {
    "t-lx": { version: 1, describe: "Simplified x1: lean explore (one CE-list pick + YES/NO check, no model search, no 2nd/3rd open); g5 handover on unsure commits kept", run: (ctx, record) => simpleX1(ctx, record, { handover: "g5" }) },
    "t-lk": { version: 1, describe: "Minimal agent: per-email YES/NO commit check -> gates answer; no YES -> one CE-list pick + check; no handover, no model search", run: (ctx, record) => simpleX1(ctx, record, { handover: "none" }) },
    "t-x1r": { version: 1, describe: "x1 replicate (identical code, new id) for run-to-run variation", run: (ctx, record) => X.x1.run(ctx, record) },
    t1: { version: 1, describe: "Ladder: frozen agent semantics (global search, 10 snippet results, open<=3, 5 rounds, own answer) through native tool calls", run: (ctx, record) => toolAgent(ctx, record, { full: 0, final: "own" }) },
    t2: { version: 1, describe: "Ladder: t1 + top 3 results of each search shown in full (3,500 chars), rest as snippets; own answer", run: (ctx, record) => toolAgent(ctx, record, { full: 3, final: "own" }) },
    t3: { version: 1, describe: "Ladder: t2 + separate sandwich answer call over the emails seen in full (opens first, <=5)", run: (ctx, record) => toolAgent(ctx, record, { full: 3, final: "sandwich" }) },
}
