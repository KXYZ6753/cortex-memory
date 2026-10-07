// Worker c: across all gold-only renders of the c-gold* runs on a set, how many hits are
// wrong under every presentation (presentation-proof errors), right under every one, or
// split. Offline.  node .../c-union.js <set> [variants=c-gold,c-gold2,c-gold3]
import { latestAnswers } from "../../explore/grade.js"
import { questionType } from "../../text.js"
import { pool, dataDir, verdictOf } from "./c-lib.js"
const [set, list = "c-gold,c-gold2,c-gold3,c-goldx"] = process.argv.slice(2)
const runs = list.split(",")
const per = new Map()
for (const a of latestAnswers(dataDir)) {
    if (a.set !== set || !runs.includes(a.variant) || !a.renders) continue
    const r = pool.byKey.get(a.questionKey)
    if (!per.has(a.questionKey)) per.set(a.questionKey, [])
    for (const [name, x] of Object.entries(a.renders)) per.get(a.questionKey).push({ name: `${a.variant}:${name}`, v: verdictOf(r, x.answer), ans: x.answer })
}
let allR = 0, allW = 0, split = 0
const wrongAll = []
for (const [k, l] of per) {
    const vs = l.map((x) => x.v).filter((v) => v !== null)
    if (vs.every((v) => v === 1)) allR++
    else if (vs.every((v) => v === 0)) { allW++; wrongAll.push(k) }
    else split++
}
console.log(`${set}: ${per.size} hits; right under every render ${allR}, wrong under every render ${allW}, split ${split} (renders per question ~${(([...per.values()].reduce((s, l) => s + l.length, 0)) / per.size).toFixed(1)})`)
for (const k of wrongAll) { const r = pool.byKey.get(k); console.log(`  [${questionType(r.question)}] ${r.question.slice(0, 110)} | GOLD: ${r.gold.slice(0, 80)}`) }
