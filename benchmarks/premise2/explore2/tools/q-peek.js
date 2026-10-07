// Worker q: design checks from stored answers (no GPU).
// 1. d8's seeded email (dYesPath, matched from the probe prompt) vs the first YES path in x1's own
//    log (what q's wrapper seeds): must agree for q1 to reproduce d8 on the handover path.
// 2. Dev sets only: d8r's seeding flips vs x1 on handover questions, split by whether the first YES
//    is doubted (token logprob < -0.1), i.e. the questions where m2's recovery also runs.
//   node benchmarks/premise2/explore2/tools/q-peek.js
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const yes1Of = (a) => (a.log ?? []).find((l) => l.act === "check" && l.yes) ?? null
// 1
for (const [v, sets] of [["d8@1+cold", ["S300-4", "S300-5"]], ["d8r@1+cold", ["S300-1", "S300-2", "S300-3", "FULL-1"]]]) {
    let n = 0, same = 0, diff = []
    for (const s of sets) for (const it of graded(v, s)) {
        const a = it.answer
        if (!String(a.step ?? "").startsWith("commit-")) continue
        n++
        const y = yes1Of(a)?.path ?? null
        if (y === (a.dYesPath ?? null)) same++
        else diff.push([s, it.record.questionKey, y, a.dYesPath])
    }
    console.log(`${v}: handover answers ${n}, dYesPath == x1 log first YES: ${same}`, diff.slice(0, 5))
}
// 2 (dev only)
const dev = ["S300-1", "S300-2", "S300-3", "FULL-1"]
const tab = {}
for (const s of dev) {
    const X = new Map(graded("x1@1+cold", s).map((i) => [i.record.questionKey, i]))
    for (const it of graded("d8r@1+cold", s)) {
        const a = it.answer, x = X.get(it.record.questionKey)
        if (!x || it.correct === null || x.correct === null || a.replay) continue
        if (!String(a.step ?? "").startsWith("commit-") || !String(x.answer.step ?? "").startsWith("commit-")) continue
        const lp = yes1Of(a)?.yesLp ?? -9
        const k = `${it.record.stratum} ${lp < -0.1 ? "doubted yes1" : "sure yes1"} seeded=${a.dG5Seeded ? 1 : 0}`
        const t = (tab[k] ??= { n: 0, plus: 0, minus: 0, same: 0 })
        t.n++; t.plus += it.correct > x.correct; t.minus += it.correct < x.correct; t.same += a.answer === x.answer.answer
    }
}
console.log("dev d8r vs x1 on handover questions (both took the handover):")
for (const [k, t] of Object.entries(tab).sort()) console.log(`  ${k}: n ${t.n}, +${t.plus}/-${t.minus}, same text ${t.same}`)
process.exit(0)
