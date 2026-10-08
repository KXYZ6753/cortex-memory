// Worker n6: what did u-xyc (x1; on sure commits the first YES email re-read alone with CAD)
// do on its kept questions? Pairs the kept CAD single read with the same run's x1 answer
// (u.x1Answer) using verdicts already in verdicts.jsonl (no new grading; unknown = skipped),
// split by stratum and by whether the YES email is the gold. Offline, no GPU.
//   node benchmarks/premise2/explore2/tools/n6-xyc.js S300-1,S300-4,S300-5
import { openAll } from "./a-lib.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { verdictIndex, answerVerdictKey } from "../../explore/grade.js"
const { graded, bearing } = await openAll()
const V = verdictIndex(".data/premise2"), J = judgeConfig("j1")
const verdictOf = (text, record) => {
    if (preGrade({ answer: text, status: "ok" })) return 0
    const v = V.get(answerVerdictKey({ answer: text }, record, J))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}
for (const s of process.argv[2].split(",")) {
    const t = {}
    let kept = 0, sure = 0
    for (const i of graded("u-xyc@1+cold", s)) {
        if (!i.answer.u) continue
        sure++
        if (!i.answer.u.kept || i.correct == null) continue
        kept++
        const x = verdictOf(i.answer.u.x1Answer, i.record)
        const yes = i.answer.u.yesPath
        const kind = yes === i.record.path || (i.record.twins ?? []).includes(yes) ? "gold" : bearing(i.record)(yes) ? "AB" : "nonAB"
        const r = (t[`${i.record.stratum} YES=${kind}`] ??= { n: 0, unk: 0, x: 0, c: 0, plus: 0, minus: 0, same: 0 })
        if (x == null) { r.unk++; continue }
        r.n++; r.x += x; r.c += i.correct
        if (i.answer.answer.trim() === i.answer.u.x1Answer.trim()) r.same++
        if (i.correct > x) r.plus++
        if (i.correct < x) r.minus++
    }
    console.log(`${s}: sure commits ${sure}, CAD read kept ${kept}`)
    for (const [k, r] of Object.entries(t).sort()) console.log(`  ${k.padEnd(14)} n ${r.n} (unknown ${r.unk})  x1 ${r.x}  cad ${r.c}  +${r.plus}/-${r.minus}  same text ${r.same}`)
}
process.exit(0)
