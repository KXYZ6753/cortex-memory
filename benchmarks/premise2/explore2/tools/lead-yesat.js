// Lead, round 4: x1 accuracy by commit position (yesAt) and path, from stored answers.
import { loadPool } from "../../explore/pool.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
if (process.argv.includes("--env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const variant = process.argv[2] ?? "x1"
const sets = (process.argv[3] ?? "S300-2,S300-1,S300-3,FULL-0,FULL-1").split(",")
const tab = new Map()
for (const a of latestAnswers(dataDir)) {
    if (a.variant !== variant || !sets.includes(a.set) || a.phase !== 2) continue
    const r = pool.byKey.get(a.questionKey)
    const pre = preGrade(a)
    const v = pre ? 0 : verdicts.get(answerVerdictKey(a, r, judge))
    if (v === undefined) continue
    const c = pre ? 0 : v.verdict === "CORRECT" ? 1 : 0
    const pos = a.yesAt === undefined ? "-" : a.yesAt > 0 ? "yesAt>0" : "yesAt0"
    const k = `${r.stratum} ${a.step} ${pos}`
    const t = tab.get(k) ?? [0, 0]
    t[0] += c; t[1]++
    tab.set(k, t)
}
for (const [k, [c, n]] of [...tab].sort()) console.log(k.padEnd(32), `${c}/${n}`, (100 * c / n).toFixed(1))
