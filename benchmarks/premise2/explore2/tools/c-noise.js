// Worker c: run-to-run noise of the gold-only base prompt: the same prompt (oracles'
// sandwich over the gold email) answered in different c-gold* runs (and the stored
// `oracles` variant if present). Text identity and verdict flips per pair of runs.
//   node .../c-noise.js <set> c-gold,c-gold2,...
import { latestAnswers } from "../../explore/grade.js"
import { pool, dataDir, verdictOf } from "./c-lib.js"
const [set, list] = process.argv.slice(2)
const runs = list.split(",")
const by = new Map(runs.map((r) => [r, new Map()]))
for (const a of latestAnswers(dataDir)) {
    if (a.set !== set || !by.has(a.variant)) continue
    const r = pool.byKey.get(a.questionKey)
    if (r.stratum !== "hit") continue
    const ans = a.renders?.base?.answer ?? a.answer
    by.get(a.variant).set(a.questionKey, { ans, v: verdictOf(r, ans) })
}
for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const A = by.get(runs[i]), B = by.get(runs[j])
    let n = 0, same = 0, plus = 0, minus = 0
    for (const [k, a] of A) { const b = B.get(k); if (!b) continue; n++; if (a.ans === b.ans) same++; if (a.v === 1 && b.v === 0) plus++; if (a.v === 0 && b.v === 1) minus++ }
    console.log(`${runs[i]} vs ${runs[j]}: ${n} hits, identical text ${same}, verdict ${runs[i]} right only ${plus}, ${runs[j]} right only ${minus}`)
}
