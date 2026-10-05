// Worker x: x1 reproduction vs stored k3 / g5 / n-g5 (text identity and verdict flips by step).
import { openAll } from "./a-lib.js"
import { normaliseAnswer } from "../../judge.js"
const { graded } = await openAll()
const set = process.argv[2] ?? "S300-2"
const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
const X = load("x1@1+cold"), K = load("k3@1+cold"), A = load("g5@1+cold"), N = load("n-g5@1+cold")
const c = {}
for (const [key, x] of X) {
    const k = K.get(key), a = A.get(key), n = N.get(key).answer
    const ref = x.answer.step === "commit-g5" ? a : k
    const t = `${x.record.stratum}/${x.answer.step}`
    const cc = (c[t] ??= { n: 0, sameText: 0, x: 0, ref: 0, simUnsureAgree: 0, kStepSame: 0 })
    cc.n++; cc.x += x.correct; cc.ref += ref.correct
    if (normaliseAnswer(x.answer.answer) === normaliseAnswer(ref.answer.answer)) cc.sameText++
    if (x.answer.step.startsWith("commit") && !!x.answer.unsure === !!n.unsure) cc.simUnsureAgree++
    if ((x.answer.step.startsWith("commit") ? "commit" : x.answer.step) === k.answer.step) cc.kStepSame++
}
console.log(set); for (const [t, v] of Object.entries(c).sort()) console.log(t.padEnd(20), JSON.stringify(v))
process.exit(0)
