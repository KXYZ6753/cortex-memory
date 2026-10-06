// Lead, round 4: x1 path cells vs another variant (default gates) on the same questions,
// plus where the gold sits in W0 for hit cells. Offline, stored answers + J1 verdicts.
import { loadPool } from "../../explore/pool.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const [variant = "x1", other = "gates", setsArg = "S300-2,S300-1,S300-3,FULL-0,FULL-1"] = process.argv.slice(2)
const sets = setsArg.split(",")
const score = (a) => { const r = pool.byKey.get(a.questionKey); const pre = preGrade(a); if (pre) return 0; const v = verdicts.get(answerVerdictKey(a, r, judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const by = { [variant]: new Map(), [other]: new Map() }
for (const a of latestAnswers(dataDir)) if (by[a.variant] && sets.includes(a.set)) by[a.variant].set(`${a.set}|${a.questionKey}`, a)
const tab = new Map()
for (const [k, a] of by[variant]) {
    const b = by[other].get(k)
    const r = pool.byKey.get(a.questionKey)
    const ca = score(a), cb = b ? score(b) : null
    if (ca === null || cb === null) continue
    const W0 = a.log?.filter((l) => l.act === "check").map((l) => l.path) ?? []
    const ctxp = a.contextPaths ?? []
    const goldIn = (paths) => paths.some((p) => p === r.path || (r.twins ?? []).includes(p))
    const pos = a.yesAt === undefined ? "" : a.yesAt > 0 ? " yesAt>0" : " yesAt0"
    const extra = a.step === "nofound" ? (goldIn(ctxp) ? " goldInCtx" : " goldNotInCtx") : ""
    const key = `${r.stratum} ${a.step}${pos}${extra}`
    const t = tab.get(key) ?? { n: 0, a: 0, b: 0, ab: 0, aOnly: 0, bOnly: 0 }
    t.n++; t.a += ca; t.b += cb; if (ca && !cb) t.aOnly++; if (cb && !ca) t.bOnly++
    tab.set(key, t)
}
console.log(`cell`.padEnd(40), `n  ${variant}  ${other}  ${variant}-only ${other}-only`)
for (const [k, t] of [...tab].sort()) console.log(k.padEnd(40), t.n, t.a, t.b, t.aOnly, t.bOnly)
