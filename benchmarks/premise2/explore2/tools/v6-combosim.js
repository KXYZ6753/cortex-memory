// v6 (aux, exploratory): policy with QA + NLI combined, pool A hits. Combined margin = ef margin / sd +
// NLI(q+a) margin / sd (sds over all discordant gates-vs-alternative hit pairs). Alternatives: t2 | o4.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { OUT, readCache, bootDelta, fmt } from "./v6-lib.js"
import { features } from "./v6-feat.js"
const alt = process.argv[2] ?? "t2"
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const nli = readCache(join(OUT, "v6-nli.jsonl"))
const h = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16)
const rows = []
for (const q of pools.A) {
    if (q.stratum !== "hit") continue
    const par = q.cands.find((c) => c.text === q.parent)
    const a = alt === "t2" ? (q.t2 !== null ? q.cands.find((c) => c.text === q.t2) : null) : q.cands.find((c) => c.sources.includes(alt))
    if (!a) continue
    const row = { set: q.set, user: q.user, stratum: "hit", pc: par.correct, ac: a.correct, m: null }
    if (a.text !== par.text && a.correct !== par.correct) {
        const ek = (t) => `${q.key}|${h(q.evidence.join(","))}|${h(t)}`
        const f = features(q, q.evidence, [par.text, a.text])
        const nP = nli.get(ek(par.text)), nA = nli.get(ek(a.text))
        if (f && nP && nA) row.m = { ef: f[1].ef - f[0].ef, nqa: nA.qa - nP.qa }
    }
    rows.push(row)
}
const d = rows.filter((r) => r.m)
const sd = (k) => { const v = d.map((r) => r.m[k]); const mu = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length) }
const sE = sd("ef"), sN = sd("nqa")
console.log(`alt ${alt}: hits ${rows.length}, discordant scored ${d.length} (alt right ${d.filter((r) => r.ac).length}); sd ef ${sE.toFixed(3)} nli ${sN.toFixed(3)}`)
for (const [label, score] of [["ef", (m) => m.ef / sE], ["nli q+a", (m) => m.nqa / sN], ["ef + nli", (m) => m.ef / sE + m.nqa / sN]]) {
    for (const thr of [0, 0.5, 1, 1.5, 2]) {
        let fx = 0, br = 0
        const items = rows.map((r) => { let x = 0; if (r.m && score(r.m) > thr) { x = r.ac - r.pc; if (x > 0) fx++; if (x < 0) br++ } return { stratum: "hit", user: r.user, d: x } })
        console.log(`  ${label.padEnd(9)} > ${thr} sd: hits ${fmt(bootDelta(items, 0.068, { hitOnly: true }))} +${fx}/-${br}`)
    }
}
// leave-one-set-out threshold choice for the combined score (thresholds 0, 0.5, 1, 1.5, 2 sd)
{
    const comb = (m) => m.ef / sE + m.nqa / sN
    const TH = [0, 0.5, 1, 1.5, 2]
    const sets = [...new Set(rows.map((r) => r.set))]
    const items = [], chosen = []
    let fx = 0, br = 0
    for (const s of sets) {
        const train = rows.filter((r) => r.set !== s)
        let bt = TH[0], bv = -Infinity
        for (const t of TH) { const v = train.reduce((a, r) => a + (r.m && comb(r.m) > t ? r.ac - r.pc : 0), 0); if (v > bv) { bv = v; bt = t } }
        chosen.push(`${s}:${bt}`)
        for (const r of rows.filter((x) => x.set === s)) { let x = 0; if (r.m && comb(r.m) > bt) { x = r.ac - r.pc; if (x > 0) fx++; if (x < 0) br++ } items.push({ stratum: "hit", user: r.user, d: x }) }
    }
    console.log(`  LOSO combined (${chosen.join(" ")}): hits ${fmt(bootDelta(items, 0.068, { hitOnly: true }))} cluster ${fmt(bootDelta(items, 0.068, { hitOnly: true, cluster: true }))} +${fx}/-${br}`)
}
