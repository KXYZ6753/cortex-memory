// Worker k (agent control loop & commitment). See docs/premise-study/explore2/k.md.
//
// Design rule from the data: e2b's agent failure is commitment/selection, and every
// wrong decision on a hit costs ~0.47 weighted points. So the agent's state is a
// working set that only grows ("expand, don't replace"), the model decides with tiny
// constrained outputs, and the final answer is read over the best-ranked part of the
// working set, never over the last opened email alone.
//
//   k1  commit-gated expand agent
//       0. the harness runs the first search on the raw question (gates' two contexts);
//          the first context W0 is the open working set.
//       1. COMMIT CHECK (model): YES/NO "does this email contain the answer" on W0's
//          emails in rank order, stopping at the first YES. YES -> stop and answer from
//          W0 (exactly gates).
//       2. EXPLORE (only when nothing open is judged answer-bearing):
//          a. PICK (model): one number from a list of unopened candidates (gates' second
//             context + header-ranked mailbox top 30), sender | subject | focused excerpt.
//             The pick is opened and checked (YES/NO).
//          b. SEARCH (model): if the pick is NO, the model writes a search (FROM / TO /
//             ABOUT); the harness runs it in the asker's mailbox (sender/recipient
//             filtered when given) and shows a fresh list; PICK + check again.
//          c. up to `maxOpens` opens; stop at the first YES.
//       3. ANSWER over the working set: the YES email first, then W0's top 4; with no
//          YES, W0's top 4 plus the model's first pick in slot 5. Abstention retries
//          once on the second context (as gates).
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { sandwichPrompt, byHeaderRank, clip } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { toBm25Query } from "../../../../src/bm25.js"
import { relevancePrompt } from "./w-map.js"
import { loadReranker, rerankText } from "../../rerank.js"
import { pickPrompt, parsePick, listLines } from "./a-agent.js"

const YESNO = () => generationOptions({ num_predict: 3 })
const PICK = () => generationOptions({ num_predict: 12 })
const PLAN = () => generationOptions({ num_predict: 40, stop: ["\n\n"] })
const ok = (r) => r.status === "ok" || r.status === "output_limit"

export async function probe(ctx, record, path, log) {
    const r = await ctx.generate({ prompt: relevancePrompt(record.question, clip(ctx.emailOf(path), 3000)), options: YESNO() })
    const yes = ok(r) && /^\W*YES\b/i.test(r.answer ?? "")
    log.push({ act: "check", path, reply: String(r.answer ?? "").trim().slice(0, 10), yes })
    return yes
}

export const planPrompt = (question) => `You are searching a person's email archive for the one email that answers a question. Write a search for it.

Question: ${question}

Reply on one line in exactly this form (leave a field empty if the question does not say):
FROM: <name of the person who wrote the email> | TO: <name of the person it was sent to> | ABOUT: <3 to 6 keywords likely to appear in the email>

Search:`

export function parsePlan(text) {
    const t = String(text ?? "").replace(/\n/g, " ")
    const field = (name) => (t.match(new RegExp(`${name}\\s*:\\s*([^|]*)`, "i"))?.[1] ?? "").replace(/[<>]/g, "").trim()
    const clean = (s) => (/^(none|n\/a|unknown|empty|-|\?)$/i.test(s) ? "" : s)
    return { from: clean(field("FROM")), to: clean(field("TO")), about: clean(field("ABOUT")) }
}

const NAME_STOP = new Set("the and email person sender recipient someone unknown enron mr mrs ms dr".split(" "))
const nameTokens = (s) => [...new Set((String(s).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !NAME_STOP.has(w)))]

// Mailbox search with optional sender / recipient filters (FTS5 column filters on the
// main BM25 index, same tokenizer and rank). Falls back to unfiltered when empty.
async function plannedSearch(ctx, record, plan, k = 20) {
    const db = await ctx.resource("k-fts", () => {
        const handle = new DatabaseSync(join(ctx.dataDir, "corpus.sqlite"), { readOnly: true })
        return { handle, stmt: handle.prepare("SELECT path FROM docs WHERE docs MATCH ? AND user = ? ORDER BY rank LIMIT ?"), close: () => handle.close() }
    })
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

// Context-level commit check: the model reads all open emails (same prefix as the
// sandwich answer prompt, so Ollama's prompt cache serves the answer call) and says
// whether they answer the question.
export function contextCheckPrompt(question, emails) {
    const full = sandwichPrompt(question, emails)
    return `${full.slice(0, full.lastIndexOf("EMAILS>>>") + "EMAILS>>>".length)}

Question: ${question}
Do the emails above contain the information needed to answer this question? Reply with only YES or NO.`
}

async function expandAgent(ctx, record, { maxOpens = 3, search = true, listSize = 15, commit = "email", ceList = false } = {}) {
    const question = record.question
    const log = []
    // 0. first search (harness): gates' contexts.
    const global = (await ctx.search(question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(question, 30, record.user)
    const hdr = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    const mailbox = hdr.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const [W0, W1] = switched ? [mailbox, global] : [global, mailbox]
    const answerFrom = async (first, extra) => {
        const prompt = (paths) => sandwichPrompt(question, paths.map((p) => ctx.emailOf(p)))
        let result = await ctx.generate({ prompt: prompt(first) })
        let used = 1
        if (result.status === "ok" && isAbstain(result.answer) && W1.length) { result = await ctx.generate({ prompt: prompt(W1) }); used = 2 }
        return { status: result.status, answer: result.answer ?? "", contextPaths: first, readPaths: used === 2 ? [...first, ...W1] : first, switched, used, log, ...extra }
    }
    // 1. commit check on the open working set.
    if (commit === "context") {
        const r = await ctx.generate({ prompt: contextCheckPrompt(question, W0.map((p) => ctx.emailOf(p))), options: YESNO() })
        const yes = !ok(r) || !/^\W*NO\b/i.test(r.answer ?? "")
        log.push({ act: "check-all", reply: String(r.answer ?? "").trim().slice(0, 10), yes })
        if (yes) return answerFrom(W0, { step: "commit", checks: 1 })
    } else {
        for (const path of W0) {
            if (await probe(ctx, record, path, log)) return answerFrom(W0, { step: "commit", checks: log.length })
        }
    }
    // 2. explore.
    const seen = new Set(W0)
    let pool = [...new Set([...W1, ...hdr, ...mailboxRanked])].filter((p) => !seen.has(p)).slice(0, listSize)
    if (ceList) {
        // the harness orders the unopened candidates by the MiniLM cross-encoder (CPU)
        const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
        const cands = [...new Set([...W1, ...mailboxRanked])].filter((p) => !seen.has(p))
        const scores = await model.score(question, cands.map((p) => rerankText(ctx.emailOf(p))))
        pool = cands.map((p, i) => ({ p, s: scores[i] })).sort((a, b) => b.s - a.s).map((x) => x.p).slice(0, listSize)
    }
    const opened = []
    let found = null
    let firstPick = null
    let searched = false
    while (opened.length < maxOpens && !found) {
        if (!pool.length) break
        const lines = listLines(ctx, record, pool)
        const pick = await ctx.generate({ prompt: pickPrompt(question, lines), options: PICK() })
        const n = parsePick(pick.answer, pool.length)
        log.push({ act: "pick", reply: String(pick.answer ?? "").trim().slice(0, 12), path: n ? pool[n - 1] : null, listed: pool.slice() })
        if (n) {
            const path = pool[n - 1]
            opened.push(path)
            seen.add(path)
            firstPick ??= path
            if (await probe(ctx, record, path, log)) { found = path; break }
        }
        // after a NO (or no pick), the model writes one search; then pick from the rest.
        if (search && !searched) {
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
    // 3. answer over the working set.
    const final = found ? [found, ...W0.filter((p) => p !== found).slice(0, 4)] : firstPick ? [...W0.slice(0, 4), firstPick] : W0
    return answerFrom(final, { step: found ? "found" : firstPick ? "nofound" : "nopick", checks: log.filter((l) => l.act === "check").length, openedPaths: opened, foundPath: found })
}

export const VARIANTS = {
    k2: { version: 1, describe: "k1 with a context-level commit check (one YES/NO over all open emails) instead of per-email checks", run: (ctx, record) => expandAgent(ctx, record, { commit: "context" }) },
    k3: { version: 1, describe: "k1 with the explore list ordered by the cross-encoder (unopened gates ctx2 + mailbox top 30)", run: (ctx, record) => expandAgent(ctx, record, { ceList: true }) },
    k1: { version: 1, describe: "Agent: commit check (YES/NO) on open top results; else model picks/searches (FROM/TO/ABOUT), opens+checks up to 3; answer over working set (YES email first)", run: (ctx, record) => expandAgent(ctx, record) },
}
