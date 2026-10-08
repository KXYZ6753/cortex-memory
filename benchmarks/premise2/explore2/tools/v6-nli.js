// v6 (aux): NLI cross-encoder (DeBERTa-v3-base MNLI/FEVER/ANLI, int8, CPU) scores for the candidates
// of mixed pool questions. Premise = evidence email chunks (320 tokens); per candidate the 3 chunks
// with the most overlap with question + candidate words; hypothesis forms: "a" = the candidate answer
// (e2b's answers are usually full sentences), "qa" = question + " " + answer. Score per form = max
// over the chunks of logit(entailment) - logit(contradiction). Cache: v6-nli.jsonl.
//   node v6-nli.js <A|B> [limit] [hitsOnly]
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { OUT, readCache, appendCache } from "./v6-lib.js"
import { emails } from "./v6-feat.js"
import { loadNLI, words, content } from "../variants/v6-common.js"

const [poolName = "A", limitArg, hitsOnly] = process.argv.slice(2)
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const file = join(OUT, "v6-nli.jsonl")
const cache = readCache(file)
const nli = await loadNLI()
const h = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16)
export const nliKey = (q, paths, text) => `${q.key}|${h(paths.join(","))}|${h(text)}`
let qs = pools[poolName].filter((q) => q.cands.some((c) => c.correct) && q.cands.some((c) => !c.correct))
if (hitsOnly) qs = qs.filter((q) => q.stratum === "hit")
qs = qs.slice(0, limitArg ? Number(limitArg) : Infinity)
const t0 = performance.now()
let n = 0, pairs = 0
for (const q of qs) {
    const paths = q.evidence
    const chunks = nli.chunks(paths.map((p) => emails.emailOf(p) ?? ""))
    const chunkWords = chunks.map((c) => new Set(words(c)))
    for (const c of q.cands) {
        const k = nliKey(q, paths, c.text)
        if (cache.has(k)) continue
        const target = [...new Set([...content(q.question), ...content(c.text)])]
        const ranked = chunks.map((ch, i) => ({ ch, s: target.filter((w) => chunkWords[i].has(w)).length })).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.ch)
        const [ra, rqa] = [await nli.score(ranked, [c.text]), await nli.score(ranked, [`${q.question} ${c.text}`])]
        const rec = { k, a: ra[0].margin, aE: ra[0].logpE, qa: rqa[0].margin, qaE: rqa[0].logpE }
        appendCache(file, rec)
        cache.set(k, rec)
        pairs += 2 * ranked.length
    }
    if (++n % 20 === 0) console.log(`${n}/${qs.length} q, ${pairs} pairs, ${((performance.now() - t0) / Math.max(1, pairs)).toFixed(0)} ms/pair, ${((performance.now() - t0) / 1000).toFixed(0)} s`)
}
console.log(`done ${n} q, ${pairs} pairs`)
