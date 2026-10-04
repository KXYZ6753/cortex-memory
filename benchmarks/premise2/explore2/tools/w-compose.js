// Offline (no GPU): composite estimate "variant on switched questions, gates otherwise"
// from stored S300-2 answers (non-switched questions would run gates' exact prompt).
// node benchmarks/premise2/explore2/tools/w-compose.js S300-2 w7
process.loadEnvFile(".env")
import { loadPool } from "../../explore/pool.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
const dataDir = ".data/premise2"
const [setName = "S300-2", variant = "w7"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const ms = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const by = new Map()
for (const a of latestAnswers(dataDir)) {
    if (a.set !== setName || a.alias !== "small" || ![variant, "gates"].includes(a.variant)) continue
    const r = pool.byKey.get(a.questionKey)
    const pre = preGrade(a)
    const v = pre ? 0 : verdicts.get(answerVerdictKey(a, r, judge))
    if (!pre && !v) continue
    if (!by.has(a.questionKey)) by.set(a.questionKey, { stratum: r.stratum })
    by.get(a.questionKey)[a.variant === "gates" ? "g" : "v"] = { c: pre ? 0 : v.verdict === "CORRECT" ? 1 : 0, sw: a.switched, ms: a.wallMs }
}
const acc = { miss: [], hit: [] }, cost = { miss: [], hit: [] }
for (const row of by.values()) {
    if (!row.g || !row.v) continue
    const use = row.v.sw ? row.v : row.g
    acc[row.stratum].push(use.c); cost[row.stratum].push(use.ms)
}
const m = (l) => l.reduce((s, x) => s + x, 0) / l.length
console.log(`${variant} on switched, gates otherwise: weighted ${(100 * (ms * m(acc.miss) + (1 - ms) * m(acc.hit))).toFixed(1)} miss ${(100 * m(acc.miss)).toFixed(1)} hit ${(100 * m(acc.hit)).toFixed(1)}; wall ms natural-weighted ${Math.round(ms * m(cost.miss) + (1 - ms) * m(cost.hit))}, set mean ${Math.round(m([...cost.miss, ...cost.hit]))}`)
