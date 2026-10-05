// Worker g (agent interface): e2b as a genuine tool-using agent, through Gemma 4's
// native function calling (Ollama /api/chat `tools`) or JSON-schema constrained
// decoding (`format`). The model decides what to search, what to read and when to
// answer; the harness keeps every model step small and makes reading cheap:
//   - search results show the top emails IN FULL plus one-line previews of the rest
//     (the main study: e2b saw the gold in snippets 91% of the time, opened it 41%);
//   - read(ids) opens several previews at once;
//   - the final answer is always a separate sandwich-prompt call over the emails the
//     agent actually read (<= 5, the agent's explicit reads first), never the
//     agent's free-text answer (gates' reading step).
// Starts:
//   cold   the model writes the first query itself (pure agent)
//   gates  the first search is made for the agent: its result is gates' first context
//          in full plus previews of the next candidates (second context, header-
//          reranked mailbox list). If the agent answers at once, the final call is
//          byte-identical to gates.
import { sandwichPrompt, byHeaderRank } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { focusSnippet } from "./a-agent.js"

const AGENT_PREDICT = 96
const AGENT_EMAIL_CHARS = 3500

const TOOL_DEFS = {
    search_mailbox: { description: "Search the asker's own mailbox for emails matching keywords. Returns numbered results: the best ones in full, the rest as one-line previews.", parameters: { type: "object", properties: { query: { type: "string", description: "keywords: names, subject words, distinctive terms from the question" } }, required: ["query"] } },
    search_all: { description: "Search all mailboxes (every employee) for emails matching keywords. Same result format.", parameters: { type: "object", properties: { query: { type: "string", description: "keywords" } }, required: ["query"] } },
    read: { description: "Open listed emails in full by their numbers (up to 3 at once).", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "integer" }, description: "email numbers, e.g. [7, 9]" } }, required: ["ids"] } },
    answer: { description: "Finish: answer the question from the emails you have read.", parameters: { type: "object", properties: { text: { type: "string", description: "the answer, one or two sentences" } }, required: ["text"] } },
}
const toolList = (names) => names.map((name) => ({ type: "function", function: { name, ...TOOL_DEFS[name] } }))

const ACTION_SCHEMA = (names) => ({
    type: "object",
    properties: { action: { type: "string", enum: names }, query: { type: "string" }, ids: { type: "array", items: { type: "integer" } }, text: { type: "string" } },
    required: ["action"],
})

const clipEmail = (email, chars = AGENT_EMAIL_CHARS) => (email.length <= chars ? email : `${email.slice(0, chars)}\n[... email truncated ...]`)

// Episode state: every email gets a stable number on first appearance.
class Episode {
    constructor(ctx, record) {
        this.ctx = ctx
        this.record = record
        this.ids = new Map()
        this.paths = []
        this.full = new Set()  // shown in full
        this.reads = []        // explicitly read (agent's read calls), in order
        this.log = []
    }
    idOf(path) {
        if (!this.ids.has(path)) { this.paths.push(path); this.ids.set(path, this.paths.length) }
        return this.ids.get(path)
    }
    fullBlock(path) { this.full.add(path); return `[${this.idOf(path)}]\n${clipEmail(this.ctx.emailOf(path))}` }
    previewLine(path) {
        const s = focusSnippet(this.ctx.emailOf(path), this.record.question, 200)
        return `[${this.idOf(path)}] From: ${s.sender || "(unknown)"} | Subject: ${s.subject || "(none)"} | ${s.text}`
    }
    // Result text: the first `nFull` unseen-in-full paths in full, then previews.
    results(paths, { nFull = 2, nPreview = 8 } = {}) {
        const fresh = paths.filter((path) => !this.full.has(path))
        const full = fresh.slice(0, nFull)
        const previews = fresh.slice(nFull, nFull + nPreview)
        const parts = []
        if (full.length) parts.push(`Emails in full:\n${full.map((path) => this.fullBlock(path)).join("\n\n")}`)
        if (previews.length) parts.push(`More results (previews; call read to open):\n${previews.map((path) => this.previewLine(path)).join("\n")}`)
        const seen = paths.filter((path) => this.full.has(path) && !full.includes(path)).map((path) => this.idOf(path))
        if (seen.length) parts.push(`Already shown in full: ${seen.map((n) => `[${n}]`).join(" ")}`)
        return parts.join("\n\n") || "No results."
    }
}

async function searchMailbox(ctx, record, query) {
    const ranked = await ctx.search(query, 20, record.user)
    return byHeaderRank(query, ranked, ctx.emailOf)
}
const searchAll = async (ctx, query) => (await ctx.search(query, 10))

function parseAction(data, mode) {
    if (data.error) return { name: "error", error: data.error }
    if (mode === "tools") {
        const call = data.message?.tool_calls?.[0]
        if (call) {
            let args = call.function?.arguments ?? {}
            if (typeof args === "string") { try { args = JSON.parse(args) } catch { args = {} } }
            return { name: call.function?.name, args, raw: call }
        }
        return { name: "text", args: { text: data.message?.content ?? "" } }
    }
    try {
        const parsed = JSON.parse(data.message?.content ?? "")
        return { name: parsed.action, args: parsed }
    } catch {
        return { name: "text", args: { text: data.message?.content ?? "" } }
    }
}

const normIds = (ids) => (Array.isArray(ids) ? ids : [ids]).map((value) => Number(String(value).replace(/\D/g, ""))).filter((n) => Number.isInteger(n) && n > 0)

function systemPrompt(record, { start, names }) {
    const lines = [
        `You find the answer to a question in the email archive of ${record.user} (an Enron employee). Work with tools, one call per turn:`,
        names.includes("search_mailbox") ? "- search_mailbox(query): search the asker's mailbox; the best results come in full, the rest as previews" : null,
        names.includes("search_all") ? "- search_all(query): search every employee's mailbox" : null,
        "- read(ids): open previewed emails in full (several at once)",
        "- answer(text): finish, once an email you have read answers the question",
        "Guidelines: an answer must come from an email shown in full. If the full emails do not answer the question, read the previews that look relevant before searching again. Search with names and distinctive words from the question. You have at most 3 tool calls.",
    ]
    if (start === "gates") lines.push("The first search has already been made for you; its results are below.")
    return lines.filter(Boolean).join("\n")
}

const finalOptions = () => generationOptions({ num_predict: 160 })

async function agent(ctx, record, { mode = "tools", start = "gates", maxCalls = 3, nFull = 2, nPreview = 8, names = ["search_mailbox", "search_all", "read", "answer"], finalCap = 5, fill = true } = {}) {
    const question = record.question
    const ep = new Episode(ctx, record)
    // gates' retrieval (no generation)
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 20, record.user)
    const mailboxOrdered = byHeaderRank(question, mailboxRanked, ctx.emailOf)
    const mailbox = mailboxOrdered.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const first = switched ? mailbox : global
    const second = switched ? global : mailbox

    const messages = [{ role: "system", content: systemPrompt(record, { start, names }) }, { role: "user", content: `Question: ${question}` }]
    const actions = []
    if (start === "gates") {
        const candidates = [...new Set([...first, ...second, ...mailboxOrdered])]
        const text = ep.results(candidates, { nFull: first.length, nPreview: 10 })
        if (mode === "tools") {
            messages.push({ role: "assistant", content: "", tool_calls: [{ function: { name: "search_mailbox", arguments: { query: question } } }] })
            messages.push({ role: "tool", tool_name: "search_mailbox", content: text })
        } else {
            messages.push({ role: "assistant", content: JSON.stringify({ action: "search_mailbox", query: question }) })
            messages.push({ role: "user", content: `Result:\n${text}` })
        }
        actions.push({ name: "search_mailbox", auto: true })
    }
    let finalText = null
    let nudged = false
    for (let call = 0; call < maxCalls; call++) {
        const body = { messages, options: generationOptions({ num_predict: AGENT_PREDICT }) }
        if (mode === "tools") body.tools = toolList(names)
        else body.format = ACTION_SCHEMA(names)
        const data = await ctx.chatRaw(body)
        const action = parseAction(data, mode)
        actions.push({ name: action.name, args: action.args, error: action.error })
        if (action.name === "error") break
        let reply
        if (action.name === "search_mailbox" || action.name === "search_all") {
            const query = String(action.args?.query ?? "").trim() || question
            const paths = action.name === "search_all" ? await searchAll(ctx, query) : await searchMailbox(ctx, record, query)
            reply = ep.results(paths, { nFull, nPreview })
        } else if (action.name === "read") {
            const ids = normIds(action.args?.ids).slice(0, 3)
            const valid = ids.filter((n) => n <= ep.paths.length)
            if (!valid.length) reply = `No such email number. Valid numbers: 1-${ep.paths.length}.`
            else {
                const blocks = valid.map((n) => {
                    const path = ep.paths[n - 1]
                    if (ep.full.has(path)) return `[${n}] is already shown in full above.`
                    ep.reads.push(path)
                    return ep.fullBlock(path)
                })
                reply = blocks.join("\n\n")
            }
        } else {
            // answer (or plain text / unknown tool = answer)
            if (!ep.full.size && !nudged) {
                nudged = true
                reply = "You have not read any email yet. Search first."
            } else {
                finalText = String(action.args?.text ?? "")
                break
            }
        }
        if (mode === "tools") {
            messages.push({ role: "assistant", content: data.message?.content ?? "", tool_calls: data.message?.tool_calls ?? [] })
            messages.push({ role: "tool", tool_name: action.name, content: reply })
        } else {
            messages.push({ role: "assistant", content: data.message?.content ?? "" })
            messages.push({ role: "user", content: `Result:\n${reply}` })
        }
    }
    // Final answer: sandwich over what was read. Explicit reads first (in reading order),
    // then (fill) the rest of the full-shown emails in order of appearance.
    let readSet = [...ep.reads]
    if (fill || !readSet.length) for (const path of ep.paths) if (ep.full.has(path) && !readSet.includes(path)) readSet.push(path)
    readSet = readSet.slice(0, finalCap)
    if (!readSet.length) readSet = first
    const prompt = (paths) => sandwichPrompt(question, paths.map((path) => ctx.emailOf(path)))
    let result = await ctx.generate({ prompt: prompt(readSet), options: finalOptions() })
    let retried = false
    if (result.status === "ok" && isAbstain(result.answer)) {
        const other = (readSet.every((path) => first.includes(path)) ? second : first).filter((path) => !readSet.includes(path))
        if (other.length) { result = await ctx.generate({ prompt: prompt(other), options: finalOptions() }); retried = true }
    }
    const goldShown = ep.paths.includes(record.path)
    return {
        status: result.status, answer: result.answer ?? "", contextPaths: first, readPaths: readSet, switched,
        shownPaths: ep.paths, openedPaths: [...ep.full], explicitReads: ep.reads, actions, agentText: finalText,
        nSearch: actions.filter((a) => a.name?.startsWith("search") && !a.auto).length, nRead: actions.filter((a) => a.name === "read").length,
        goldShown, goldFull: ep.full.has(record.path), goldInFinal: readSet.includes(record.path), retried,
    }
}

export const VARIANTS = {
    "g1": { version: 2, describe: "Agent (native tools, cold start): e2b searches/reads/answers; search shows top 2 in full + 8 previews; final sandwich over read emails", run: (ctx, record) => agent(ctx, record, { mode: "tools", start: "cold" }) },
    "g2": { version: 2, describe: "Agent (native tools, gates start): first search = gates' context in full + 10 previews; e2b answers/reads/searches; final sandwich (reads first, filled)", run: (ctx, record) => agent(ctx, record, { mode: "tools", start: "gates" }) },
    "g3": { version: 2, describe: "Agent (JSON-schema format, cold start), else as g1", run: (ctx, record) => agent(ctx, record, { mode: "json", start: "cold" }) },
    "g4": { version: 2, describe: "Agent (JSON-schema format, gates start), else as g2", run: (ctx, record) => agent(ctx, record, { mode: "json", start: "gates" }) },
}
