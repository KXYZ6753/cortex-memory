// Offline (no GPU): paired outcomes of a variant vs gates on a set, split by whether the
// variant's answering context differs from gates' (same first email / same set / other).
// node benchmarks/premise2/explore2/tools/w-pair.js S300-2 w6
process.loadEnvFile(".env")
import { loadPool } from "../../explore/pool.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
const dataDir = ".data/premise2"
const [setName = "S300-2", variant = "w6", ref = "gates"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const by = new Map()
for (const a of latestAnswers(dataDir)) {
    if (a.set !== setName || a.alias !== "small" || ![variant, ref].includes(a.variant)) continue
    const r = pool.byKey.get(a.questionKey)
    const pre = preGrade(a)
    const v = pre ? 0 : verdicts.get(answerVerdictKey(a, r, judge))
    if (!pre && !v) continue
    const correct = pre ? 0 : v.verdict === "CORRECT" ? 1 : 0
    if (!by.has(a.questionKey)) by.set(a.questionKey, { stratum: r.stratum })
    by.get(a.questionKey)[a.variant] = { correct, ctx: a.contextPaths ?? [], read: a.readPaths ?? a.contextPaths ?? [], a }
}
const t = {}
for (const row of by.values()) {
    const x = row[variant], g = row[ref]
    if (!x || !g) continue
    const kind = x.read[0] === g.read[0] ? (x.read.slice(0, 5).join() === g.read.slice(0, 5).join() ? "same ctx" : "same first") : "diff first"
    const k = `${row.stratum} ${kind}`
    t[k] ??= { n: 0, refOnly: 0, varOnly: 0, both: 0 }
    t[k].n++
    if (g.correct && !x.correct) t[k].refOnly++
    if (x.correct && !g.correct) t[k].varOnly++
    if (x.correct && g.correct) t[k].both++
}
console.table(t)
