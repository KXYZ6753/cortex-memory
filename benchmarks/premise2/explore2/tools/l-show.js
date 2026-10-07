// Worker l: show the questions where an l-xs* run switched away from x1's answer, with the
// candidates, their scores and verdicts.
//   node benchmarks/premise2/explore2/tools/l-show.js <variant@version> <set> [onlyChanged=1]
import { loadCandidates, norm } from "./l-lib.js"
const [vv, set] = process.argv.slice(2)
const { env, Q, verdictOf } = await loadCandidates([set])
for (const q of Q.values()) {
    const a = q.by[vv]
    if (!a?.l?.scores || !a.x1Answer) continue
    const v = (t) => verdictOf(q.record, t ?? "", "ok")
    console.log(`\n=== ${q.record.questionKey} [${q.record.stratum}] ${a.step}  yes=${a.l.yesPath === q.record.path ? "gold" : a.l.yesPath}`)
    console.log(`Q: ${q.record.question}\nGOLD: ${q.record.gold}`)
    for (const s of a.l.scores) {
        const c = a.l.cands.find((c) => s.srcs.includes(c.src))
        console.log(`  [${s.srcs.join("+")}] s=${s.s} lex=${s.lex} J1=${v(c.text)}: ${String(c.text).slice(0, 220)}`)
    }
}
