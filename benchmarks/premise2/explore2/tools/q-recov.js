// Worker q: what m2's recovery and d8's seed did on each question where they changed the
// answer (stack vs det x1): stratum, route, whether yes1 / E / the seed is answer-bearing
// (gold, twin or EvidenceCache AB), verdicts, answers.
//   node benchmarks/premise2/explore2/tools/q-recov.js <set,set> [variant@ver] [--ref i-det-x1@2+cold]
import { openAll } from "./a-lib.js"
const args = process.argv.slice(2)
const sets = args[0].split(",")
const v = args[1] && !args[1].startsWith("--") ? args[1] : "q-det-q1@1+cold"
const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "i-det-x1@2+cold"
const { graded, bearing } = await openAll()
const tally = {}
for (const s of sets) {
    const R = new Map(graded(ref, s).map((i) => [i.record.questionKey, i]))
    for (const it of graded(v, s)) {
        const a = it.answer, r = R.get(it.record.questionKey)
        if (!r || it.correct === null || r.correct === null) continue
        const isAB = bearing(it.record)
        const yes1 = (a.log ?? []).find((l) => l.act === "check" && l.yes)?.path
        const step = String(a.step)
        let kind = null
        if (step.startsWith("recover")) kind = `m2 ${step}`
        else if (step === "commit-g5" && JSON.stringify(a.shownPaths) !== JSON.stringify(r.answer.shownPaths)) kind = "seeded g5 (changed)"
        else if (["found", "nofound", "nopick"].includes(step) && a.answer !== r.answer.answer) kind = "explore (text changed)"
        if (!kind) continue
        const k = `${it.record.stratum} ${kind}`
        const t = (tally[k] ??= { n: 0, plus: 0, minus: 0, yes1AB: 0, eAB: 0, inCtxAB: 0, refCtxAB: 0 })
        t.n++; t.plus += it.correct > r.correct; t.minus += it.correct < r.correct
        t.yes1AB += yes1 ? isAB(yes1) : 0
        t.eAB += a.q?.recovered ? isAB(a.q.recovered) : 0
        t.inCtxAB += (a.readPaths ?? a.contextPaths ?? []).some(isAB)
        t.refCtxAB += (r.answer.readPaths ?? r.answer.contextPaths ?? []).some(isAB)
        if (it.correct !== r.correct) console.log(`${s} ${k} ${it.correct > r.correct ? "+" : "-"} yes1AB=${yes1 ? isAB(yes1) : "-"} E_AB=${a.q?.recovered ? isAB(a.q.recovered) : "-"} | ${it.record.question.slice(0, 90)}\n    gold: ${String(it.record.gold).slice(0, 90)}\n    q: ${String(a.answer).slice(0, 110)}\n    x: ${String(r.answer.answer).slice(0, 110)}`)
    }
}
console.log("\n| stratum, mechanism | n | + / − | yes1 AB | E AB | AB in final ctx (stack / det x1) |\n|---|---|---|---|---|---|")
for (const [k, t] of Object.entries(tally).sort()) console.log(`| ${k} | ${t.n} | +${t.plus}/−${t.minus} | ${t.yes1AB} | ${t.eAB} | ${t.inCtxAB} / ${t.refCtxAB} |`)
process.exit(0)
