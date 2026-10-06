// Worker m: x1 outcome by path (commit / commit-g5 / found / nofound) x stratum x YES truth,
// with stored gates / k3 correctness on the same questions, and AB location vs the explore list.
//   node benchmarks/premise2/explore2/tools/m-paths.js [sets...]
import { openAll } from "./a-lib.js"
const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["S300-2", "S300-1", "FULL-0"]
const { graded, bearing } = await openAll()
for (const set of sets) {
    const X = graded("x1@1+cold", set)
    const G = new Map(graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
    const K = new Map(graded("k3@1+cold", set).map((i) => [i.record.questionKey, i]))
    const t = {}
    for (const it of X) {
        const a = it.answer, ab = bearing(it.record)
        const checks = (a.log ?? []).filter((l) => l.act === "check")
        const yes = a.step?.startsWith("commit") ? checks.find((c) => c.yes) : null
        const tag = `${it.record.stratum} ${a.step}${yes ? (ab(yes.path) ? " trueYES" : " falseYES") : ""}`
        const c = (t[tag] ??= { n: 0, x1: 0, gates: 0, k3: 0, lp: [] })
        c.n++; c.x1 += it.correct; c.gates += G.get(it.record.questionKey)?.correct ?? 0; c.k3 += K.get(it.record.questionKey)?.correct ?? 0
    }
    console.log(`\n== ${set}`)
    for (const [k, c] of Object.entries(t).sort()) console.log(`  ${k.padEnd(34)} n ${String(c.n).padStart(3)}  x1 ${String(c.x1).padStart(3)}  gates ${String(c.gates).padStart(3)}  k3 ${String(c.k3).padStart(3)}`)
}
process.exit(0)
