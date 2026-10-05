// Worker x: tau sweep + paired bootstrap for "k3 commit; commit & unsure -> g5" (x1 sim).
import { openAll, weightedOf } from "./a-lib.js"
import { HEDGE } from "../variants/n-conf.js"
import { isAbstain } from "../../prompts.js"
const { graded, missShare } = await openAll()
const all = []
for (const set of ["S300-2", "S300-1"]) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const G = load("gates@1+cold"), K = load("k3@1+cold"), A = load("g5@1+cold"), N = load("n-g5@1+cold")
    for (const [key, k] of K) {
        const n = N.get(key).answer
        const flagged = isAbstain(n.gatesAnswer) || HEDGE.test(n.gatesAnswer ?? "")
        all.push({ set, record: k.record, g: G.get(key).correct, k: k.correct, a: A.get(key).correct, commit: k.answer.step === "commit", mean: n.firstMean, flagged })
    }
}
const pol = (tau) => (r) => (r.commit && (r.flagged || r.mean < tau) ? r.a : r.k)
const W = (rows, f) => weightedOf(rows.map((r) => ({ record: r.record, correct: f(r) })), missShare).weighted * 100
for (const tau of [-0.05, -0.08, -0.1, -0.13, -0.16, -0.2, -0.3]) {
    const line = ["S300-2", "S300-1"].map((s) => { const rows = all.filter((r) => r.set === s); return `${s} ${(W(rows, pol(tau)) - W(rows, (r) => r.g)).toFixed(1)} (vs k3 ${(W(rows, pol(tau)) - W(rows, (r) => r.k)).toFixed(1)}, fires ${rows.filter((r) => r.commit && (r.flagged || r.mean < tau)).length})` })
    console.log(`tau ${tau}: ${line.join("  ")}`)
}
// paired bootstrap pooled, tau -0.1 (stratified by set+stratum)
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const groups = {}; for (const r of all) (groups[`${r.set}/${r.record.stratum}`] ??= []).push(r)
const f = pol(-0.1)
for (const [name, base] of [["gates", (r) => r.g], ["k3", (r) => r.k]]) {
    const ds = []
    for (let b = 0; b < 4000; b++) {
        const sample = Object.values(groups).flatMap((g) => g.map(() => g[Math.floor(rnd() * g.length)]))
        const per = ["S300-2", "S300-1"].map((s) => { const rows = sample.filter((r) => r.set === s); return W(rows, f) - W(rows, base) })
        ds.push((per[0] + per[1]) / 2)
    }
    ds.sort((a, b) => a - b)
    const pt = ["S300-2", "S300-1"].map((s) => { const rows = all.filter((r) => r.set === s); return W(rows, f) - W(rows, base) })
    console.log(`pooled vs ${name}: ${((pt[0] + pt[1]) / 2).toFixed(2)} [${ds[100].toFixed(2)}, ${ds[3900].toFixed(2)}]`)
}
process.exit(0)
