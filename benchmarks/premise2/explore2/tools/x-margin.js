// Worker x: YES-token margin as the doubt signal (hypothesis 2, literal form), simulated
// from x1's logged probe logprobs + stored k3 / g5 answers.
// node benchmarks/premise2/explore2/tools/x-margin.js [set]
import { openAll, weightedOf } from "./a-lib.js"
const { graded, missShare, bearing } = await openAll()
const sets = process.argv[2] ? [process.argv[2]] : ["S300-2", "S300-1"]
for (const set of sets) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const X = load("x1@1+cold"), K = load("k3@1+cold"), A = load("g5@1+cold"), G = load("gates@1+cold")
    if (!X.size) { console.log(set, "no x1"); continue }
    const rows = []
    for (const [key, x] of X) {
        const k = K.get(key), a = A.get(key), g = G.get(key)
        const log = x.answer.log ?? []
        const yes = log.find((l) => l.act === "check" && l.yes)
        const committed = x.answer.yesAt >= 0 && x.answer.yesAt !== undefined
        const margin = yes ? (yes.yesLp ?? 0) - (yes.noLp ?? -20) : null
        rows.push({ record: x.record, x: x.correct, k: k?.correct, a: a?.correct, g: g?.correct, committed, unsure: !!x.answer.unsure, yesLp: yes?.yesLp, margin, yesAB: yes ? bearing(x.record)(yes.path) : null, step: x.answer.step })
    }
    const W = (f) => 100 * weightedOf(rows.map((r) => ({ record: r.record, correct: f(r) ?? 0 })), missShare).weighted
    const base = W((r) => r.g)
    console.log(`\n== ${set}: gates ${base.toFixed(1)}  x1(real) ${W((r) => r.x).toFixed(1)}  k3 ${W((r) => r.k).toFixed(1)}  g5 ${W((r) => r.a).toFixed(1)}`)
    // reproduction: committed & sure -> x1 == k3 ?
    const csure = rows.filter((r) => r.committed && !r.unsure)
    console.log(`committed&sure ${csure.length}: x1 ok ${csure.reduce((s, r) => s + r.x, 0)} vs k3 ${csure.reduce((s, r) => s + r.k, 0)}; committed&unsure ${rows.filter((r) => r.committed && r.unsure).length}`)
    // margin distribution by YES correctness
    const q = (l) => { const s = l.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b); return s.length ? [0.1, 0.25, 0.5].map((p) => s[Math.floor(p * (s.length - 1))].toFixed(2)).join("/") : "-" }
    for (const st of ["hit", "miss"]) for (const t of [true, false]) {
        const l = rows.filter((r) => r.committed && r.record.stratum === st && r.yesAB === t)
        console.log(`  ${st} YES-on-AB=${t}: n ${l.length}, yesLp p10/p25/p50 ${q(l.map((r) => r.yesLp))}`)
    }
    for (const m of [-0.01, -0.05, -0.1, -0.2, -0.4, -0.7]) {
        const doubtM = (r) => r.committed && (r.yesLp ?? 0) < m
        const f1 = (r) => (doubtM(r) ? r.a : r.k)                       // margin only
        const f2 = (r) => (r.committed && (r.unsure || (r.yesLp ?? 0) < m) ? r.a : r.k) // margin or answer-lp
        const f3 = (r) => (r.committed && r.unsure && (r.yesLp ?? 0) < m ? r.a : r.k)   // both
        console.log(`  yesLp<${m}: fires ${rows.filter(doubtM).length}  margin-only ${(W(f1) - base).toFixed(1)}  or-unsure ${(W(f2) - base).toFixed(1)}  and-unsure ${(W(f3) - base).toFixed(1)}`)
    }
}
process.exit(0)
