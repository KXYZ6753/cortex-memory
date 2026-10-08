// v6 (aux): encoder features of candidate answers on a deployable evidence set, from the QA cache.
import { join } from "node:path"
import { OUT, readCache } from "./v6-lib.js"
import { qaScores, lexGround, lexProx, words, novel } from "../variants/v6-common.js"
import { ensureEmailStore } from "../../agent-run.js"

export const qaCache = readCache(join(OUT, "v6-qa.jsonl"))
export const emails = await ensureEmailStore(".data/premise2", ".data/premise2/agent", () => {})

// spans of an evidence set from the cache (null if any email is unread)
export function readOf(q, paths) {
    const spans = []
    for (const p of paths) {
        const r = qaCache.get(`${q.key}|${p}`)
        if (!r) return null
        for (const [text, score] of r.spans) spans.push({ text, score, email: p })
    }
    spans.sort((a, b) => b.score - a.score)
    return { spans }
}

export function features(q, paths, texts) {
    const read = readOf(q, paths)
    if (!read) return null
    const evTexts = paths.map((p) => emails.emailOf(p) ?? "")
    const evAll = evTexts.join("\n")
    const qs = qaScores(read, texts, { K: 20 })
    const qs5 = qaScores(read, texts, { K: 5 })
    return texts.map((t, i) => ({
        ef: qs[i].ef, max: qs[i].max, top1: qs[i].top1, ef5: qs5[i].ef,
        lex: lexGround(q.question, t, evAll), prox: lexProx(q.question, t, evTexts),
        len: words(t).length, nnov: novel(q.question, t).length,
    }))
}
