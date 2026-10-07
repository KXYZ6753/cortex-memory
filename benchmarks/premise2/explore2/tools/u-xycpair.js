// Worker u: within-run pairing for u-xyc variants. On questions where the CAD single read
// replaced x1's answer, x1's own answer from the same run (u.x1Answer) is J1-graded
// directly (scratch cache, not verdicts.jsonl) and compared with the kept CAD answer.
//   node benchmarks/premise2/explore2/tools/u-xycpair.js S300-1[+...] u-xyc@1+cold <cache.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { judgeConfig, referenceVerdict, preGrade } from "../../judge.js"
import { referencesOf } from "../../explore/grade.js"
import { openAll } from "./a-lib.js"
const [sets, v, cacheFile] = process.argv.slice(2)
const { graded, bearing } = await openAll()
const judge = judgeConfig("j1")
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {}
const items = sets.split("+").flatMap((s) => graded(v, s)).filter((i) => i.answer.u?.kept && i.correct != null)
const key = (i) => `${i.record.questionKey}|${i.answer.u.x1Answer}`
const todo = items.filter((i) => cache[key(i)] === undefined)
let k = 0
await Promise.all(Array.from({ length: 8 }, async () => {
    while (k < todo.length) {
        const i = todo[k++]
        if (preGrade({ answer: i.answer.u.x1Answer, status: "ok" })) { cache[key(i)] = 0; continue }
        try { const r = await referenceVerdict(judge, { question: i.record.question, references: referencesOf(i.record), candidate: i.answer.u.x1Answer }); cache[key(i)] = r.verdict === "CORRECT" ? 1 : r.verdict === "INCORRECT" ? 0 : null } catch (e) { console.error(String(e).slice(0, 200)) }
    }
}))
writeFileSync(cacheFile, JSON.stringify(cache))
const t = {}
for (const i of items) {
    const yes = i.answer.u.yesPath
    const kind = yes === i.record.path || (i.record.twins ?? []).includes(yes) ? "gold" : bearing(i.record)(yes) ? "AB" : "nonAB"
    const r = (t[`${i.record.stratum} YES=${kind}`] ??= { n: 0, x: 0, c: 0, plus: 0, minus: 0 })
    const x = cache[key(i)]
    if (x == null) continue
    r.n++; r.x += x; r.c += i.correct
    if (i.correct > x) r.plus++
    if (i.correct < x) r.minus++
}
console.log(`${sets} ${v}: kept CAD single reads vs the same run's x1 answer`)
for (const [kk, r] of Object.entries(t).sort()) console.log(`${kk.padEnd(16)} n ${String(r.n).padStart(4)}  x1(same run) ${r.x}  cad ${r.c}  +${r.plus}/-${r.minus}`)
process.exit(0)
