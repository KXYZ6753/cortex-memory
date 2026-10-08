// Worker a6: evaluate the gold-only multi-part harness (a6-gold renders, graded by
// tools/c-grade.js into the shared verdict store): accuracy per form, paired Δ vs base and
// vs the placebo (pad) with flips and bootstrap CIs (question and mailbox-cluster, mulberry32,
// B = 10,000), per set and pooled. Optional: FLIPS=<form> prints the changed verdicts.
//   node benchmarks/premise2/explore2/tools/a6-gold-eval.js [sets] [variant@version]
import { loadRuns, pool, verdictOf, bootHits } from "./a6-lib.js"

const sets = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3,S300-1,S300-2,S300-3,FULL-1,FULL-0").split(",")
const V = process.argv[3] ?? "a6-gold@1+cold"
const runs = loadRuns(sets, [V])
const rows = []
for (const [k, x] of runs.get(V)) {
    if (!x.a.renders) continue
    const r = pool.byKey.get(k)
    const v = {}
    for (const [form, ans] of Object.entries(x.a.renders)) v[form] = verdictOf(r, ans.answer, ans.status)
    rows.push({ k, set: x.set, user: r.user, v, a: x.a, r })
}
const forms = [...new Set(rows.flatMap((x) => Object.keys(x.v)))]
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "–")
const sg = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}`
const ungraded = rows.filter((x) => Object.values(x.v).some((c) => c === null)).length
console.log(`${V}: ${rows.length} multi-part hits with renders (${ungraded} with an ungraded form)`)
for (const set of [...sets, "pooled"]) {
    const R = set === "pooled" ? rows : rows.filter((x) => x.set === set)
    if (!R.length) continue
    const line = [`${set.padEnd(7)} n ${String(R.length).padStart(3)}`]
    for (const f of forms) {
        const l = R.filter((x) => x.v[f] != null)
        line.push(`${f} ${pct(l.filter((x) => x.v[f]).length, l.length)}`)
    }
    console.log(line.join(" | "))
}
console.log("\nPooled paired deltas (hit points):")
for (const ref of ["base", "pad"]) {
    if (!forms.includes(ref)) continue
    for (const f of forms.filter((f) => f !== ref)) {
        const P = rows.filter((x) => x.v[f] != null && x.v[ref] != null).map((x) => ({ a: x.v[f], b: x.v[ref], user: x.user }))
        const b = bootHits(P)
        console.log(`  ${f.padEnd(6)} vs ${ref.padEnd(4)}: ${sg(b.delta)} [${sg(b.low)}, ${sg(b.high)}] cluster [${sg(b.cLow)}, ${sg(b.cHigh)}] flips +${b.plus}/−${b.minus} (n ${b.n})`)
    }
}
const show = process.env.FLIPS
if (show) for (const x of rows) if (x.v[show] != null && x.v.base != null && x.v[show] !== x.v.base) {
    console.log(`\n[${x.v[show] > x.v.base ? "+" : "−"}] ${x.set} Q: ${x.r.question}\n   G: ${x.r.gold}\n   base: ${x.a.renders.base.answer.slice(0, 300)}\n   ${show}: ${x.a.renders[show].answer.slice(0, 400)}`)
}
