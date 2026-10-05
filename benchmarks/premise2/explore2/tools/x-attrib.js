// Worker x: S300-2 committed questions: is the email gates' answer is attributed to probed YES (w7)?
// Signal for false-YES commits (hypothesis 2a).
import { openAll } from "./a-lib.js"
import { attribute } from "../variants/a-common.js"
const { graded, bearing, emails } = await openAll()
for (const set of ["S300-2", "S300-1"]) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const K = load("k3@1+cold"), W = load("w7@1+cold"), N = load("n-g5@1+cold"), A = load("g5@1+cold")
    const c = {}
    for (const [key, k] of K) {
        if (k.answer.step !== "commit") continue
        const ab = bearing(k.record), w = W.get(key)?.answer, n = N.get(key).answer
        const yesSet = new Set([...(w?.yes ?? []), ...(k.answer.log ?? []).filter((l) => l.yes).map((l) => l.path)])
        const noSet = new Set([...(w?.no ?? []), ...(k.answer.log ?? []).filter((l) => l.act === "check" && !l.yes).map((l) => l.path)])
        const at = attribute(k.answer.answer, k.record.question, k.answer.contextPaths, emails.emailOf)
        let tag
        if (!at || at.share < 0.3) tag = "weakAttr"
        else if (yesSet.has(at.path)) tag = "attrYES"
        else if (noSet.has(at.path)) tag = "attrNO"
        else tag = "attrUnprobed"
        const t = `${k.record.stratum}/${tag}`
        const cc = (c[t] ??= { n: 0, k3ok: 0, g5ok: 0, attrAB: 0, unsure: 0 })
        cc.n++; cc.k3ok += k.correct; cc.g5ok += A.get(key).correct; cc.attrAB += at && ab(at.path) ? 1 : 0; cc.unsure += n.unsure ? 1 : 0
    }
    console.log(`== ${set}`); for (const [t, v] of Object.entries(c).sort()) console.log(t.padEnd(20), JSON.stringify(v))
}
process.exit(0)
