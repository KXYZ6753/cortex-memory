// Offline (p): logistic trigger for the swap on non-switched questions (rows from
// p-trigger.js --dump). 5-fold CV by mailbox-free random split; target = miss stratum
// (the global five lack the answer). Compares the hit-fire / miss-gain frontier with
// the single CE-margin rule (r4 = b1 - gmax > -1).
//   node benchmarks/premise2/explore2/tools/p-logit.js

import { join } from "node:path"
import { SCRATCH, readJsonIf } from "./r-common.js"

const rows = readJsonIf(join(SCRATCH, "p-trigger-rows.json"), [])
const feats = (r) => [1, r.b1 - r.gmax, r.b1 - r.g1, r.gmax, r.g1, r.b2 - r.gmax, Math.log1p(Math.abs(r.s1)), (r.s1 - r.s2) / (Math.abs(r.s1) || 1), r.h1, r.hb1 - r.h1]
const X = rows.map(feats)
const mu = X[0].map((_, j) => (j === 0 ? 0 : X.reduce((s, x) => s + x[j], 0) / X.length))
const sd = X[0].map((_, j) => (j === 0 ? 1 : Math.sqrt(X.reduce((s, x) => s + (x[j] - mu[j]) ** 2, 0) / X.length) || 1))
const Z = X.map((x) => x.map((v, j) => (j === 0 ? 1 : (v - mu[j]) / sd[j])))
const y = rows.map((r) => (r.stratum === "miss" ? 1 : 0))
function fit(idx) {
    let w = Array(Z[0].length).fill(0)
    for (let it = 0; it < 400; it++) {
        const g = Array(w.length).fill(0)
        for (const i of idx) { const p = 1 / (1 + Math.exp(-w.reduce((s, wj, j) => s + wj * Z[i][j], 0))); for (let j = 0; j < w.length; j++) g[j] += (p - y[i]) * Z[i][j] }
        w = w.map((wj, j) => wj - 0.5 * (g[j] / idx.length + 0.01 * (j ? wj : 0)))
    }
    return w
}
let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const fold = rows.map(() => Math.floor(rand() * 5))
const score = Array(rows.length)
for (let f = 0; f < 5; f++) {
    const w = fit(rows.map((_, i) => i).filter((i) => fold[i] !== f))
    rows.forEach((_, i) => { if (fold[i] === f) score[i] = w.reduce((s, wj, j) => s + wj * Z[i][j], 0) })
}
const wAll = fit(rows.map((_, i) => i))
console.log("mu", JSON.stringify(mu.map((v) => +v.toFixed(4))), "sd", JSON.stringify(sd.map((v) => +v.toFixed(4))), "w", JSON.stringify(wAll.map((v) => +v.toFixed(4))))
console.log("weights (std features: 1, b1-gmax, b1-g1, gmax, g1, b2-gmax, log s1, bm25 gap, h1, hb1-h1):", wAll.map((v) => v.toFixed(2)).join(" "))
const hits = rows.filter((r) => r.stratum === "hit").length
console.log("| rule | hit fires | miss gains (b1 AB) | miss gains b1|b2 |")
console.log("|---|---|---|---|")
for (const t of [-2, -1.5, -1, -0.5, 0, 0.5, 1]) {
    const fired = rows.filter((_, i) => score[i] > t)
    console.log(`| logit>${t} | ${fired.filter((r) => r.stratum === "hit").length} (${(100 * fired.filter((r) => r.stratum === "hit").length / hits).toFixed(1)}%) | ${fired.filter((r) => r.stratum === "miss" && r.b1ab).length} | ${fired.filter((r) => r.stratum === "miss" && (r.b1ab || r.b2ab)).length} |`)
}
