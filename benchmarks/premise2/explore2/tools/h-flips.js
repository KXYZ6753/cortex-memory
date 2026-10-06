// Worker h (round 4): h7/h8 vs x1 and j2 on one set, by handover step; the specificity
// re-ask cases (old answer, new answer, verdicts; the old answer's verdict comes from the
// verdict index when that text was graded anywhere, e.g. as j2's or x1's answer).
//   node benchmarks/premise2/explore2/tools/h-flips.js S300-2 h7 [SHOW=1]
import { openAll } from "./a-lib.js"
import { judgeConfig, preGrade, normaliseAnswer } from "../../judge.js"
import { verdictIndex, answerVerdictKey, referencesOf } from "../../explore/grade.js"
import { referenceVerdict } from "../../judge.js"

const [set, id] = process.argv.slice(2)
const { graded } = await openAll()
const judge = judgeConfig("j1")
const vidx = verdictIndex(".data/premise2")
const vOf = (record, text) => { if (text == null) return null; if (preGrade({ answer: text, status: "ok" })) return 0; const v = vidx.get(answerVerdictKey({ answer: text }, record, judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const ver = (v) => (graded(`${v}@1+cold`, set).length ? `${v}@1+cold` : `${v}@1`)
const by = (v) => new Map(graded(ver(v), set).map((i) => [i.record.questionKey, i]))
const H = by(id), X = by("x1"), J = by("j2")
const norm = (s) => String(s ?? "").replace(/\+spec$/, "")
const agg = {}
const add = (k, f) => { agg[k] ??= { n: 0, h: 0, x: 0, j: 0, hx: [0, 0], hj: [0, 0], sameJ: 0, unk: 0 }; f(agg[k]) }
const specRows = []
for (const [key, h] of H) {
    const x = X.get(key), j = J.get(key)
    if (!x || !j) continue
    const s = h.record.stratum, step = norm(h.answer.step)
    const path = ["commit-g5", "commit-single", "commit-yesctx"].includes(step) ? "handover" : step
    for (const k of [`${s} ${path}`, `${s} ALL`]) add(k, (a) => {
        a.n++; a.h += h.correct ?? 0; a.x += x.correct ?? 0; a.j += j.correct ?? 0
        if (h.correct == null) a.unk++
        if (h.correct === 1 && x.correct === 0) a.hx[0]++; if (h.correct === 0 && x.correct === 1) a.hx[1]++
        if (h.correct === 1 && j.correct === 0) a.hj[0]++; if (h.correct === 0 && j.correct === 1) a.hj[1]++
        if (normaliseAnswer(h.answer.answer) === normaliseAnswer(j.answer.answer)) a.sameJ++
    })
    const sp = h.answer.spec
    if (sp?.fired) specRows.push({ key, s, acc: sp.accepted, newV: h.correct, oldV: sp.accepted ? vOf(h.record, sp.oldAnswer) : h.correct, x: x.correct, j: j.correct, q: h.record.question, gold: h.record.gold, alts: h.record.alternates ?? [], old: sp.oldAnswer, neu: sp.answer, mean: sp.mean, novel: sp.novel, step: h.answer.step })
}
console.log(`${set} ${id}: stratum path | n | ${id} right | x1 right | j2 right | vs x1 +/- | vs j2 +/- | same text as j2`)
for (const [k, a] of Object.entries(agg).sort()) console.log(`${k} | ${a.n} | ${a.h} | ${a.x} | ${a.j} | +${a.hx[0]}/-${a.hx[1]} | +${a.hj[0]}/-${a.hj[1]} | ${a.sameJ}${a.unk ? ` | ungraded ${a.unk}` : ""}`)
// JUDGE=1: grade accepted re-asks whose old answer was never graded (J1, printed only, not stored)
if (process.env.JUDGE) for (const r of specRows) if (r.acc && r.oldV == null) {
    const rec = { question: r.q, references: referencesOf({ gold: r.gold, alternates: r.alts }), candidate: r.old }
    const v = await referenceVerdict(judge, rec)
    r.oldV = v.verdict === "CORRECT" ? 1 : v.verdict === "INCORRECT" ? 0 : null
    r.oldJudged = true
}
const acc = specRows.filter((r) => r.acc)
console.log(`spec fired ${specRows.length} (hits ${specRows.filter((r) => r.s === "hit").length}), accepted ${acc.length}; accepted: old right ${acc.filter((r) => r.oldV === 1).length}, old wrong ${acc.filter((r) => r.oldV === 0).length}, old unknown ${acc.filter((r) => r.oldV == null).length}; new right ${acc.filter((r) => r.newV === 1).length}`)
if (process.env.SHOW) for (const r of specRows) console.log(`\n[${r.s} ${r.step} acc=${r.acc}] old=${r.oldV}${r.oldJudged ? "(judged now)" : ""} new=${r.newV} x1=${r.x} j2=${r.j} mean=${r.mean} novel=${r.novel.join(",")}\n  Q: ${r.q}\n  G: ${r.gold}\n  old: ${String(r.old).slice(0, 220)}\n  new: ${String(r.neu).slice(0, 220)}`)
process.exit(0)
