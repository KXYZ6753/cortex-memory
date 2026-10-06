// Worker y: reproduction check without verdicts. For each y answer on a set, compare its
// text with the parent that owns its route: x1 (neither add-on fired), j2 (handover, first
// YES not doubted), m2 (m2 probed: sure commit / recovery), t-lx for y2's explore.
//   node benchmarks/premise2/explore2/tools/y-repro.js S300-2 y1
import { latestAnswers } from "../../explore/grade.js"
const [set, id = "y1"] = process.argv.slice(2)
const all = latestAnswers(".data/premise2").filter((a) => a.set === set)
const of = (v) => new Map(all.filter((a) => a.variant === v).map((a) => [a.questionKey, a]))
const X = of("x1"), J = of("j2"), M = of("m2"), TL = of("t-lx"), Y = of(id)
const t = {}
for (const [k, y] of Y) {
    const m2 = Boolean(y.y?.m2Fired)
    const step = y.step
    let key, parent
    if (["found", "nofound", "nopick"].includes(step)) { key = "explore"; parent = id === "y2" ? TL : X }
    else if (step === "commit" && !m2) { key = "sure commit (no add-on)"; parent = X }
    else if (step === "commit" && m2) { key = "sure commit, m2 probed, no E"; parent = M }
    else if (step.startsWith("recover") && !y.y?.j2Fired) { key = "recover-sure"; parent = M }
    else if (step.startsWith("recover")) { key = `recover, A unsure (${step})`; parent = M }
    else if (!m2) { key = `handover, j2 only (${step})`; parent = J }
    else { key = `handover after m2 probes (${step})`; parent = J }
    const c = (t[key] ??= { n: 0, same: 0, sameX: 0, parentStep: 0 })
    c.n++
    const p = parent.get(k)
    if (p && p.answer === y.answer) c.same++
    if (X.get(k)?.answer === y.answer) c.sameX++
    if (p && p.step === step) c.parentStep++
}
console.log(`${set} ${id}: route | n | same text as parent | same text as x1 | parent took the same step`)
for (const [k, c] of Object.entries(t).sort()) console.log(`${k} | ${c.n} | ${c.same} | ${c.sameX} | ${c.parentStep}`)
process.exit(0)
