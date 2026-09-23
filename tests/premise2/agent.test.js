// Unit tests for the agent arm's protocol and episode runner (benchmarks/premise2/agent.js).
// Everything here is pure or driven by fake chatTurn/search/emailOf functions -- no
// Ollama, no network, no files under .data/.

import assert from "node:assert/strict"
import test from "node:test"
import {
    AGENT_PROTOCOL_VERSION,
    MAX_ROUNDS,
    SEARCH_K,
    SNIPPET_CHARS,
    MAX_OPEN,
    EMAIL_CHAR_CAP,
    STOP_SEQUENCES,
    firstMessage,
    CORRECTION,
    CUT_OFF,
    FORCED,
    footer,
    parseAction,
    canonical,
    conversationTokens,
    textTokens,
    snippetOf,
    shownEmail,
    newEpisodeState,
    snippetLine,
    renderSnippets,
    renderOpened,
    runEpisode,
    episodeSha,
    adjudicationEvidence,
} from "../../benchmarks/premise2/agent.js"
import { SEPARATOR } from "../../benchmarks/premise2/text.js"
import { CONSERVATIVE_CHARS_PER_TOKEN, TEMPLATE_TOKEN_ALLOWANCE, ABSTAIN } from "../../benchmarks/premise2/prompts.js"

const makeEmail = ({ subject = "Test", sender = "kay.mann@enron.com", recipients = ["sara.shackleton@enron.com"], file = "shackleton-s/inbox/1.", body = "Body text." } = {}) =>
    `Subject: ${subject}\nSender: ${sender}\nRecipients: [${recipients.map((r) => `'${r}'`).join(", ")}]\nFile: ${file}\n${SEPARATOR}\n${body}\n${SEPARATOR}`

// ---------------------------------------------------------------------------
// parseAction
// ---------------------------------------------------------------------------

test("parseAction: basic SEARCH", () => {
    assert.deepEqual(parseAction("SEARCH: florida power"), { kind: "SEARCH", query: "florida power", prose: false })
})

test("parseAction: basic OPEN", () => {
    assert.deepEqual(parseAction("OPEN: 3"), { kind: "OPEN", ids: [3], prose: false })
})

test("parseAction: basic ANSWER", () => {
    assert.deepEqual(parseAction("ANSWER: The meeting is on Monday."), { kind: "ANSWER", text: "The meeting is on Monday.", prose: false })
})

test("parseAction: the action keyword is case-insensitive", () => {
    assert.equal(parseAction("search: foo").kind, "SEARCH")
    assert.equal(parseAction("Open: 1").kind, "OPEN")
    assert.equal(parseAction("answer: yes").kind, "ANSWER")
})

test("parseAction: strips markdown bold, backticks and a leading bullet", () => {
    assert.deepEqual(parseAction("**SEARCH:** foo"), { kind: "SEARCH", query: "foo", prose: false })
    assert.deepEqual(parseAction("`SEARCH:` florida"), { kind: "SEARCH", query: "florida", prose: false })
    assert.deepEqual(parseAction("- SEARCH: foo"), { kind: "SEARCH", query: "foo", prose: false })
    assert.deepEqual(parseAction("* SEARCH: foo"), { kind: "SEARCH", query: "foo", prose: false })
})

test("parseAction: accepts an 'Action:' prefix before the keyword", () => {
    assert.deepEqual(parseAction("Action: SEARCH: foo"), { kind: "SEARCH", query: "foo", prose: false })
    assert.deepEqual(parseAction("ACTION: search: foo"), { kind: "SEARCH", query: "foo", prose: false })
})

test("parseAction: strips quotes around a SEARCH query", () => {
    assert.equal(parseAction('SEARCH: "florida power"').query, "florida power")
    assert.equal(parseAction("SEARCH: 'florida power'").query, "florida power")
})

test("parseAction: OPEN ids in plain, E-prefixed and bracketed forms, deduplicated", () => {
    assert.deepEqual(parseAction("OPEN: 3, 5").ids, [3, 5])
    assert.deepEqual(parseAction("OPEN: E3, E5").ids, [3, 5])
    assert.deepEqual(parseAction("OPEN: [3] [7]").ids, [3, 7])
    assert.deepEqual(parseAction("OPEN: 3, 3, 5").ids, [3, 5])
})

test("parseAction: a prose line before the action line sets prose: true", () => {
    const action = parseAction("Let me think about this.\nSEARCH: foo")
    assert.equal(action.kind, "SEARCH")
    assert.equal(action.query, "foo")
    assert.equal(action.prose, true)
})

test("parseAction: an ANSWER spans two lines and stops at a following action line", () => {
    assert.deepEqual(parseAction("ANSWER: line one\nline two"), { kind: "ANSWER", text: "line one\nline two", prose: false })
    assert.deepEqual(parseAction("ANSWER: line one\nline two\nSEARCH: foo"), { kind: "ANSWER", text: "line one\nline two", prose: false })
})

test("parseAction: an empty SEARCH/OPEN/ANSWER is invalid with a reason", () => {
    assert.deepEqual(parseAction("SEARCH:"), { kind: "invalid", reason: "empty search" })
    assert.deepEqual(parseAction("SEARCH:    "), { kind: "invalid", reason: "empty search" })
    assert.deepEqual(parseAction("OPEN:"), { kind: "invalid", reason: "no ids" })
    assert.deepEqual(parseAction("OPEN: abc"), { kind: "invalid", reason: "no ids" })
    assert.deepEqual(parseAction("ANSWER:"), { kind: "invalid", reason: "empty answer" })
    assert.deepEqual(parseAction("ANSWER:    "), { kind: "invalid", reason: "empty answer" })
})

test("parseAction: a bare 'NOT IN EMAILS' reply is an ANSWER with bare: true", () => {
    assert.deepEqual(parseAction("NOT IN EMAILS"), { kind: "ANSWER", text: "NOT IN EMAILS", bare: true, prose: false })
    assert.deepEqual(parseAction("not in emails."), { kind: "ANSWER", text: "NOT IN EMAILS", bare: true, prose: false })
    assert.deepEqual(parseAction("Not In Emails!"), { kind: "ANSWER", text: "NOT IN EMAILS", bare: true, prose: false })
})

test("parseAction: plain text without an action line is invalid", () => {
    assert.deepEqual(parseAction("just some text with no action"), { kind: "invalid", reason: "no action line" })
    assert.deepEqual(parseAction(""), { kind: "invalid", reason: "no action line" })
})

// ---------------------------------------------------------------------------
// canonical
// ---------------------------------------------------------------------------

test("canonical: renders SEARCH, OPEN and ANSWER in their canonical form", () => {
    assert.equal(canonical(parseAction("SEARCH: florida power"), "raw"), "SEARCH: florida power")
    assert.equal(canonical(parseAction("OPEN: 3, 5"), "raw"), "OPEN: 3, 5")
    assert.equal(canonical(parseAction("ANSWER: yes"), "raw"), "ANSWER: yes")
})

test("canonical: an invalid action falls back to the raw text, trimmed", () => {
    assert.equal(canonical({ kind: "invalid" }, "  some raw text  "), "some raw text")
})

test("canonical: an invalid action's raw text is capped at 300 chars", () => {
    const raw = "y".repeat(400)
    const result = canonical({ kind: "invalid" }, raw)
    assert.equal(result.length, 300)
    assert.equal(result, "y".repeat(300))
})

// ---------------------------------------------------------------------------
// snippetOf
// ---------------------------------------------------------------------------

test("snippetOf: pulls subject/sender from the header and leaves a short body unchanged", () => {
    const email = makeEmail({ subject: "Hi", sender: "a@b.com", body: "Short body here." })
    assert.deepEqual(snippetOf(email), { subject: "Hi", sender: "a@b.com", start: "Short body here." })
})

test("snippetOf: collapses body whitespace", () => {
    const email = makeEmail({ subject: "Hi", sender: "a@b.com", body: "line one\n\n  line   two  " })
    assert.equal(snippetOf(email).start, "line one line two")
})

test("snippetOf: a body longer than SNIPPET_CHARS is cut at a word boundary and ends with ' …'", () => {
    const word = "supercalifragilistic "
    const body = word.repeat(30).trim() // well over SNIPPET_CHARS, no long unbroken word
    const email = makeEmail({ body })
    const { start } = snippetOf(email)
    assert.ok(start.endsWith(" …"), `expected a trailing " …", got: ${JSON.stringify(start.slice(-10))}`)
    assert.ok(start.length <= SNIPPET_CHARS + 2, `snippet should be capped near SNIPPET_CHARS, got length ${start.length}`)
    // The cut text itself (without the ellipsis marker) must be a prefix of the flattened body.
    const cutText = start.slice(0, -2)
    assert.ok(body.startsWith(cutText))
})

test("snippetOf: a body at or under SNIPPET_CHARS is not truncated", () => {
    const body = "x".repeat(SNIPPET_CHARS)
    const email = makeEmail({ body })
    assert.equal(snippetOf(email).start, body)
})

// ---------------------------------------------------------------------------
// shownEmail
// ---------------------------------------------------------------------------

test("shownEmail: leaves an email at or under EMAIL_CHAR_CAP unchanged", () => {
    const text = "x".repeat(EMAIL_CHAR_CAP)
    assert.equal(shownEmail(text), text)
})

test("shownEmail: over the cap, keeps exactly EMAIL_CHAR_CAP chars and appends a truncation marker with the right count", () => {
    const extra = 137
    const text = "x".repeat(EMAIL_CHAR_CAP + extra)
    const result = shownEmail(text)
    assert.equal(result, `${"x".repeat(EMAIL_CHAR_CAP)}\n[truncated: ${extra} more characters not shown]`)
    assert.ok(result.startsWith("x".repeat(EMAIL_CHAR_CAP)))
})

// ---------------------------------------------------------------------------
// renderSnippets + newEpisodeState (+ snippetLine)
// ---------------------------------------------------------------------------

function makeSearchFixture() {
    const emails = {
        "a/1.": makeEmail({ subject: "Alpha", sender: "alice@enron.com", file: "a/1.", body: "Alpha body text." }),
        "a/2.": makeEmail({ subject: "Beta", sender: "beta@enron.com", file: "a/2.", body: "Beta body text." }),
        "a/3.": makeEmail({ subject: "Gamma", sender: "gamma@enron.com", file: "a/3.", body: "Gamma body text." }),
    }
    return { emailOf: (path) => emails[path], emails }
}

test("renderSnippets + newEpisodeState: ids are sequential and stable across two searches", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    const first = renderSnippets("florida power", ["a/1.", "a/2."], state, emailOf)
    assert.equal(first, 'Search results for "florida power":\n[1] Subject: Alpha | From: alice@enron.com | Alpha body text.\n[2] Subject: Beta | From: beta@enron.com | Beta body text.')

    // a/1. was already seen in search 1: it keeps id 1 in search 2, and the new path a/3. gets the next free id (3).
    const second = renderSnippets("florida power", ["a/1.", "a/3."], state, emailOf)
    assert.match(second, /\[1\] Subject: Alpha/)
    assert.match(second, /\[3\] Subject: Gamma/)
})

test("renderSnippets: the second identical query (case-insensitive) is marked '(repeated search)'", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("florida power", ["a/1."], state, emailOf)
    const second = renderSnippets("Florida Power", ["a/1."], state, emailOf)
    assert.match(second, /^Search results for "Florida Power" \(repeated search\):/)
})

test("renderSnippets: no hits produces the exact 'No emails matched' message", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    assert.equal(renderSnippets("nothing", [], state, emailOf), 'No emails matched the search "nothing".')
})

test("snippetLine: marks an already-opened path with '(opened)'", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("q", ["a/1."], state, emailOf)
    assert.ok(!snippetLine(state, "a/1.", emailOf).includes("(opened)"))
    state.opened.add("a/1.")
    assert.ok(snippetLine(state, "a/1.", emailOf).endsWith("(opened)"))
})

// ---------------------------------------------------------------------------
// renderOpened
// ---------------------------------------------------------------------------

test("renderOpened: opens the requested ids in full and records them in state.opened", () => {
    const { emailOf, emails } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("q", ["a/1.", "a/2."], state, emailOf)
    const { text, opened } = renderOpened([1, 2], state, emailOf, 1_000_000)
    assert.deepEqual(opened, ["a/1.", "a/2."])
    assert.ok(text.startsWith("Opened emails:\n\n[1]\n"))
    assert.ok(text.includes(emails["a/1."]))
    assert.ok(text.includes(emails["a/2."]))
    assert.ok(state.opened.has("a/1.") && state.opened.has("a/2."))
})

test("renderOpened: an unknown id gets a note and is not opened", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("q", ["a/1."], state, emailOf)
    const { text, opened } = renderOpened([99], state, emailOf, 1_000_000)
    assert.deepEqual(opened, [])
    assert.match(text, /Unknown id 99/)
})

test("renderOpened: an already-opened id gets a note instead of being reopened", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("q", ["a/1."], state, emailOf)
    renderOpened([1], state, emailOf, 1_000_000)
    const { text, opened } = renderOpened([1], state, emailOf, 1_000_000)
    assert.deepEqual(opened, [])
    assert.match(text, /\[1\] was already opened above\./)
})

test("renderOpened: more than MAX_OPEN ids -> only the first MAX_OPEN are considered, plus a note", () => {
    assert.equal(MAX_OPEN, 3)
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("q", ["a/1.", "a/2.", "a/3."], state, emailOf)
    const { text, opened } = renderOpened([1, 2, 3, 4], state, emailOf, 1_000_000)
    assert.deepEqual(opened, ["a/1.", "a/2.", "a/3."])
    assert.match(text, /Only the first 3 ids were considered\./)
})

test("renderOpened: a small room opens only the emails that fit and lists the rest as 'Not opened'", () => {
    const { emailOf } = makeSearchFixture()
    const state = newEpisodeState()
    renderSnippets("q", ["a/1.", "a/2."], state, emailOf)
    const cost1 = textTokens(`[1]\n${emailOf("a/1.")}`)
    const { text, opened } = renderOpened([1, 2], state, emailOf, cost1)
    assert.deepEqual(opened, ["a/1."])
    assert.match(text, /Not opened \[2\]/)
})

// ---------------------------------------------------------------------------
// conversationTokens / textTokens
// ---------------------------------------------------------------------------

test("textTokens matches ceil(len / CONSERVATIVE_CHARS_PER_TOKEN) + MESSAGE_TOKEN_ALLOWANCE", () => {
    const text = "x".repeat(137)
    const expected = Math.ceil(text.length / CONSERVATIVE_CHARS_PER_TOKEN) + 8
    assert.equal(textTokens(text), expected)
})

test("conversationTokens matches ceil(totalChars / CONSERVATIVE_CHARS_PER_TOKEN) + TEMPLATE_TOKEN_ALLOWANCE + 8 * messages.length", () => {
    const messages = [{ content: "a".repeat(50) }, { content: "b".repeat(120) }, { content: "c".repeat(7) }]
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    const expected = Math.ceil(totalChars / CONSERVATIVE_CHARS_PER_TOKEN) + TEMPLATE_TOKEN_ALLOWANCE + 8 * messages.length
    assert.equal(conversationTokens(messages), expected)
})

// ---------------------------------------------------------------------------
// runEpisode
// ---------------------------------------------------------------------------

function episodeFixture() {
    const emails = {
        "a/1.": makeEmail({ subject: "Netting Agreement", sender: "kay.mann@enron.com", recipients: ["sara.shackleton@enron.com"], file: "a/1.", body: "There is a netting agreement with FPL that covers all transactions." }),
        "a/2.": makeEmail({ subject: "Re: FPL", sender: "sara.shackleton@enron.com", recipients: ["kay.mann@enron.com"], file: "a/2.", body: "Thanks for confirming." }),
    }
    const emailOf = (path) => emails[path]
    const search = async () => [{ path: "a/1." }, { path: "a/2." }]
    return { emails, emailOf, search }
}

// A fake chatTurn that returns each queued ollama-like record in order.
function queuedChatTurn(queue) {
    let index = 0
    return async (messages) => {
        if (index >= queue.length) throw new Error(`chatTurn queue exhausted after ${index} calls (now ${messages.length} messages)`)
        return queue[index++]
    }
}

test("runEpisode: SEARCH -> OPEN -> ANSWER answers with the canonical transcript, not the model's prose", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([
        { status: "ok", answer: "Let me look.\nSEARCH: FPL agreement", promptEvalCount: 10, evalCount: 5, wallMs: 100 },
        { status: "ok", answer: "OPEN: 1", promptEvalCount: 20, evalCount: 5, wallMs: 100 },
        { status: "ok", answer: "ANSWER: There is a netting agreement.", promptEvalCount: 30, evalCount: 8, wallMs: 120 },
    ])
    const episode = await runEpisode({ question: "What agreement covers FPL?", chatTurn, search, emailOf, maxRounds: 5 })

    assert.equal(episode.status, "ok")
    assert.equal(episode.outcome, "answered")
    assert.equal(episode.rounds, 2)
    assert.deepEqual(episode.shownPaths, ["a/1.", "a/2."])
    assert.deepEqual(episode.openedPaths, ["a/1."])
    assert.deepEqual(episode.queries, ["FPL agreement"])

    // Every assistant message is the canonical action, never the raw prose.
    const assistantMessages = episode.transcript.filter((m) => m.role === "assistant").map((m) => m.content)
    assert.deepEqual(assistantMessages, ["SEARCH: FPL agreement", "OPEN: 1", "ANSWER: There is a netting agreement."])
    assert.ok(!assistantMessages[0].includes("Let me look"))

    // The last user message before the answer (the OPEN result) ends with the round-3 footer.
    const lastUserBeforeAnswer = episode.transcript[episode.transcript.length - 2]
    assert.equal(lastUserBeforeAnswer.role, "user")
    assert.ok(lastUserBeforeAnswer.content.endsWith(footer(3)), `expected the footer "Rounds left: 3...", got tail: ${JSON.stringify(lastUserBeforeAnswer.content.slice(-80))}`)
})

test("runEpisode: one invalid turn then a valid path sends the CORRECTION and counts one protocolError", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([
        { status: "ok", answer: "I dunno what to do here" },
        { status: "ok", answer: "SEARCH: fpl" },
        { status: "ok", answer: "ANSWER: done" },
    ])
    const episode = await runEpisode({ question: "Q?", chatTurn, search, emailOf, maxRounds: 5 })
    assert.equal(episode.protocolErrors, 1)
    assert.equal(episode.status, "ok")
    assert.equal(episode.outcome, "answered")
    const correctionMessage = episode.transcript.find((m) => m.role === "user" && m.content.startsWith(CORRECTION))
    assert.ok(correctionMessage, "expected a user message starting with CORRECTION")
})

test("runEpisode: two invalid turns in a row force the answer with the FORCED text", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([
        { status: "ok", answer: "blah blah" },
        { status: "ok", answer: "still blah" },
        { status: "ok", answer: "ANSWER: forced answer here" },
    ])
    const episode = await runEpisode({ question: "Q?", chatTurn, search, emailOf, maxRounds: 5 })
    assert.equal(episode.forcedEarly, true)
    assert.equal(episode.outcome, "forced")
    assert.equal(episode.answer, "forced answer here")
    // The user message after the 2nd invalid turn ends with the FORCED text.
    const messageBeforeForcedAnswer = episode.transcript[episode.transcript.length - 2]
    assert.equal(messageBeforeForcedAnswer.role, "user")
    assert.ok(messageBeforeForcedAnswer.content.endsWith(FORCED), `expected the message before the forced answer to end with FORCED, got: ${JSON.stringify(messageBeforeForcedAnswer.content.slice(-80))}`)
})

test("runEpisode: five valid SEARCH rounds then a forced 'ANSWER: x' -> outcome forced", async () => {
    assert.equal(MAX_ROUNDS, 5)
    const { emailOf, search } = episodeFixture()
    const queue = Array.from({ length: 5 }, (_, i) => ({ status: "ok", answer: `SEARCH: round ${i}` }))
    queue.push({ status: "ok", answer: "ANSWER: x" })
    const episode = await runEpisode({ question: "Q?", chatTurn: queuedChatTurn(queue), search, emailOf, maxRounds: 5 })
    assert.equal(episode.status, "ok")
    assert.equal(episode.outcome, "forced")
    assert.equal(episode.answer, "x")
    assert.equal(episode.rounds, 5)
})

test("runEpisode: five valid SEARCH rounds then an unprefixed forced reply -> outcome forcedUnprefixed", async () => {
    const { emailOf, search } = episodeFixture()
    const queue = Array.from({ length: 5 }, (_, i) => ({ status: "ok", answer: `SEARCH: round ${i}` }))
    queue.push({ status: "ok", answer: "x is the answer" })
    const episode = await runEpisode({ question: "Q?", chatTurn: queuedChatTurn(queue), search, emailOf, maxRounds: 5 })
    assert.equal(episode.outcome, "forcedUnprefixed")
    assert.equal(episode.answer, "x is the answer")
})

test("runEpisode: five valid SEARCH rounds then another SEARCH on the forced turn -> status empty, outcome noAnswer", async () => {
    const { emailOf, search } = episodeFixture()
    const queue = Array.from({ length: 5 }, (_, i) => ({ status: "ok", answer: `SEARCH: round ${i}` }))
    queue.push({ status: "ok", answer: "SEARCH: again" })
    const episode = await runEpisode({ question: "Q?", chatTurn: queuedChatTurn(queue), search, emailOf, maxRounds: 5 })
    assert.equal(episode.status, "empty")
    assert.equal(episode.outcome, "noAnswer")
    assert.equal(episode.answer, "")
})

test("runEpisode: a transient failure mid-episode returns that status and leaves the episode unfinished", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([
        { status: "ok", answer: "SEARCH: fpl" },
        { status: "http_error", error: "boom" },
    ])
    const episode = await runEpisode({ question: "Q?", chatTurn, search, emailOf, maxRounds: 5 })
    assert.equal(episode.status, "http_error")
    assert.equal(episode.outcome, null, "a transient failure ends the episode before an outcome is decided")
    assert.equal(episode.error, "boom")
})

test("runEpisode: context_overflow -> outcome agentOverflow, status empty", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([{ status: "context_overflow" }])
    const episode = await runEpisode({ question: "Q?", chatTurn, search, emailOf, maxRounds: 5 })
    assert.equal(episode.outcome, "agentOverflow")
    assert.equal(episode.status, "empty")
})

test("runEpisode: rawFirst inserts 'SEARCH: <question>' as the first assistant turn, starts rounds at 1, and the first chatTurn already sees search results", async () => {
    const { emailOf, search } = episodeFixture()
    const question = "What agreement covers FPL?"
    let firstCallMessages = null
    const chatTurn = async (messages) => {
        // runEpisode keeps pushing onto this same array after the call returns, so
        // snapshot it now rather than keeping a live reference.
        if (firstCallMessages === null) firstCallMessages = messages.slice()
        return { status: "ok", answer: "ANSWER: x" }
    }
    const episode = await runEpisode({ question, chatTurn, search, emailOf, maxRounds: 5, rawFirst: true })
    assert.equal(episode.rounds, 1)
    assert.equal(episode.outcome, "answered")
    assert.equal(episode.transcript[1].role, "assistant")
    assert.equal(episode.transcript[1].content, `SEARCH: ${question}`)
    // The first (and only) chatTurn call already sees the search results as a user message.
    assert.equal(firstCallMessages.length, 3)
    assert.match(firstCallMessages[2].content, /^Search results for/)
})

test("runEpisode: a cut-off turn sets turn.cutOff and sends the CUT_OFF message", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([
        { status: "output_limit", answer: "" },
        { status: "ok", answer: "ANSWER: done" },
    ])
    const episode = await runEpisode({ question: "Q?", chatTurn, search, emailOf, maxRounds: 5 })
    assert.equal(episode.cutOffs, 1)
    assert.equal(episode.turns[0].cutOff, true)
    const cutOffMessage = episode.transcript.find((m) => m.role === "user" && m.content.startsWith(CUT_OFF))
    assert.ok(cutOffMessage, "expected a user message starting with CUT_OFF")
})

test("runEpisode: a bare 'NOT IN EMAILS' reply is accepted as the answer", async () => {
    const { emailOf, search } = episodeFixture()
    const chatTurn = queuedChatTurn([{ status: "ok", answer: "NOT IN EMAILS" }])
    const episode = await runEpisode({ question: "Q?", chatTurn, search, emailOf, maxRounds: 5 })
    assert.equal(episode.outcome, "answered")
    assert.equal(episode.answer, "NOT IN EMAILS")
    assert.equal(episode.status, "ok")
})

test("runEpisode: determinism -- the same script run twice gives the same transcriptSha", async () => {
    const { emailOf, search } = episodeFixture()
    const makeQueue = () => [
        { status: "ok", answer: "SEARCH: fpl" },
        { status: "ok", answer: "ANSWER: final" },
    ]
    const ep1 = await runEpisode({ question: "Q?", chatTurn: queuedChatTurn(makeQueue()), search, emailOf, maxRounds: 5 })
    const ep2 = await runEpisode({ question: "Q?", chatTurn: queuedChatTurn(makeQueue()), search, emailOf, maxRounds: 5 })
    assert.equal(ep1.transcriptSha, ep2.transcriptSha)
})

test("episodeSha: differs by variant and by rawFirst, and is stable for identical inputs", () => {
    const base = episodeSha("Q?")
    assert.equal(episodeSha("Q?"), base, "stable for identical inputs")
    assert.notEqual(episodeSha("Q?", "null"), base, "should differ for variant null")
    assert.notEqual(episodeSha("Q?", "standard", true), base, "should differ for rawFirst")
})

test("firstMessage: variant 'null' is a reworded, answer-neutral variant of the standard prompt", () => {
    const question = "What agreement covers FPL?"
    assert.notEqual(firstMessage(question, "null"), firstMessage(question))
    assert.ok(firstMessage(question, "null").includes(question))
    assert.ok(firstMessage(question).includes(question))
})

// ---------------------------------------------------------------------------
// adjudicationEvidence
// ---------------------------------------------------------------------------

test("adjudicationEvidence: opened paths appear in full, shown-but-unopened paths as a snippet line, and supporting holds only the isSupporting entries", () => {
    const { emailOf, emails } = episodeFixture()
    const episode = {
        idOf: { "a/1.": 1, "a/2.": 2 },
        shownPaths: ["a/1.", "a/2."],
        openedPaths: ["a/1."],
    }
    const isSupporting = (path) => path === "a/1."
    const { emails: rendered, supporting } = adjudicationEvidence(episode, { emailOf, isSupporting })

    assert.equal(rendered.length, 2)
    assert.equal(rendered[0], `[1]\n${emails["a/1."]}`)
    assert.ok(rendered[1].startsWith("Search result only (not opened):\n"))
    assert.match(rendered[1], /\[2\] Subject: Re: FPL/)

    assert.equal(supporting.length, 1)
    assert.equal(supporting[0], rendered[0])
})

test("adjudicationEvidence: an episode with no shownPaths gives empty emails (no fallback to the gold)", () => {
    const { emailOf } = episodeFixture()
    const episode = { idOf: {}, shownPaths: [], openedPaths: [] }
    const { emails, supporting } = adjudicationEvidence(episode, { emailOf, isSupporting: () => true })
    assert.deepEqual(emails, [])
    assert.deepEqual(supporting, [])
})

test("adjudicationEvidence: sha is stable for identical input and changes when an email's text changes", () => {
    const episode = { idOf: { "a/1.": 1 }, shownPaths: ["a/1."], openedPaths: ["a/1."] }
    const emailOfA = () => makeEmail({ body: "Version A of the body." })
    const emailOfB = () => makeEmail({ body: "Version B of the body." })
    const isSupporting = () => false
    const shaA1 = adjudicationEvidence(episode, { emailOf: emailOfA, isSupporting }).sha
    const shaA2 = adjudicationEvidence(episode, { emailOf: emailOfA, isSupporting }).sha
    const shaB = adjudicationEvidence(episode, { emailOf: emailOfB, isSupporting }).sha
    assert.equal(shaA1, shaA2)
    assert.notEqual(shaA1, shaB)
})

// ---------------------------------------------------------------------------
// module-level sanity
// ---------------------------------------------------------------------------

test("sanity: STOP_SEQUENCES never stops on an action keyword, only on hallucinated tool output", () => {
    for (const stop of STOP_SEQUENCES) assert.ok(!/SEARCH|OPEN|ANSWER/.test(stop))
})

test("sanity: protocol constants used by the fixtures above match the module", () => {
    assert.equal(AGENT_PROTOCOL_VERSION, "premise2-agent-v1")
    assert.equal(SEARCH_K, 10)
    assert.ok(ABSTAIN.length > 0)
})
