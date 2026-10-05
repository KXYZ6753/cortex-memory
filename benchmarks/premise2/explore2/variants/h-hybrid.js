// Hybrid perfecter (prefix h): s1 (gates + r5's cross-encoder slot-5 swap + mailbox
// dedup) answers first, unchanged. A cheap failure detector on that answer decides
// whether to spend e2b YES/NO relevance probes (w7's probe) on the asker's best
// unseen mailbox emails; only then may the answer be replaced.
//
// src = the email of the answered context holding most of the answer's novel words (a-common attribute).
// Detector (h1/h2): one YES/NO probe on src; keep s1's answer when src gets YES.
// Optional pre-gate t1 (h3), calibrated offline on stored gates/r5 answers, FULL-0 + S300-1, tools/h-calib.js:
//   covGap = best question-word coverage among the 20 best-ranked unseen mailbox emails − coverage of src
//   ceGap  = best MiniLM score among unseen candidates (mailbox top 30 ∪ global top 10) − MiniLM score of src
//   fire when covGap ≥ 0.15, or ceGap > 1 and covGap > 0 (dev: 0.9–1.1% of correct hits)
// Action when src is NO (or s1 abstained): probe the top-16 unseen candidates, ordered by
// RRF(k=10) of MiniLM rank and retrieval rank (clipped to 3,000 chars, 3 output tokens).
// If any says YES, re-answer (sandwich) from the YES emails (h2: ≤4, filled to 5 from s1's
// final context minus src) and replace s1's answer unless that abstains.

import { join } from "node:path"
import { loadReranker, rerankText } from "../../rerank.js"
import { sandwichPrompt, byHeaderRank, clip } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { generationOptions } from "../../ollama.js"
import { contentWords, normaliseForMatch } from "../../text.js"
import { attribute } from "./a-common.js"
import { dedupContext } from "./o-reading.js"
import { relevancePrompt } from "./w-map.js"

const reranker = (ctx) => ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
const YESNO = () => generationOptions({ num_predict: 3 })
const okStatus = (r) => r.status === "ok" || r.status === "output_limit"

export const coverage = (question, email) => {
    const qw = contentWords(question)
    const lower = normaliseForMatch(email)
    return qw.filter((w) => lower.includes(w)).length / Math.max(1, qw.length)
}

export const TRIGGERS = {
    t1: (f) => f.covGap >= 0.15 || (f.ceGap > 1 && f.covGap > 0),
    cov: (f) => f.covGap >= 0.15,
}

export async function hybrid(ctx, record, { trigger = null, probeN = 16, maxYes = 5, fill = false, withBest = false, fire = true, base: baseMode = "s1" } = {}) {
    const question = record.question
    const globalAll = await ctx.search(question, 20)
    const global = globalAll.slice(0, 5)
    const mailboxRanked = (await ctx.search(question, 30, record.user)).slice(0, 30)
    const mailboxOrdered = byHeaderRank(question, mailboxRanked.slice(0, 20), ctx.emailOf)
    // base "s1": dedup + swap always; "r4": gates' mailbox ctx, swap only if CE > global CE max − 1; "gates": no swap
    const mailbox = baseMode === "s1" ? dedupContext(mailboxOrdered.slice(0, 5), ctx, mailboxOrdered) : mailboxOrdered.slice(0, 5)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    // MiniLM over mailbox top 30 ∪ global top 10 (s1 scores only the unseen mailbox part)
    const cands = [...new Set([...mailboxRanked, ...globalAll.slice(0, 10)])]
    const model = await reranker(ctx)
    // s1's exact batch first (the unseen mailbox part), so its swap is reproduced bit for bit
    // (r4 scores [...new Set([...mailboxRanked, ...global])] in one batch)
    const first = baseMode === "r4" ? [...new Set([...mailboxRanked, ...global])] : mailboxRanked.filter((path) => !global.includes(path))
    const rest = cands.filter((path) => !first.includes(path))
    const ce = new Map()
    for (const batch of [first, rest]) {
        if (!batch.length) continue
        const raw = await model.score(question, batch.map((path) => rerankText(ctx.emailOf(path))))
        batch.forEach((path, i) => ce.set(path, raw[i]))
    }
    const s = (path) => ce.get(path) ?? -20
    let globalCtx = global
    let swapped = false
    if (!switched && baseMode !== "gates") {
        const pool = mailboxRanked.filter((path) => !global.includes(path))
        const best = pool.length ? pool.reduce((b, p) => (s(p) > s(b) ? p : b)) : null
        if (best && (baseMode === "s1" || s(best) > Math.max(...global.map(s)) - 1)) {
            globalCtx = [...global.slice(0, 4), best]
            swapped = true
        }
    }
    const contexts = switched ? [mailbox, globalCtx] : [globalCtx, mailbox]
    const prompt = (paths) => sandwichPrompt(question, paths.map((path) => ctx.emailOf(path)))
    let result = await ctx.generate({ prompt: prompt(contexts[0]) })
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ctx.generate({ prompt: prompt(contexts[used]) })
        used++
    }
    const final = contexts[used - 1]
    const base = { status: result.status, answer: result.answer ?? "", contextPaths: contexts[0], readPaths: contexts.slice(0, used).flat(), switched, swapped, used }
    if (!okStatus(result)) return { ...base, step: "base-error" }
    const abst = isAbstain(result.answer)
    const src = abst ? null : attribute(result.answer, question, final, ctx.emailOf)
    const unseen = cands.filter((p) => !final.includes(p))
    const mailUnseen = mailboxRanked.filter((p) => !final.includes(p)).slice(0, 20)
    const covSrc = src ? coverage(question, ctx.emailOf(src.path)) : 0
    const f = {
        covGap: Math.max(0, ...mailUnseen.map((p) => coverage(question, ctx.emailOf(p)))) - covSrc,
        ceGap: Math.max(-20, ...unseen.map(s)) - (src ? s(src.path) : -20),
    }
    const feats = { covGap: +f.covGap.toFixed(3), ceGap: +f.ceGap.toFixed(3), srcIdx: src?.index ?? -1 }
    if (!fire || (trigger && !TRIGGERS[trigger](f))) return { ...base, step: "unfired", feats }
    // probe order: RRF(k=10) of MiniLM rank and retrieval rank (mailbox top 30, then global extras)
    const byCe = [...unseen].sort((a, b) => s(b) - s(a))
    const rr = (p) => 1 / (10 + byCe.indexOf(p)) + 1 / (10 + unseen.indexOf(p))
    const probeList = [...unseen].sort((a, b) => rr(b) - rr(a)).slice(0, probeN)
    const probeOne = async (path) => {
        const r = await ctx.generate({ prompt: relevancePrompt(question, clip(ctx.emailOf(path), 3000)), options: YESNO() })
        return okStatus(r) && /^\W*YES\b/i.test(r.answer ?? "")
    }
    let srcYes = false
    if (src) srcYes = await probeOne(src.path)
    if (srcYes) return { ...base, step: "src-yes", feats, probes: 1 }
    const yes = []
    for (const path of probeList) if (await probeOne(path)) yes.push(path)
    const probes = (src ? 1 : 0) + probeList.length
    if (!yes.length) return { ...base, step: "no-yes", feats, probes }
    const reCtx = yes.slice(0, maxYes)
    if (fill) for (const p of final) if (reCtx.length < 5 && p !== src?.path && !reCtx.includes(p)) reCtx.push(p)
    if (withBest && !reCtx.includes(final[0])) reCtx.push(final[0])
    const second = await ctx.generate({ prompt: prompt(reCtx) })
    if (!okStatus(second) || isAbstain(second.answer) || !String(second.answer ?? "").trim()) return { ...base, step: "re-abstain", feats, probes, yes }
    return { ...base, status: second.status, answer: second.answer, readPaths: [...base.readPaths, ...reCtx], step: "replaced", feats, probes, yes, reCtx, baseAnswer: result.answer }
}

export const VARIANTS = {
    h0: { version: 1, diagnostic: true, describe: "DIAGNOSTIC: s1 reimplemented inside h-hybrid (detector computed, never fires)", run: (ctx, record) => hybrid(ctx, record, { fire: false }) },
    h1: { version: 3, describe: "s1; YES/NO probe on the answer's source email; if NO, probe top-16 unseen (RRF of MiniLM + retrieval rank); re-answer from the YES emails (<=5) unless it abstains", run: (ctx, record) => hybrid(ctx, record) },
    h2: { version: 3, describe: "h1 with the re-answer context = YES emails (<=4) filled to 5 from s1's final context minus the source email", run: (ctx, record) => hybrid(ctx, record, { maxYes: 4, fill: true }) },
    h4: { version: 1, describe: "h1's probe escalation on an r4 base (gates + conditional CE swap; hit prompts as gates/r4)", run: (ctx, record) => hybrid(ctx, record, { base: "r4" }) },
    h5: { version: 1, describe: "h1's probe escalation on plain gates (no swap)", run: (ctx, record) => hybrid(ctx, record, { base: "gates" }) },
    h6: { version: 1, describe: "h4 with h2's re-answer context (YES <=4 + final minus src)", run: (ctx, record) => hybrid(ctx, record, { base: "r4", maxYes: 4, fill: true }) },
    h3: { version: 2, describe: "h1 pre-gated by the offline detector t1 (cov gap >= .15, or CE gap > 1 and cov gap > 0)", run: (ctx, record) => hybrid(ctx, record, { trigger: "t1" }) },
}
