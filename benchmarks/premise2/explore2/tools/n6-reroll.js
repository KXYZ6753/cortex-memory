// Worker n6: does ANY re-roll of gates' answer help on unsure hits? Splits another worker's
// det re-roll arm (e.g. p6's same-token placebo p6-eperm, which re-rolls every answer) against
// det gates by the greedy confidence of gates' own answer (mean token logprob logged by an n6
// run on the same questions; the n6 greedy text equals det gates' answer). Offline, no GPU.
//   node benchmarks/premise2/explore2/tools/n6-reroll.js <arm@ver> <set,set> [n6 variant@ver] [tau]
import { openN6, hitDelta, fmtD } from "./n6-lib.js"
const [arm, setsArg, n6v = "n6-g-pbo@1+cold", tauArg = "-0.1"] = process.argv.slice(2)
const tau = Number(tauArg)
const { graded } = await openN6()
const groups = { unsure: [], sure: [] }
for (const s of setsArg.split(",")) {
    const P = new Map(graded("i-det-gates@2+cold", s).map((i) => [i.record.questionKey, i]))
    const N = new Map(graded(n6v, s).map((i) => [i.record.questionKey, i]))
    for (const a of graded(arm, s)) {
        const p = P.get(a.record.questionKey), n = N.get(a.record.questionKey)
        if (a.record.stratum !== "hit" || !p || !n?.answer.n6 || a.correct == null || p.correct == null) continue
        const mean = n.answer.n6.info[0].mean
        groups[mean < tau ? "unsure" : "sure"].push({ user: a.record.user, d: a.correct - p.correct, changed: a.answer.answer.trim() !== p.answer.answer.trim() })
    }
}
console.log(`${arm} vs i-det-gates on hits, split by gates' greedy mean token logprob (tau ${tau}, from ${n6v})`)
for (const [k, g] of Object.entries(groups)) console.log(`  ${k.padEnd(6)} texts changed ${g.filter((x) => x.changed).length}/${g.length}  Δ ${fmtD(hitDelta(g))}`)
process.exit(0)
