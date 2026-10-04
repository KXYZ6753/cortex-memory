// Exploration agents built from the frozen premise2-agent-v1 pieces (agent.js is
// imported, never edited, so PROTOCOL_HASH and the frozen arms are untouched).
//
// toolLoop runs the same plain-text SEARCH / OPEN / ANSWER loop as runEpisode, but
// from any starting conversation and episode state, with two knobs:
//   autoOpen  the harness opens the best N unopened results of every search
//   scope     "global" (all emails) or "user" (the asker's mailbox)
// Variants:
//   fallback-a  P-B first; tools only after the model abstains
//   fallback-b  P-B emails pre-opened, tools available from the start
//   autoopen    frozen first message, every search auto-opens its top results

import {
    parseAction, canonical, renderSnippets, renderOpened, newEpisodeState, footer,
    CORRECTION, CUT_OFF, roomLeft, textTokens, STOP_SEQUENCES, TRANSIENT_STATUSES, SEARCH_K, MAX_OPEN,
} from "../agent.js"
import { ABSTAIN, isAbstain, buildPrompt } from "../prompts.js"
import { generationOptions } from "../ollama.js"

export const AGENTX_VERSION = 1
export const loopOptions = (numPredict = 160) => generationOptions({ num_predict: numPredict, stop: STOP_SEQUENCES })

const ANSWER_RULES = `Answer rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ANSWER: ${ABSTAIN}`

const scopeWords = (scope) => (scope === "user" ? "this person's mailbox" : "all emails")

export function actionsText({ rounds, scope = "global", autoOpen = 0, preOpened = 0 }) {
    const search = autoOpen
        ? `SEARCH: <keywords>  searches ${scopeWords(scope)}; the ${autoOpen} best new matches are opened in full and the rest of the top ${SEARCH_K} are listed with an id, subject, sender and the start of the email`
        : `SEARCH: <keywords>  searches ${scopeWords(scope)} and lists the ${SEARCH_K} best matches, each with an id, subject, sender and the start of the email`
    return `Each turn, reply with exactly one line, starting with one of:
${search}
OPEN: <id>, <id>, <id>  shows up to ${MAX_OPEN} full emails from the search results${preOpened ? ` (emails [1]-[${preOpened}] are already open)` : ""}
ANSWER: <your answer>  gives your final answer and ends the task

You have ${rounds} rounds of SEARCH or OPEN before you must answer.`
}

// Registers already-shown emails as ids 1..n, opened.
export function preOpen(state, paths) {
    for (const path of paths) {
        if (state.idOf.has(path)) continue
        state.pathOf.push(path)
        state.idOf.set(path, state.pathOf.length)
        state.opened.add(path)
    }
}

export async function toolLoop({ ctx, record, messages, state, maxRounds, autoOpen = 0, scope = "global", numPredict = 160, trace }) {
    const options = loopOptions(numPredict)
    const user = scope === "user" ? record.user : null
    let rounds = 0
    let invalidRun = 0
    let forcedEarly = false
    const runSearch = async (query) => {
        const paths = await ctx.search(query, SEARCH_K, user)
        trace.queries.push(query)
        for (const path of paths) if (!trace.shown.includes(path)) trace.shown.push(path)
        let text = renderSnippets(query, paths, state, ctx.emailOf)
        if (autoOpen) {
            const ids = paths.filter((path) => !state.opened.has(path)).slice(0, autoOpen).map((path) => state.idOf.get(path))
            if (ids.length) {
                const room = roomLeft([...messages, { role: "user", content: text }]) - textTokens(footer(maxRounds - rounds)) - 64
                const opened = renderOpened(ids, state, ctx.emailOf, room)
                if (opened.text) text = `${text}\n\n${opened.text}`
            }
        }
        if (textTokens(text) > roomLeft(messages) - textTokens(footer(maxRounds - rounds))) return `Search results for "${query}" do not fit in the space left. Open fewer emails, or answer.`
        return text
    }
    for (;;) {
        const forced = rounds >= maxRounds || forcedEarly
        const result = await ctx.generate({ messages, options })
        const content = typeof result.answer === "string" ? result.answer : ""
        trace.turns++
        if (TRANSIENT_STATUSES.has(result.status)) return { status: result.status, answer: "", outcome: "technical" }
        if (result.status === "context_overflow") return { status: "ok", answer: "", outcome: "agentOverflow" }
        const action = parseAction(content)
        if (forced) {
            const answer = action.kind === "ANSWER" ? action.text : action.kind === "invalid" ? content.trim() || null : null
            messages.push({ role: "assistant", content: answer ? `ANSWER: ${answer}` : canonical(action, content) })
            return { status: answer ? result.status : "empty", answer: answer ?? "", outcome: answer ? "forced" : "noAnswer", rounds }
        }
        messages.push({ role: "assistant", content: canonical(action, content) })
        if (action.kind === "ANSWER") return { status: result.status, answer: action.text, outcome: "answered", rounds }
        rounds++
        let reply
        if (action.kind === "invalid") {
            invalidRun++
            reply = result.status === "output_limit" ? CUT_OFF : CORRECTION
            trace.protocolErrors++
            if (invalidRun >= 2) forcedEarly = true
        } else {
            invalidRun = 0
            if (action.kind === "SEARCH") reply = await runSearch(action.query)
            else {
                const room = roomLeft(messages) - textTokens(footer(maxRounds - rounds)) - 64
                reply = renderOpened(action.ids, state, ctx.emailOf, room).text
            }
        }
        messages.push({ role: "user", content: `${reply}\n\n${footer(forcedEarly ? 0 : maxRounds - rounds)}` })
    }
}

const newTrace = () => ({ queries: [], shown: [], turns: 0, protocolErrors: 0 })
const finish = (result, state, trace, messages, extra = {}) => ({
    ...result, shownPaths: trace.shown, openedPaths: [...state.opened], queries: trace.queries,
    turns: trace.turns, protocolErrors: trace.protocolErrors, transcript: messages, ...extra,
})

// P-B first; the tool loop starts only if the model abstains.
export async function fallbackA(ctx, record, { rounds = 4, scope = "global", contextScope = "global", autoOpen = 0 } = {}) {
    const ranked = await ctx.search(record.question, 20, contextScope === "user" ? record.user : null)
    const paths = ranked.slice(0, 5)
    const prompt = buildPrompt({ question: record.question, paths, representation: "R0", template: "T2", emailByPath: ctx.emailMap, record })
    const first = await ctx.generate({ prompt })
    const state = newEpisodeState()
    preOpen(state, paths)
    const trace = newTrace()
    trace.shown.push(...paths)
    if (first.status !== "ok" || !isAbstain(first.answer)) {
        return finish({ status: first.status, answer: first.answer ?? "", outcome: "direct", rounds: 0 }, state, trace, null, { contextPaths: paths, fellBack: false })
    }
    const messages = [
        { role: "user", content: prompt },
        { role: "assistant", content: ABSTAIN },
        { role: "user", content: `The answer is not in those emails, so search the archive for it.\n\n${actionsText({ rounds, scope, autoOpen, preOpened: paths.length })}\n\n${ANSWER_RULES}\n\nQuestion: ${record.question}` },
    ]
    const result = await toolLoop({ ctx, record, messages, state, maxRounds: rounds, autoOpen, scope, trace })
    return finish(result, state, trace, messages, { contextPaths: paths, fellBack: true })
}

// P-B emails shown as already opened; the model may answer or search from turn 1.
export async function fallbackB(ctx, record, { rounds = 4, scope = "global", contextScope = "global", autoOpen = 0 } = {}) {
    const ranked = await ctx.search(record.question, 20, contextScope === "user" ? record.user : null)
    const paths = ranked.slice(0, 5)
    const state = newEpisodeState()
    preOpen(state, paths)
    const trace = newTrace()
    trace.shown.push(...paths)
    const emails = paths.map((path, index) => `[${index + 1}]\n${ctx.emailOf(path)}`).join("\n\n")
    const content = `You answer a question about a person's email archive. The 5 emails that best match the question are shown below. If they answer it, answer now. If not, you can search the archive.

${actionsText({ rounds, scope, autoOpen, preOpened: paths.length })}

${ANSWER_RULES}

Emails:
<<<EMAILS
${emails}
EMAILS>>>

Question: ${record.question}`
    const messages = [{ role: "user", content }]
    const result = await toolLoop({ ctx, record, messages, state, maxRounds: rounds, autoOpen, scope, trace })
    return finish(result, state, trace, messages, { contextPaths: paths })
}

// The frozen agent's task, but every search opens its best unopened results.
export async function autoOpenAgent(ctx, record, { rounds = 5, scope = "global", autoOpen = 2 } = {}) {
    const state = newEpisodeState()
    const trace = newTrace()
    const messages = [{ role: "user", content: `You answer a question about a person's email archive. You cannot see the archive, but you can search it.

${actionsText({ rounds, scope, autoOpen })}

${ANSWER_RULES}

Question: ${record.question}` }]
    const result = await toolLoop({ ctx, record, messages, state, maxRounds: rounds, autoOpen, scope, trace })
    return finish(result, state, trace, messages)
}
