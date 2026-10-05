// Worker x: k3 vs g5 disagreement cells, by k3 step and gates confidence.
import { openAll } from "./a-lib.js"
import { normaliseAnswer } from "../../judge.js"
const { graded } = await openAll()
for (const set of ["S300-2", "S300-1"]) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const K = load("k3@1+cold"), A = load("g5@1+cold"), N = load("n-g5@1+cold")
    const c = {}
    for (const [key, k] of K) {
        const a = A.get(key), n = N.get(key).answer
        const tag = `${k.record.stratum}/${k.answer.step}/${n.unsure ? "U" : "S"}`
        const cc = (c[tag] ??= { n: 0, kOnly: 0, aOnly: 0, both: 0, none: 0, sameText: 0 })
        cc.n++
        if (k.correct && !a.correct) cc.kOnly++; else if (!k.correct && a.correct) cc.aOnly++; else if (k.correct) cc.both++; else cc.none++
        if (normaliseAnswer(k.answer.answer) === normaliseAnswer(a.answer.answer)) cc.sameText++
    }
    console.log(`== ${set}`); for (const [t, v] of Object.entries(c).sort()) console.log(t.padEnd(22), JSON.stringify(v))
}
process.exit(0)
