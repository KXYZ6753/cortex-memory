// Worker d (round 5): retrieval add-ons for x1, by wrapping x1 (no copy of its code).
// See docs/premise-study/explore2/d.md.
//
// x1 builds its gates contexts from ctx.search(question, 30, user) (W0/W1 use only that
// list's top 20) and, when no W0 email gets a YES, its explore pick list is the MiniLM
// CE order over W1 ∪ that whole list (W0 excluded), top 15. So a wrapper that returns the
// mailbox BM25 top 30 *plus extra candidates* from that one call leaves W0, W1, the commit
// check, the answer prompt and the g5 handover untouched and changes only the explore
// pool (the CE still picks the top 15). Every other ctx call passes through.
//
//   d1  explore pool + nomic dense mailbox top N of the raw question (CPU query
//       embedding, ~15 ms; brute force over the asker's mailbox)
//   (more below as the recall lab selects them)
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { FINAL_STATUSES } from "../../explore/run.js"
import { readJson, loadDense, denseSearch } from "../../dense.js"
import { VARIANTS as X } from "./x-agent.js"
import { VARIANTS as G } from "./g-agent.js"
import { ownerTokens } from "./m-common.js"
import { openBm25 } from "../../bm25.js"
import { rerankText } from "../../rerank.js"
import { clip } from "../../explore/variants.js"

export const denseIndex = (ctx) => ctx.resource("p-dense", () => {
    const docs = readJson(join(ctx.dataDir, "dense-docs.json"))
    return loadDense(join(ctx.dataDir, "dense.f32"), docs.paths, docs.users)
})

// ctx whose explore-pool call (search(question, 30, user)) returns BM25 top 30 + extras
export function widenedCtx(ctx, record, extras) {
    let fired = false
    const wrapped = Object.create(ctx)
    wrapped.search = async (query, k, user = null) => {
        const paths = await ctx.search(query, k, user)
        if (fired || query !== record.question || k !== 30 || user !== record.user) return paths
        fired = true
        const started = performance.now()
        const more = await extras(ctx, record, paths)
        wrapped.dExtraMs = performance.now() - started
        const have = new Set(paths)
        const added = more.filter((p) => !have.has(p) && have.add(p))
        wrapped.dAdded = added
        return [...paths, ...added]
    }
    return wrapped
}

export const denseExtras = (n) => async (ctx, record) => {
    const index = await denseIndex(ctx)
    const vector = await ctx.embedQuery(record.question)
    return denseSearch(index, vector, n, record.user).map((hit) => hit.path)
}
// mailbox BM25 ranks 31..n (one extra query; its top 30 equals the call's)
export const deepExtras = (n) => async (ctx, record) => (await ctx.search(record.question, n, record.user)).slice(30)
export const both = (...fs) => async (ctx, record, paths) => (await Promise.all(fs.map((f) => f(ctx, record, paths)))).flat()

async function withExtras(ctx, record, extras, { fuseG5 = false } = {}) {
    const w = widenedCtx(ctx, record, extras)
    if (!fuseG5) {
        const result = await X.x1.run(w, record)
        return { ...result, dAdded: w.dAdded ?? [], dExtraMs: Math.round(w.dExtraMs ?? 0) }
    }
    // g5 handover search fused with the original question: while x1's g5 handover runs,
    // its mailbox search (ctx.search(query, 20, user)) returns the RRF (k=10) of BM25(query)
    // top 20 and BM25(question) top 20, cut to 20; g5 then header-reranks it as before.
    const real = G.g5
    let inG5 = false
    const inner = w.search
    w.search = async (query, k, user = null) => {
        if (!inG5 || k !== 20 || user !== record.user || query === record.question) return inner(query, k, user)
        const [a, b] = await Promise.all([ctx.search(query, 20, user), ctx.search(record.question, 20, user)])
        w.dG5Fused = (w.dG5Fused ?? 0) + 1
        return rrf([a, b], 10).slice(0, 20)
    }
    G.g5 = { ...real, run: async (c, r) => { inG5 = true; try { return await real.run(c, r) } finally { inG5 = false } } }
    try {
        const result = await X.x1.run(w, record)
        return { ...result, dAdded: w.dAdded ?? [], dExtraMs: Math.round(w.dExtraMs ?? 0), dG5Fused: w.dG5Fused ?? 0 }
    } finally {
        G.g5 = real
    }
}
const rrf = (lists, k = 10) => {
    const s = new Map()
    for (const l of lists) l.forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (k + i + 1)))
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
}

// Replay screening on development sets (as z-replay.js): where x1's stored answer took a
// path the d change cannot touch (commit, commit-g5), return it unchanged (no model call);
// on x1's explore questions (found / nofound / nopick) run the full d variant, commit
// check included. The comparison with x1 is then paired on exactly the questions the
// change can affect. Not for S300-4/5 (those get the real variant).
const setName = () => (process.argv[2] === "run" ? process.argv[3] : process.env.D_SET)
async function x1Stored(ctx, record) {
    const index = await ctx.resource(`d-x1-${setName()}`, () => {
        const map = new Map()
        const set = setName()
        for (const line of readFileSync(join(ctx.dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
            if (!line.includes('"variant":"x1"') || !line.includes(`"set":"${set}"`)) continue
            const a = JSON.parse(line)
            if (a.variant === "x1" && a.version === "1+cold" && a.set === set && FINAL.has(a.status)) map.set(a.questionKey, a)
        }
        return { map, close() {} }
    })
    return index.map.get(record.questionKey) ?? null
}
const FINAL = FINAL_STATUSES
const replay = (extras, opts = {}, runner = (ctx, record) => withExtras(ctx, record, extras, opts)) => async (ctx, record) => {
    const x = await x1Stored(ctx, record)
    if (!x) return { status: "http_error", answer: "", error: `no stored x1 answer for ${setName()}` }
    if (x.step === "commit" || (x.step === "commit-g5" && !opts.fuseG5)) return { status: x.status, answer: x.answer, contextPaths: x.contextPaths, readPaths: x.readPaths, step: x.step, replay: true, x1Wall: x.wallMs, x1Calls: x.calls }
    const r = await runner(ctx, record)
    return { ...r, replay: false, x1Step: x.step, x1Wall: x.wallMs, x1Calls: x.calls, x1Answer: x.answer }
}

// ---- lexical explore pool (d6 / d7), lazy: nothing extra runs unless x1 explores ----
// x1 loads the CE ("r-minilm") only on its explore path, right before it builds the pool
// cands = W1 ∪ mailboxRanked (W0 excluded). The wrapper keeps a reference to the array
// x1 got from search(question, 30, user); when x1 asks for the CE it (a) appends the
// owner-name-stripped and the subject×3/sender×2 mailbox BM25 top 20 to that array, and
// (b) hands x1 a CE proxy that scores foreign (other-mailbox) global emails at -1e9, so
// the 15-line list is CE over own(W1) ∪ BM25 top 30 ∪ strip 20 ∪ subj 20 (the lab's
// "ce(own:W1+bm30+strip20+subj20)": explore misses AB@5/10/15 148/181/198 vs x1 135/168/182).
export function stripOwner(question, user) {
    const own = ownerTokens(question, user)
    return question.split(/\s+/).filter((w) => { const lw = w.toLowerCase().replace(/[^a-z]/g, ""); return !own.has(lw) && !own.has(lw.replace(/s$/, "")) }).join(" ")
}
export function lexicalPoolCtx(ctx, record) {
    const w = Object.create(ctx)
    let mbox = null, global = null, widened = false
    w.search = async (query, k, user = null) => {
        const paths = await ctx.search(query, k, user)
        if (query === record.question && k === 30 && user === record.user && !mbox) mbox = paths
        if (query === record.question && k === 20 && user === null && !global) global = paths.slice(0, 5)
        return paths
    }
    w.resource = async (name, loader) => {
        const real = await ctx.resource(name, loader)
        if (name !== "r-minilm" || !mbox || widened) return real
        widened = true
        const started = performance.now()
        const subjBm = await ctx.resource("d-bm25-subj", () => openBm25(join(ctx.dataDir, "corpus.sqlite"), { weights: [0, 0, 3, 2, 1, 1] }))
        const strip = await ctx.search(stripOwner(record.question, record.user), 20, record.user)
        const subj = subjBm.search(record.question, 20, record.user).map((h) => h.path)
        const have = new Set(mbox)
        const added = [...strip, ...subj].filter((p) => !have.has(p) && have.add(p))
        mbox.push(...added)
        const ownText = new Set(mbox.map((p) => rerankText(ctx.emailOf(p))))
        const mask = new Set((global ?? []).filter((p) => !p.startsWith(`${record.user}/`)).map((p) => rerankText(ctx.emailOf(p))).filter((t) => !ownText.has(t)))
        w.dAdded = added
        w.dMasked = mask.size
        w.dExtraMs = performance.now() - started
        return {
            ...real,
            score: async (query, docs, batch) => {
                const keep = docs.map((d, i) => [d, i]).filter(([d]) => !mask.has(d))
                const s = keep.length ? await real.score(query, keep.map(([d]) => d), batch) : []
                const out = docs.map(() => -1e9)
                keep.forEach(([, i], j) => { out[i] = s[j] })
                return out
            },
        }
    }
    return w
}
async function withLexicalPool(ctx, record, { fuseG5 = false, seedG5 = false } = {}) {
    const w = lexicalPoolCtx(ctx, record)
    const run = async () => {
        const result = await X.x1.run(w, record)
        return { ...result, dAdded: w.dAdded ?? [], dMasked: w.dMasked ?? 0, dExtraMs: Math.round(w.dExtraMs ?? 0), dG5Fused: w.dG5Fused ?? 0, dYesPath: w.dYesPath ?? null, dG5Seeded: w.dG5Seeded ?? 0 }
    }
    if (seedG5) return withSeededG5(w, ctx, record, run)
    if (!fuseG5) return run()
    const real = G.g5
    let inG5 = false
    const inner = w.search
    w.search = async (query, k, user = null) => {
        if (!inG5 || k !== 20 || user !== record.user || query === record.question) return inner(query, k, user)
        const [a, b] = await Promise.all([ctx.search(query, 20, user), ctx.search(record.question, 20, user)])
        w.dG5Fused = (w.dG5Fused ?? 0) + 1
        return rrf([a, b], 10).slice(0, 20)
    }
    G.g5 = { ...real, run: async (c, r) => { inG5 = true; try { return await real.run(c, r) } finally { inG5 = false } } }
    try { return await run() } finally { G.g5 = real }
}

// ---- YES-seeded g5 handover search (d8) ----
// x1 hands an unsure commit to g5, a cold agent whose own query often loses the email the
// commit check said YES to (lab: AB in g5's top 3 on 535 / 566 handover hits; with the
// YES email added to its search results 548, top 3 changed on 59; misses 91 -> 102).
// The wrapper notes the first email e2b probed YES (by matching the probe prompt, which
// holds the clipped email) and, while g5 runs, makes g5's first own mailbox search return
// [YES email, ...BM25(query) top 20] (g5 then header-reranks it as usual).
function withSeededG5(w, ctx, record, run) {
    const innerChat = w.chatRaw ?? ctx.chatRaw
    const candidates = () => [...new Set([...(w.dGlobal ?? []), ...(w.dMbox ?? [])])]
    w.chatRaw = async (body) => {
        const data = await innerChat(body)
        const p = body?.messages?.[0]?.content
        if (!w.dYesPath && typeof p === "string" && p.startsWith("Does the email below") && /^\W*YES\b/i.test(String(data?.message?.content ?? ""))) {
            w.dYesPath = candidates().find((path) => p.includes(clip(ctx.emailOf(path), 3000))) ?? null
        }
        return data
    }
    const real = G.g5
    let inG5 = false
    const inner = w.search
    w.search = async (query, k, user = null) => {
        const paths = await inner(query, k, user)
        if (query === record.question && k === 30 && user === record.user && !w.dMbox) w.dMbox = paths.slice(0, 20)
        if (query === record.question && k === 20 && user === null && !w.dGlobal) w.dGlobal = paths.slice(0, 5)
        if (!inG5 || k !== 20 || user !== record.user || query === record.question || w.dG5Seeded || !w.dYesPath) return paths
        w.dG5Seeded = 1
        return [...new Set([w.dYesPath, ...paths])].slice(0, 20)
    }
    G.g5 = { ...real, run: async (c, r) => { inG5 = true; try { return await real.run(c, r) } finally { inG5 = false } } }
    return run().finally(() => { G.g5 = real })
}

// Dense is dropped from the integrated variants (d.md §2: a per-question CPU embedding
// through Ollama costs ~1 s and slows e2b 3-6x when interleaved with generation; the lab
// shows dense adds little over BM25 + CE). d4/d5 widen the explore pool with deeper
// mailbox BM25 only; d5 also fuses the original question into g5's handover search.
const DEEP = 100
export const VARIANTS = {
    d8: { version: 1, describe: "d6 + YES-seeded g5 handover: x1's first-YES email is added to the top of g5's first own mailbox search results (g5 header-reranks them as usual)", run: (ctx, record) => withLexicalPool(ctx, record, { seedG5: true }) },
    "d8r": { version: 1, describe: "REPLAY screening of d8 on dev sets (x1 stored on sure commits; d8 in full on handover and explore questions)", run: replay(null, { fuseG5: true }, (ctx, record) => withLexicalPool(ctx, record, { seedG5: true })) },
    d6: { version: 1, describe: "x1 + explore pick list = CE over own-mailbox W1 ∪ BM25 top 30 ∪ owner-stripped BM25 top 20 ∪ subject/sender-weighted BM25 top 20 (foreign global emails dropped); lazy (explore path only); W0/W1/commit/handover untouched; no dense", run: (ctx, record) => withLexicalPool(ctx, record) },
    "d6r": { version: 1, describe: "REPLAY screening of d6 on dev sets (x1 stored on commit/handover; d6 in full on x1's explore questions)", run: replay(null, {}, (ctx, record) => withLexicalPool(ctx, record)) },
    d7: { version: 1, describe: "d6 + x1's g5 handover search fused with the original question (RRF k=10 of BM25(model query) and BM25(question) mailbox top 20, then g5's header rerank)", run: (ctx, record) => withLexicalPool(ctx, record, { fuseG5: true }) },
    "d7r": { version: 1, describe: "REPLAY screening of d7 on dev sets (x1 stored on sure commits; d7 in full on handover and explore questions)", run: replay(null, { fuseG5: true }, (ctx, record) => withLexicalPool(ctx, record, { fuseG5: true })) },
    d4: { version: 1, describe: `x1 + explore pool widened with mailbox BM25 ranks 31-${DEEP} (the CE still picks the 15-line list); W0/W1/commit/handover untouched; no dense`, run: (ctx, record) => withExtras(ctx, record, deepExtras(DEEP)) },
    "d4r": { version: 1, describe: "REPLAY screening of d4 on dev sets (x1 stored on commit/handover; d4 in full on x1's explore questions)", run: replay(deepExtras(DEEP)) },
    d5: { version: 1, describe: `d4 + x1's g5 handover search fused with the original question (RRF k=10 of BM25(model query) and BM25(question) mailbox top 20, then g5's header rerank)`, run: (ctx, record) => withExtras(ctx, record, deepExtras(DEEP), { fuseG5: true }) },
    "d5r": { version: 1, describe: "REPLAY screening of d5 on dev sets (x1 stored on sure commits; d5 in full on handover and explore questions)", run: replay(deepExtras(DEEP), { fuseG5: true }) },
    d1: { version: 1, describe: "x1 + explore pool widened with nomic dense mailbox top 20 (raw question, CPU embedding); W0/W1/commit/handover untouched", run: (ctx, record) => withExtras(ctx, record, denseExtras(20)) },
    "d1r": { version: 1, describe: "REPLAY screening of d1 on dev sets: x1's stored answer on commit/handover questions, d1 run in full on x1's explore questions", run: replay(denseExtras(20)) },
    d2: { version: 1, describe: "x1 + explore pool widened with mailbox BM25 ranks 31-100 and nomic dense mailbox top 20 (CE still picks the 15-line list); W0/W1/commit/handover untouched", run: (ctx, record) => withExtras(ctx, record, both(deepExtras(100), denseExtras(20))) },
    d3: { version: 1, describe: "d2 + x1's g5 handover search fused with the original question (RRF k=10 of BM25(model query) and BM25(question) mailbox top 20, then g5's header rerank)", run: (ctx, record) => withExtras(ctx, record, both(deepExtras(100), denseExtras(20)), { fuseG5: true }) },
    "d3r": { version: 1, describe: "REPLAY screening of d3 on dev sets (x1 stored on sure commits; d3 in full on handover and explore questions)", run: replay(both(deepExtras(100), denseExtras(20)), { fuseG5: true }) },
    "d2r": { version: 1, describe: "REPLAY screening of d2 on dev sets (x1 stored on commit/handover; d2 in full on x1's explore questions)", run: replay(both(deepExtras(100), denseExtras(20))) },
}
