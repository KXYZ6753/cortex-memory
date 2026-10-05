// Worker x: S300-2, commit & unsure questions: does w7 find another YES email outside W0 (and is it AB)?
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const set = "S300-2"
const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
const K = load("k3@1+cold"), N = load("n-g5@1+cold"), W = load("w7@1+cold"), G = load("gates@1+cold")
const c = {}
const inc = (f) => (c[f] = (c[f] ?? 0) + 1)
for (const [key, k] of K) {
    if (k.answer.step !== "commit") continue
    const n = N.get(key).answer, w = W.get(key).answer, ab = bearing(k.record), st = k.record.stratum
    const tag = `${st}:${n.unsure ? "unsure" : "sure"}`
    inc(`${tag}:n`)
    const W0 = new Set(k.answer.contextPaths)
    const extraYes = (w.yes ?? []).filter((p) => !W0.has(p))
    if (extraYes.length) { inc(`${tag}:extraYES`); if (extraYes.some(ab)) inc(`${tag}:extraYES_AB`); if (extraYes.some(ab) && !G.get(key).correct) inc(`${tag}:extraYES_AB_gatesWrong`) }
}
console.log(c)
process.exit(0)
