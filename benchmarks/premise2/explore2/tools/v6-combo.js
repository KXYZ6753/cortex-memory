// v6 (aux, exploratory): are the QA reader (ef) and NLI (question + answer) complementary? On pool-A
// gates-vs-alternative discordant hit pairs: correlation of their margins and the AUC of a rank-sum.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { OUT, readCache } from "./v6-lib.js"
import { features } from "./v6-feat.js"
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const nli = readCache(join(OUT, "v6-nli.jsonl"))
const h = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16)
const rows = []
for (const q of pools.A) {
    if (q.stratum !== "hit") continue
    const par = q.cands.find((c) => c.text === q.parent)
    const nP = nli.get(`${q.key}|${h(q.evidence.join(","))}|${h(par.text)}`)
    for (const a of q.cands) {
        if (a.text === par.text || a.correct === par.correct) continue
        const nA = nli.get(`${q.key}|${h(q.evidence.join(","))}|${h(a.text)}`)
        const f = features(q, q.evidence, [par.text, a.text])
        if (!nA || !nP || !f) continue
        rows.push({ y: a.correct, ef: f[1].ef - f[0].ef, nqa: nA.qa - nP.qa })
    }
}
const rank = (k) => { const s = rows.map((r, i) => [r[k], i]).sort((a, b) => a[0] - b[0]); const out = Array(rows.length); s.forEach(([, i], r) => (out[i] = r / rows.length)); return out }
const rEf = rank("ef"), rN = rank("nqa")
rows.forEach((r, i) => (r.sum = rEf[i] + rN[i]))
const auc = (k) => { const p = rows.filter((r) => r.y).map((r) => r[k]), n = rows.filter((r) => !r.y).map((r) => r[k]); let w = 0; for (const a of p) for (const b of n) w += a > b ? 1 : a === b ? 0.5 : 0; return (w / (p.length * n.length)).toFixed(3) }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let c = 0, va = 0, vb = 0; a.forEach((x, i) => { c += (x - ma) * (b[i] - mb); va += (x - ma) ** 2; vb += (b[i] - mb) ** 2 }); return (c / Math.sqrt(va * vb)).toFixed(3) }
console.log(`pairs ${rows.length}: AUC ef ${auc("ef")}, nli(q+a) ${auc("nqa")}, rank-sum ${auc("sum")}; rank correlation of the two margins ${corr(rEf, rN)}`)
