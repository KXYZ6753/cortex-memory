// The agent arm (PREREG-AGENT.md): a model-driven search loop over the same BM25
// index as P-B.
//
// The protocol is plain text and byte-identical for every model (gemma3:1b has no
// native tool support). Each assistant turn is one action line:
//
//   SEARCH: <keywords>          the 10 best BM25 matches as short snippets
//   OPEN: <id>, <id>, <id>      up to 3 full emails (R0, verbatim) from earlier results
//   ANSWER: <text>              the final answer; ends the episode
//
// At most MAX_ROUNDS SEARCH/OPEN actions, then one forced answer turn. The model gets
// back only the canonical form of its action, never its prose. A malformed turn
// consumes a round and gets a fixed correction; two in a row go straight to the forced
// answer. Nothing is cut silently: an opened email over EMAIL_CHAR_CAP carries an
// explicit truncation marker (no gold email in the population is that long), and a
// result that would not fit the context window is refused explicitly, by the same
// byte-based bound for every model.

import { sha256, splitFile, parseFileHeader, hasQuotedPrintable, decodeQuotedPrintable } from "./text.js"
import { ABSTAIN, TOKEN_CAP, CONSERVATIVE_CHARS_PER_TOKEN, TEMPLATE_TOKEN_ALLOWANCE } from "./prompts.js"

export const AGENT_PROTOCOL_VERSION = "premise2-agent-v1"
export const SNIPPET_RULE = "qp-decoded, whitespace-collapsed, word-boundary cut"
export const MAX_ROUNDS = 5
export const SEARCH_K = 10
export const SNIPPET_CHARS = 200
export const MAX_OPEN = 3
export const EMAIL_CHAR_CAP = 12_000
// One output reserve for every arm (it equals the thinking arms' num_predict), so
// every model gets exactly the same room for tool results.
export const OUTPUT_RESERVE = 4_096
// Chat-template tokens per message (role markers, turn delimiters), bounded high.
export const MESSAGE_TOKEN_ALLOWANCE = 8
// Stops only on hallucinated tool output, never on an action keyword (an action line
// may follow a line of prose, and stopping there would lose it).
export const STOP_SEQUENCES = ["\nSearch results", "\nOpened emails", "\nRounds left"]

// Transient technical failures: the whole episode is rerun from turn 1.
export const TRANSIENT_STATUSES = new Set(["http_error", "timeout", "oom", "malformed"])

// variant "null": an answer-neutral rewording of the instructions (the agent's own
// flip floor). Action names, ids and tool output are unchanged, so parsing is too.
export function firstMessage(question, variant = "standard", maxRounds = MAX_ROUNDS) {
    if (variant === "null") {
        return `Your task is to answer a question about someone's email archive. The archive is not shown to you, but you are able to search it.

On every turn, respond with a single line that begins with one of these:
SEARCH: <keywords>  runs a search over all emails and returns the ${SEARCH_K} top matches, each with an id, subject, sender and the opening of the email
OPEN: <id>, <id>, <id>  displays up to ${MAX_OPEN} complete emails from the search results
ANSWER: <your answer>  submits your final answer and finishes the task

You get ${maxRounds} rounds of SEARCH or OPEN, and then you have to answer.

Answer rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ANSWER: ${ABSTAIN}

Question: ${question}`
    }
    return `You answer a question about a person's email archive. You cannot see the archive, but you can search it.

Each turn, reply with exactly one line, starting with one of:
SEARCH: <keywords>  searches all emails and lists the ${SEARCH_K} best matches, each with an id, subject, sender and the start of the email
OPEN: <id>, <id>, <id>  shows up to ${MAX_OPEN} full emails from the search results
ANSWER: <your answer>  gives your final answer and ends the task

You have ${maxRounds} rounds of SEARCH or OPEN before you must answer.

Answer rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ANSWER: ${ABSTAIN}

Question: ${question}`
}

export const CORRECTION = "That reply had no valid action. Reply with exactly one line starting with SEARCH:, OPEN: or ANSWER:."
export const CUT_OFF = "Your reply was cut off before it finished. Reply with one short line starting with SEARCH:, OPEN: or ANSWER:."
export const FORCED = "No rounds left. Reply now with: ANSWER: <your answer>"
export const footer = (left) => (left > 0 ? `Rounds left: ${left}. Reply with one line: SEARCH, OPEN or ANSWER.` : FORCED)

// Hash of every piece of protocol text and every constant that shapes a trajectory.
export const PROTOCOL_HASH = sha256([
    AGENT_PROTOCOL_VERSION, firstMessage("Q"), firstMessage("Q", "null"), CORRECTION, CUT_OFF, FORCED, footer(3),
    MAX_ROUNDS, SEARCH_K, SNIPPET_CHARS, SNIPPET_RULE, MAX_OPEN, EMAIL_CHAR_CAP, OUTPUT_RESERVE, TOKEN_CAP, MESSAGE_TOKEN_ALLOWANCE,
    JSON.stringify(STOP_SEQUENCES),
].join("\n--8<--\n"))

// Store key component: the protocol, the variant and the question. The arm's model
// options (think, num_predict, stop) enter through the options hash.
// The index-factor arms (PREREG-AGENT-INDEX.md) add the search index and the round
// budget; the defaults (BM25, MAX_ROUNDS) keep the original arms' keys unchanged.
export const episodeSha = (question, variant = "standard", rawFirst = false, { index = "bm25", maxRounds = MAX_ROUNDS } = {}) => {
    const extra = index === "bm25" && maxRounds === MAX_ROUNDS ? "" : `|index:${index}|rounds:${maxRounds}`
    return sha256(`${PROTOCOL_HASH}|${variant}|${rawFirst ? "rawfirst" : "model"}${extra}|${question}`)
}

const ACTION = /^[\s>*_`#"'-]*(?:action\s*[:：]\s*)?[*_`"']*(SEARCH|OPEN|ANSWER)[\s*_`"']*[:：]\s*(.*)$/i
const stripMarkup = (text) => text.replace(/[*`]+/g, "").replace(/^["']+|["']+$/g, "").trim()

// First action line wins. ANSWER takes the rest of the output (answers may run to
// two lines) up to the next action line. A reply that is exactly the abstention
// phrase is accepted as an answer; anything else without an action is invalid.
export function parseAction(text) {
    const lines = String(text ?? "").split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(ACTION)
        if (!match) continue
        const kind = match[1].toUpperCase()
        const prose = lines.slice(0, index).some((line) => line.trim())
        if (kind === "ANSWER") {
            const rest = [match[2]]
            for (const line of lines.slice(index + 1)) {
                if (ACTION.test(line)) break
                rest.push(line)
            }
            const answer = stripMarkup(rest.join("\n"))
            return answer ? { kind, text: answer, prose } : { kind: "invalid", reason: "empty answer" }
        }
        const argument = stripMarkup(match[2])
        if (kind === "SEARCH") return argument ? { kind, query: argument, prose } : { kind: "invalid", reason: "empty search" }
        const ids = [...new Set([...argument.matchAll(/(?:^|[^A-Za-z0-9])E?\s*(\d+)/gi)].map((m) => Number(m[1])))]
        return ids.length ? { kind, ids, prose } : { kind: "invalid", reason: "no ids" }
    }
    const bare = String(text ?? "").trim().replace(/[.!]+$/, "")
    if (bare.toUpperCase() === ABSTAIN) return { kind: "ANSWER", text: ABSTAIN, bare: true, prose: false }
    return { kind: "invalid", reason: "no action line" }
}

// What the model gets back as its own turn: the canonical action, never its prose.
export function canonical(action, raw) {
    if (action.kind === "SEARCH") return `SEARCH: ${action.query}`
    if (action.kind === "OPEN") return `OPEN: ${action.ids.join(", ")}`
    if (action.kind === "ANSWER") return `ANSWER: ${action.text}`
    return String(raw ?? "").trim().slice(0, 300)
}

// The conservative token bound of a whole conversation (the main study's chars/2.2
// rule, plus template allowances).
export function conversationTokens(messages) {
    const chars = messages.reduce((sum, message) => sum + message.content.length, 0)
    return Math.ceil(chars / CONSERVATIVE_CHARS_PER_TOKEN) + TEMPLATE_TOKEN_ALLOWANCE + MESSAGE_TOKEN_ALLOWANCE * messages.length
}
export const textTokens = (text) => Math.ceil(text.length / CONSERVATIVE_CHARS_PER_TOKEN) + MESSAGE_TOKEN_ALLOWANCE
export const roomLeft = (messages) => TOKEN_CAP - OUTPUT_RESERVE - conversationTokens(messages)

// Snippet: subject, sender and the first SNIPPET_CHARS of the body, quoted-printable
// decoded (on strong QP evidence only, as in R1), whitespace collapsed and cut at a
// word boundary. No path (the File: line appears only on OPEN, as in P-B's contexts).
// Opened emails stay verbatim R0.
export function snippetOf(email) {
    const { header, body } = splitFile(email ?? "")
    const parsed = parseFileHeader(header)
    const flat = (hasQuotedPrintable(body) ? decodeQuotedPrintable(body) : body).replace(/\s+/g, " ").trim()
    let start = flat.slice(0, SNIPPET_CHARS)
    if (flat.length > SNIPPET_CHARS) {
        const cut = start.lastIndexOf(" ")
        start = `${cut > SNIPPET_CHARS * 0.6 ? start.slice(0, cut) : start} …`
    }
    return { subject: parsed.subject, sender: parsed.sender, start }
}

export function shownEmail(email) {
    const text = email ?? ""
    if (text.length <= EMAIL_CHAR_CAP) return text
    return `${text.slice(0, EMAIL_CHAR_CAP)}\n[truncated: ${text.length - EMAIL_CHAR_CAP} more characters not shown]`
}

export function newEpisodeState() {
    return { idOf: new Map(), pathOf: [], opened: new Set(), queries: new Set() }
}

const idFor = (state, path) => {
    if (!state.idOf.has(path)) {
        state.pathOf.push(path)
        state.idOf.set(path, state.pathOf.length)
    }
    return state.idOf.get(path)
}

export function snippetLine(state, path, emailOf) {
    const { subject, sender, start } = snippetOf(emailOf(path))
    return `[${idFor(state, path)}] Subject: ${subject || "(none)"} | From: ${sender || "(unknown)"} | ${start}${state.opened.has(path) ? " (opened)" : ""}`
}

export function renderSnippets(query, paths, state, emailOf) {
    const repeated = state.queries.has(query.toLowerCase())
    state.queries.add(query.toLowerCase())
    if (!paths.length) return `No emails matched the search "${query}".`
    return `Search results for "${query}"${repeated ? " (repeated search)" : ""}:\n${paths.map((path) => snippetLine(state, path, emailOf)).join("\n")}`
}

// Opens ids in order while they fit in `room`; the rest are listed as not opened
// with the reason, so the model can choose fewer or shorter emails.
export function renderOpened(ids, state, emailOf, room) {
    const parts = []
    const notes = []
    const opened = []
    let used = 0
    for (const id of ids.slice(0, MAX_OPEN)) {
        const path = state.pathOf[id - 1]
        if (!path) {
            notes.push(`Unknown id ${id} (ids so far: ${state.pathOf.length ? `1-${state.pathOf.length}` : "none; SEARCH first"}).`)
            continue
        }
        if (state.opened.has(path)) {
            notes.push(`[${id}] was already opened above.`)
            continue
        }
        const block = `[${id}]\n${shownEmail(emailOf(path))}`
        const cost = textTokens(block)
        if (used + cost > room) {
            notes.push(`Not opened [${id}]: it needs about ${cost} tokens and only about ${Math.max(0, room - used)} are left. Open fewer emails, or answer.`)
            continue
        }
        used += cost
        parts.push(block)
        opened.push(path)
        state.opened.add(path)
    }
    if (ids.length > MAX_OPEN) notes.push(`Only the first ${MAX_OPEN} ids were considered.`)
    const text = [parts.length ? `Opened emails:\n\n${parts.join("\n\n")}` : "", ...notes].filter(Boolean).join("\n\n")
    return { text, opened }
}

// One episode. `chatTurn(messages)` returns an ollama.js chat() record; `search(query,
// k)` returns [{ path }]; `emailOf(path)` returns the R0 email text. With `rawFirst`
// the harness itself runs round 1 as SEARCH on the raw question (a control that
// isolates who writes the query). Returns the episode record: status ok /
// output_limit / empty (final), or a transient technical status (rerun).
export async function runEpisode({ question, chatTurn, search, emailOf, variant = "standard", rawFirst = false, maxRounds = MAX_ROUNDS }) {
    const messages = [{ role: "user", content: firstMessage(question, variant, maxRounds) }]
    const state = newEpisodeState()
    const turns = []
    const shown = []
    const queries = []
    let rounds = 0
    let answer = null
    let outcome = null
    let answerStatus = "ok"
    let invalidRun = 0
    let forcedEarly = false
    const started = performance.now()

    const runSearch = async (query, turn) => {
        const toolStarted = performance.now()
        const paths = (await search(query, SEARCH_K)).map((hit) => hit.path)
        turn.toolMs = Math.round(performance.now() - toolStarted)
        turn.query = query
        queries.push(query)
        const text = renderSnippets(query, paths, state, emailOf)
        if (textTokens(text) > roomLeft(messages) - textTokens(footer(maxRounds - rounds))) {
            turn.refused = "search"
            return `Search results for "${query}" do not fit in the space left. Open fewer emails, or answer.`
        }
        turn.shown = paths
        for (const path of paths) if (!shown.includes(path)) shown.push(path)
        return text
    }

    if (rawFirst) {
        const turn = { index: 0, harness: true, action: "SEARCH" }
        turns.push(turn)
        messages.push({ role: "assistant", content: `SEARCH: ${question}` })
        rounds++
        messages.push({ role: "user", content: `${await runSearch(question, turn)}\n\n${footer(maxRounds - rounds)}` })
    }

    for (;;) {
        const forced = rounds >= maxRounds || forcedEarly
        const result = await chatTurn(messages)
        const content = typeof result.answer === "string" ? result.answer : ""
        const turn = {
            index: turns.length + 1, forced, status: result.status, raw: content,
            promptEvalCount: result.promptEvalCount ?? null, promptEvalCachedCount: result.promptEvalCachedCount ?? null,
            evalCount: result.evalCount ?? null, thinkingChars: result.thinkingChars ?? 0,
            wallMs: result.wallMs ?? null, loadMs: result.loadMs ?? null, doneReason: result.doneReason ?? null,
        }
        turns.push(turn)
        if (TRANSIENT_STATUSES.has(result.status)) return { ...summary(result.status), error: String(result.error ?? "").slice(0, 300) }
        if (result.status === "context_overflow") {
            // The guard should make this impossible. If it happens the episode ends
            // without an answer and scores INCORRECT: the model's own actions caused
            // the growth, so the question must not be excluded.
            outcome = "agentOverflow"
            break
        }
        const action = parseAction(content)
        turn.action = action.kind
        if (action.prose) turn.prose = true
        if (forced) {
            // A reply without the prefix is taken whole as the answer; another tool
            // call on the forced turn is no answer.
            answer = action.kind === "ANSWER" ? action.text : action.kind === "invalid" ? content.trim() || null : null
            outcome = !answer ? "noAnswer" : action.kind === "ANSWER" ? "forced" : "forcedUnprefixed"
            if (answer && result.status === "output_limit") answerStatus = "output_limit"
            messages.push({ role: "assistant", content: answer ? `ANSWER: ${answer}` : canonical(action, content) })
            break
        }
        messages.push({ role: "assistant", content: canonical(action, content) })
        if (action.kind === "ANSWER") {
            answer = action.text
            outcome = "answered"
            if (result.status === "output_limit") answerStatus = "output_limit"
            break
        }
        rounds++
        let reply
        if (action.kind === "invalid") {
            invalidRun++
            if (result.status === "output_limit") {
                turn.cutOff = true
                reply = CUT_OFF
            } else {
                turn.protocolError = action.reason
                reply = CORRECTION
            }
            if (invalidRun >= 2) forcedEarly = true
        } else {
            invalidRun = 0
            if (action.kind === "SEARCH") {
                reply = await runSearch(action.query, turn)
            } else {
                const room = roomLeft(messages) - textTokens(footer(maxRounds - rounds)) - 64
                const { text, opened } = renderOpened(action.ids, state, emailOf, room)
                turn.ids = action.ids
                turn.opened = opened
                if (/^Not opened/m.test(text)) turn.refused = "open"
                reply = text
            }
        }
        messages.push({ role: "user", content: `${reply}\n\n${footer(forcedEarly ? 0 : maxRounds - rounds)}` })
    }

    return summary(answer ? answerStatus : "empty")

    function summary(status) {
        return {
            status,
            answer: answer ?? "",
            outcome,
            rounds,
            forcedEarly,
            turns,
            queries,
            shownPaths: shown,
            openedPaths: [...state.opened],
            idOf: Object.fromEntries(state.idOf),
            protocolErrors: turns.filter((turn) => turn.protocolError).length,
            cutOffs: turns.filter((turn) => turn.cutOff).length,
            refusals: turns.filter((turn) => turn.refused).length,
            proseTurns: turns.filter((turn) => turn.prose).length,
            promptTokens: sumOf(turns, "promptEvalCount"),
            cachedPromptTokens: sumOf(turns, "promptEvalCachedCount"),
            outputTokens: sumOf(turns, "evalCount"),
            thinkingChars: sumOf(turns, "thinkingChars"),
            wallMs: Math.round(performance.now() - started),
            modelMs: sumOf(turns, "wallMs"),
            maxLoadMs: Math.max(0, ...turns.map((turn) => turn.loadMs ?? 0)),
            conversationTokensUpper: conversationTokens(messages),
            transcript: messages,
            transcriptSha: sha256(messages.map((message) => `${message.role}:${message.content}`).join("\n--8<--\n")),
        }
    }
}

const sumOf = (turns, field) => turns.reduce((sum, turn) => sum + (Number.isFinite(turn[field]) ? turn[field] : 0), 0)

// The adjudicator's evidence for an episode: every email as the model saw it, in
// order of first appearance: the opened emails in full (as shown, capped), and a
// snippet line for results never opened. Built from paths, so no gold fallback: an
// agent that never searched has no evidence. `supporting` is the shown text of the
// gold, its twins and answer-bearing emails (a snippet-only gold contributes only its
// snippet line).
export function adjudicationEvidence(episode, { emailOf, isSupporting }) {
    const state = newEpisodeState()
    for (const [path, id] of Object.entries(episode.idOf ?? {})) {
        state.pathOf[id - 1] = path
        state.idOf.set(path, id)
    }
    const opened = new Set(episode.openedPaths ?? [])
    const emails = []
    const supporting = []
    for (const path of episode.shownPaths ?? []) {
        const text = opened.has(path) ? `[${state.idOf.get(path)}]\n${shownEmail(emailOf(path))}` : `Search result only (not opened):\n${snippetLine(state, path, emailOf)}`
        emails.push(text)
        if (isSupporting(path)) supporting.push(text)
    }
    return { emails, supporting, sha: sha256(emails.join("\n--8<--\n")) }
}
