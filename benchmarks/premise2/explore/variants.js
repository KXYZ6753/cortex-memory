// Exploration variants. Each variant answers one pool question with the small model
// through `ctx` (see run.js) and returns { status, answer, ...diagnostics }.
// Diagnostics used by the analysis: contextPaths (emails in a fixed prompt),
// readPaths (emails the final answer call saw), shownPaths / openedPaths (agents).
//
// `version` is part of every answer's store key: bump it whenever a variant's
// behaviour changes, so old answers are never mixed with new ones.
//
// Round 0 (baselines, configured exactly as in the main study):
//   pb       BM25 global top 5, R0 verbatim, T2, rank order (P-B)
//   estar    the same five emails, best-ranked last (E* = k5-bestlast-R0)
//   agent    the frozen premise2-agent-v1 episode (A-agent), BM25 index
// Round 1 candidates: see explore-journal.md for hypotheses.

import { buildPrompt, ABSTAIN } from "../prompts.js"
import { runEpisode, MAX_ROUNDS } from "../agent.js"
import { armOptions } from "../agent-run.js"
import { rrf } from "../retrieve.js"
import { generationOptions } from "../ollama.js"
import { fallbackA, fallbackB, autoOpenAgent, AGENTX_VERSION } from "./agentx.js"

export const NUM_PREDICT = 160

const answerPrompt = (ctx, record, paths) => buildPrompt({ question: record.question, paths, representation: "R0", template: "T2", emailByPath: ctx.emailMap, record })

async function fixedContext(ctx, record, { k = 5, order = "rank", scope = "global" }) {
    const ranked = await ctx.search(record.question, 20, scope === "user" ? record.user : null)
    const top = ranked.slice(0, k)
    const paths = order === "bestlast" ? [...top].reverse() : top
    const result = await ctx.generate({ prompt: answerPrompt(ctx, record, paths) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: paths }
}

async function frozenAgent(ctx, record) {
    const { options } = armOptions({ cell: "A-agent", alias: "small" }, NUM_PREDICT)
    const episode = await runEpisode({
        question: record.question,
        chatTurn: (messages) => ctx.generate({ messages, options }),
        search: async (query, k) => ctx.search(query, k).then((paths) => paths.map((path) => ({ path }))),
        emailOf: ctx.emailOf,
        maxRounds: MAX_ROUNDS,
    })
    return {
        status: episode.status, answer: episode.answer, outcome: episode.outcome, rounds: episode.rounds,
        shownPaths: episode.shownPaths, openedPaths: episode.openedPaths, queries: episode.queries,
        protocolErrors: episode.protocolErrors, transcript: episode.transcript,
    }
}

// ---- select-then-read ----

export function selectionPrompt(question, emails) {
    return `Below are ${emails.length} emails and a question about them. Which emails contain the information needed to answer the question?

Reply with only the email numbers, separated by commas (for example: 2, 4), or NONE if no email contains it.

Emails:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}
EMAILS>>>

Question: ${question}
Emails with the answer:`
}

// Numbers 1..n mentioned in the reply, in order, deduplicated; [] for NONE or junk.
export function parseSelection(text, n) {
    const reply = String(text ?? "")
    if (/^\s*none\b/i.test(reply)) return []
    const picked = []
    for (const match of reply.matchAll(/\d+/g)) {
        const value = Number(match[0])
        if (value >= 1 && value <= n && !picked.includes(value)) picked.push(value)
    }
    return picked
}

async function selectThenRead(ctx, record, { k = 5, scope = "global", maxKeep = 2, onNone = "all" } = {}) {
    const ranked = await ctx.search(record.question, 20, scope === "user" ? record.user : null)
    const top = ranked.slice(0, k)
    const selection = await ctx.generate({ prompt: selectionPrompt(record.question, top.map((path) => ctx.emailOf(path))), options: generationOptions({ num_predict: 24 }) })
    const picked = parseSelection(selection.answer, top.length).slice(0, maxKeep)
    // Keep rank order among the picked emails; nothing picked -> the first five.
    const readPaths = picked.length ? top.filter((_, index) => picked.includes(index + 1)) : onNone === "all" ? top.slice(0, 5) : []
    const result = readPaths.length ? await ctx.generate({ prompt: answerPrompt(ctx, record, readPaths) }) : { status: "ok", answer: ABSTAIN }
    return { status: result.status, answer: result.answer ?? "", contextPaths: top, readPaths, selection: selection.answer, picked }
}

// ---- quote-then-answer ----

export function quotePrompt(question, emails) {
    return `You answer questions about a person's email archive using only the emails below.

Rules:
- First, on a line starting with QUOTE:, copy the sentence from the emails that answers the question.
- Then, on a line starting with ANSWER:, answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ANSWER: ${ABSTAIN}

Emails:
<<<EMAILS
${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}
EMAILS>>>

Question: ${question}`
}

// The text after the last ANSWER: label (to the end); without one, the reply minus
// any QUOTE: line.
export function parseQuoted(text) {
    const reply = String(text ?? "").trim()
    const labels = [...reply.matchAll(/\**ANSWER\**\s*:\**\s*/gi)]
    if (labels.length) {
        const last = labels.at(-1)
        return reply.slice(last.index + last[0].length).replace(/\*+$/, "").trim()
    }
    return reply.split("\n").filter((line) => !/^\s*\**QUOTE\**\s*:/i.test(line)).join("\n").trim()
}

async function quoteThenAnswer(ctx, record, { scope = "global" } = {}) {
    const ranked = await ctx.search(record.question, 20, scope === "user" ? record.user : null)
    const paths = ranked.slice(0, 5)
    const result = await ctx.generate({ prompt: quotePrompt(record.question, paths.map((path) => ctx.emailOf(path))), options: generationOptions({ num_predict: 320 }) })
    return { status: result.status, answer: parseQuoted(result.answer), raw: result.answer, contextPaths: paths }
}

// ---- query expansion ----

export const keywordPrompt = (question) => `Write a search query to find the email that answers this question. Reply with 3 to 8 keywords only, on one line.

Question: ${question}
Keywords:`

async function queryExpansion(ctx, record, { scope = "global" } = {}) {
    const user = scope === "user" ? record.user : null
    const keywords = await ctx.generate({ prompt: keywordPrompt(record.question), options: generationOptions({ num_predict: 32 }) })
    const query = String(keywords.answer ?? "").split("\n")[0].replace(/^keywords\s*:\s*/i, "").trim()
    const raw = await ctx.search(record.question, 100, user)
    const expanded = query ? await ctx.search(query, 100, user) : []
    const fused = rrf([raw.map((path) => ({ path })), expanded.map((path) => ({ path }))], 60, 20).map((hit) => hit.path)
    const paths = fused.slice(0, 5)
    const result = await ctx.generate({ prompt: answerPrompt(ctx, record, paths) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: paths, query }
}

export const VARIANTS = {
    pb: { version: 1, describe: "P-B: BM25 global top 5, R0, T2, rank order", run: (ctx, record) => fixedContext(ctx, record, {}) },
    estar: { version: 1, describe: "E*: BM25 global top 5, best-ranked last", run: (ctx, record) => fixedContext(ctx, record, { order: "bestlast" }) },
    agent: { version: 1, describe: "Frozen A-agent (premise2-agent-v1), BM25", run: frozenAgent },

    pbu: { version: 1, describe: "P-B with per-mailbox BM25 (asker's mailbox)", run: (ctx, record) => fixedContext(ctx, record, { scope: "user" }) },
    sel5: { version: 1, describe: "Select up to 2 of BM25 top 5, then answer from them", run: (ctx, record) => selectThenRead(ctx, record, { k: 5 }) },
    sel10: { version: 1, describe: "Select up to 2 of BM25 top 10, then answer from them", run: (ctx, record) => selectThenRead(ctx, record, { k: 10 }) },
    quote: { version: 1, describe: "Quote-then-answer on P-B context", run: (ctx, record) => quoteThenAnswer(ctx, record) },
    qx: { version: 1, describe: "e2b keywords + raw question, RRF-fused BM25 top 5", run: (ctx, record) => queryExpansion(ctx, record) },
    fba: { version: AGENTX_VERSION, describe: "Fallback agent (a): P-B, then 4 tool rounds if it abstains", run: (ctx, record) => fallbackA(ctx, record) },
    fbb: { version: AGENTX_VERSION, describe: "Fallback agent (b): P-B emails pre-opened, tools from turn 1", run: (ctx, record) => fallbackB(ctx, record) },
    auto2: { version: AGENTX_VERSION, describe: "Agent whose searches auto-open the 2 best new results", run: (ctx, record) => autoOpenAgent(ctx, record, { autoOpen: 2 }) },
}
