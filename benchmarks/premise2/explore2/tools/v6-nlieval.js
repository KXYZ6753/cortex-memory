// v6 (aux): NLI cross-encoder vs QA vs lexical on the same mixed questions (pool A or B, hits).
// Pairwise accuracy (all (right, wrong) pairs, and hard pairs with both answers >= 80% grounded) and,
// for pool A, the AUC on gates-vs-alternative discordant pairs.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { OUT, readCache, bootPairwise } from "./v6-lib.js"
import { features } from "./v6-feat.js"

const poolName = process.argv[2] ?? "A"
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const nli = readCache(join(OUT, "v6-nli.jsonl"))
const h = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16)
const key = (q, paths, text) => `${q.key}|${h(paths.join(","))}|${h(text)}`
const KS = ["nA", "nQA", "nAE", "nQAE", "ef", "prox", "lex"]
const res = {}, hard = {}, disc = []
let nq = 0
for (const q of pools[poolName]) {
    if (q.stratum !== "hit") continue
    const right = q.cands.filter((c) => c.correct), wrong = q.cands.filter((c) => !c.correct)
    if (!right.length || !wrong.length) continue
    const texts = q.cands.map((c) => c.text)
    const n = texts.map((t) => nli.get(key(q, q.evidence, t)))
    if (n.some((x) => !x)) continue
    const f = features(q, q.evidence, texts)
    if (!f) continue
    nq++
    const F = texts.map((t, i) => ({ nA: n[i].a, nQA: n[i].qa, nAE: n[i].aE, nQAE: n[i].qaE, ef: f[i].ef, prox: f[i].prox, lex: f[i].lex }))
    const idx = new Map(texts.map((t, i) => [t, i]))
    for (const k of KS) {
        let w = 0, c = 0, wh = 0, ch = 0
        for (const r of right) for (const x of wrong) {
            const a = F[idx.get(r.text)][k], b = F[idx.get(x.text)][k]
            const win = a > b ? 1 : a === b ? 0.5 : 0
            w += win; c++
            if (f[idx.get(r.text)].lex >= 0.8 && f[idx.get(x.text)].lex >= 0.8) { wh += win; ch++ }
        }
        ;(res[k] ??= []).push({ wins: w, n: c })
        if (ch) (hard[k] ??= []).push({ wins: wh, n: ch })
    }
    if (poolName === "A") {
        const pi = idx.get(q.parent), pc = q.cands[pi].correct
        q.cands.forEach((c, i) => { if (i !== pi && c.correct !== pc) disc.push({ altRight: c.correct, d: Object.fromEntries(KS.map((k) => [k, F[i][k] - F[pi][k]])) }) })
    }
}
console.log(`pool ${poolName} hits with NLI scores: ${nq} questions`)
for (const k of KS) {
    const a = bootPairwise(res[k]), b = hard[k] ? bootPairwise(hard[k]) : null
    let au = ""
    if (disc.length) {
        const pos = disc.filter((r) => r.altRight).map((r) => r.d[k]), neg = disc.filter((r) => !r.altRight).map((r) => r.d[k])
        let w = 0
        for (const p of pos) for (const x of neg) w += p > x ? 1 : p === x ? 0.5 : 0
        au = ` | AUC alt-vs-gates ${(w / (pos.length * neg.length)).toFixed(3)} (${disc.length} pairs)`
    }
    console.log(`${k.padEnd(5)} pairwise ${a.point.toFixed(1)} [${a.lo.toFixed(1)}, ${a.hi.toFixed(1)}] | hard ${b ? `${b.point.toFixed(1)} [${b.lo.toFixed(1)}, ${b.hi.toFixed(1)}]` : "-"}${au}`)
}
