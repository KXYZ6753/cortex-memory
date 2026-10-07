// Worker l: candidate file from a deployable l-xs* run's logs (for re-scoring the same
// candidates with another verification prompt, l-diag.js l-v3). Writes
// .data/premise2/explore/l-xs-cands.json: questionKey -> { yesPath, cands: [{ srcs, text }] }
// (the run's distinct verified candidates, x1's answer first).
//   node benchmarks/premise2/explore2/tools/l-build2.js <variant> <sets>
import { writeFileSync, existsSync, readFileSync } from "node:fs"
import { latestAnswers } from "../../explore/grade.js"
const [variant, setArg] = process.argv.slice(2)
const sets = setArg.split(",")
const OUT = ".data/premise2/explore/l-xs-cands.json"
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {}
let n = 0
for (const a of latestAnswers(".data/premise2")) {
    if (a.variant !== variant || !sets.includes(a.set) || !a.l?.scores?.length) continue
    const cands = a.l.scores.map((s) => ({ srcs: s.srcs, text: String(a.l.cands.find((c) => s.srcs.includes(c.src))?.text ?? "").trim() }))
    out[a.questionKey] = { set: a.set, yesPath: a.l.yesPath, cands }
    n++
}
writeFileSync(OUT, JSON.stringify(out))
console.log(`${n} questions from ${variant} on ${sets.join(",")}; file has ${Object.keys(out).length}`)
