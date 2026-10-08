// v6 (aux): is the QA expected-cover signal just answer length? Pairwise accuracy of ef within
// length buckets (right answer shorter / similar / longer than the wrong one), pool A or B, hits.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OUT, bootPairwise } from "./v6-lib.js"
import { features } from "./v6-feat.js"
const poolName = process.argv[2] ?? "A"
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const buckets = {}
for (const q of pools[poolName]) {
    if (q.stratum !== "hit") continue
    const right = q.cands.filter((c) => c.correct), wrong = q.cands.filter((c) => !c.correct)
    if (!right.length || !wrong.length) continue
    const texts = q.cands.map((c) => c.text)
    const f = features(q, q.evidence, texts)
    if (!f) continue
    const idx = new Map(texts.map((t, i) => [t, i]))
    const per = {}
    for (const r of right) for (const x of wrong) {
        const a = f[idx.get(r.text)], b = f[idx.get(x.text)]
        const ratio = a.len / Math.max(1, b.len)
        const k = ratio < 0.8 ? "right shorter (<0.8x)" : ratio > 1.25 ? "right longer (>1.25x)" : "similar length"
        per[k] ??= { wins: 0, n: 0, lw: 0 }
        per[k].wins += a.ef > b.ef ? 1 : a.ef === b.ef ? 0.5 : 0
        per[k].n++
    }
    for (const [k, v] of Object.entries(per)) (buckets[k] ??= []).push(v)
}
for (const [k, l] of Object.entries(buckets)) {
    const ci = bootPairwise(l)
    console.log(`${k.padEnd(24)} pairs ${l.reduce((s, x) => s + x.n, 0)} (${l.length} q): ef pairwise ${ci.point.toFixed(1)} [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]`)
}
