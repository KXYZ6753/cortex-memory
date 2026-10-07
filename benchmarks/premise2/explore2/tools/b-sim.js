// Worker b: offline simulation of "demos only on unsure answers" (b-gu*) from stored runs:
// gates' answer where gates' own first answer is confident (n-lp0's logprob trace of the
// same prompt: mean token logprob >= tau, no hedge), the demo variant's answer otherwise.
// Also splits the demo variant's flips vs gates by gates' confidence.
//   node benchmarks/premise2/explore2/tools/b-sim.js <demoVariant> <set,set> [tau=-0.1]
import { pairedBootstrap } from "../../explore/analyze.js"
import { pool, loadTable, missShare } from "./b-lib.js"
import { HEDGE } from "../variants/n-conf.js"
import { isAbstain } from "../../prompts.js"

const [D, setsArg, tauArg = "-0.1"] = process.argv.slice(2)
const tau = Number(tauArg)
const mean = (xs) => (xs?.length ? xs.reduce((s, v) => s + v, 0) / xs.length : -Infinity)
const f1 = (x) => (100 * x).toFixed(1)
const pairs = []
const bins = new Map()
for (const setName of setsArg.split(",")) {
    const { table, keys } = loadTable(setName, [D, "gates", "n-lp0"])
    const d = table.get(D), g = table.get("gates"), n = table.get("n-lp0")
    if (!d || !g || !n) { console.log(`${setName}: missing ${!d ? D : !g ? "gates" : "n-lp0"}`); continue }
    for (const key of keys) {
        const r = pool.byKey.get(key)
        const x = d.get(key), y = g.get(key), z = n.get(key)
        if (!x || !y || !z || x.correct === null || y.correct === null) continue
        const lp = z.a.lp?.gates
        const m = mean(lp?.lps)
        const unsure = !isAbstain(lp?.answer ?? "") && (HEDGE.test(lp?.answer ?? "") || m < tau)
        const sim = unsure ? x.correct : y.correct
        pairs.push({ user: r.user, stratum: r.stratum, a: sim, b: y.correct, demo: x.correct, unsure, sameLp: (lp?.answer ?? "").trim() === y.answer.trim() })
        const bin = m >= -0.05 ? "lp >= -0.05" : m >= -0.1 ? "-0.1..-0.05" : m >= -0.2 ? "-0.2..-0.1" : "< -0.2"
        const k = `${r.stratum} ${bin}`
        if (!bins.has(k)) bins.set(k, { n: 0, up: 0, down: 0, g: 0 })
        const b = bins.get(k); b.n++; b.g += y.correct; if (x.correct > y.correct) b.up++; if (x.correct < y.correct) b.down++
    }
}
console.log(`${D} vs gates, by gates' first-answer confidence (n-lp0 trace; texts equal to gates' answer in ${pairs.filter((p) => p.sameLp).length}/${pairs.length})`)
for (const [k, b] of [...bins].sort()) console.log(`  ${k.padEnd(22)} n ${String(b.n).padStart(4)}  gates ${f1(b.g / b.n)}%  demo flips +${b.up}/-${b.down}`)
const bs = pairedBootstrap(pairs, missShare)
const u = pairs.filter((p) => p.unsure)
console.log(`simulated b-gu (tau ${tau}): unsure ${u.length}/${pairs.length}; Δ vs gates ${bs.weighted >= 0 ? "+" : ""}${f1(bs.weighted)} [${f1(bs.low)}, ${f1(bs.high)}]; hit flips +${u.filter((p) => p.stratum === "hit" && p.a > p.b).length}/-${u.filter((p) => p.stratum === "hit" && p.a < p.b).length}, miss flips +${u.filter((p) => p.stratum === "miss" && p.a > p.b).length}/-${u.filter((p) => p.stratum === "miss" && p.a < p.b).length}`)
