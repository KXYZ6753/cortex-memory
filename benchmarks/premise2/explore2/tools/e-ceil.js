// e: offline ceilings, pairwise agreement, similarity calibration.
// node benchmarks/premise2/explore2/tools/e-ceil.js S300-2
import { table, sim, W, fmt } from "./e-lib.js"
const set = process.argv[2] ?? "S300-2"
const COMMON = ["gates@1+cold", "x1@1+cold", "k3@1+cold", "k1@1+cold", "g5@1+cold", "g2@2+cold", "g6@1+cold", "n-g5@1+cold", "p2@1+cold", "p3@1+cold", "r4@1+cold", "r5@1+cold", "h4@1+cold", "o4@1+cold", "o12@1+cold", "x2@1+cold", "x3@1+cold"]
const EXTRA = set === "S300-2" ? ["s1@1+cold", "s3@1+cold", "a5@1+cold", "w7@1+cold", "n-cr1@1+cold", "n-cs2@1+cold"] : []
const T = table(set, [...COMMON, ...EXTRA])
const names = [...T.keys()]
const keys = [...T.get("gates").keys()].filter((k) => names.every((n) => T.get(n).has(k)))
const rec = (k) => T.get("gates").get(k).record
console.log(`${set}: ${keys.length} questions with all ${names.length} systems`)
const score = (f) => W(keys.map((k) => ({ record: rec(k), correct: f(k) })))
for (const n of names) console.log(n.padEnd(8), fmt(score((k) => T.get(n).get(k).correct)))
const oracle = (group) => score((k) => (group.some((n) => T.get(n).get(k).correct) ? 1 : 0))
console.log("\nOracle any-right:")
for (const g of [["gates", "x1"], ["x1", "k3"], ["x1", "g5"], ["x1", "p3"], ["x1", "h4"], ["gates", "k3"], ["gates", "g5"], ["k3", "g5"], ["x1", "k3", "g5"], ["x1", "h4", "g5"], ["x1", "p3", "g5"], ["gates", "k3", "g5"], names])
    console.log(g.length > 6 ? `all ${g.length}` : g.join("+"), fmt(oracle(g)))
// greedy oracle
let chosen = ["x1"]
for (let i = 0; i < 4; i++) {
    let best = null
    for (const n of names) if (!chosen.includes(n)) { const s = oracle([...chosen, n]); if (!best || s.weighted > best[1].weighted) best = [n, s] }
    chosen.push(best[0]); console.log("greedy", chosen.join("+"), fmt(best[1]))
}
// similarity calibration: P(same verdict | sim bucket)
console.log("\nsim calibration (all pairs): bucket  n  P(same verdict)  P(both right | same-ish)")
const buckets = [0, 0.001, 0.2, 0.4, 0.6, 0.8, 0.999, 1.01]
const cnt = buckets.map(() => [0, 0, 0])
for (const k of keys) for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = T.get(names[i]).get(k), b = T.get(names[j]).get(k)
    const s = sim(a.text, b.text, rec(k).question)
    const bi = buckets.findIndex((x, ix) => s >= x && s < buckets[ix + 1])
    cnt[bi][0]++; if (a.correct === b.correct) cnt[bi][1]++; if (a.correct && b.correct) cnt[bi][2]++
}
cnt.forEach((c, i) => i < buckets.length - 1 && c[0] && console.log(`[${buckets[i]}, ${buckets[i + 1]})`.padEnd(14), String(c[0]).padStart(6), (c[1] / c[0]).toFixed(3), (c[2] / c[0]).toFixed(3)))
// pairwise agreement (sim >= .5) for main systems
const MAIN = ["gates", "x1", "k3", "g5", "p3", "h4", "n-g5", "r5", "o4"]
console.log("\npairwise: agree% | acc(agree) | when disagree: accA accB (weighted)  — threshold .5")
for (let i = 0; i < MAIN.length; i++) for (let j = i + 1; j < MAIN.length; j++) {
    const A = T.get(MAIN[i]), B = T.get(MAIN[j])
    const ag = keys.filter((k) => sim(A.get(k).text, B.get(k).text, rec(k).question) >= 0.5)
    const dis = keys.filter((k) => !ag.includes(k))
    const sA = W(ag.map((k) => ({ record: rec(k), correct: A.get(k).correct })))
    const dA = W(dis.map((k) => ({ record: rec(k), correct: A.get(k).correct }))), dB = W(dis.map((k) => ({ record: rec(k), correct: B.get(k).correct })))
    const any = W(dis.map((k) => ({ record: rec(k), correct: A.get(k).correct || B.get(k).correct ? 1 : 0 })))
    console.log(`${MAIN[i]}~${MAIN[j]}`.padEnd(12), `agree ${ag.length}`.padEnd(10), `acc ${(100 * sA.weighted).toFixed(1)}`, `| dis ${dis.length}: ${(100 * dA.weighted).toFixed(1)} vs ${(100 * dB.weighted).toFixed(1)} any ${(100 * any.weighted).toFixed(1)}`)
}
