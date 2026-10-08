// Round 6, lead: how much of the gold-only reading gain (+3 hit points over det gates on
// FULL-2/3, S300-4/5) can the commit check's first YES email capture? Offline. When q1's
// first YES email is the gold (or a twin / near-duplicate), reading it alone with the
// sandwich prompt is byte-identical to the det gold-only arm (same prompt, det), so the
// arm's verdict is the YES-alone verdict. Other cases are only counted.
//   node benchmarks/premise2/explore2/tools/lead-yesalone.js
import { createReadStream, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const SETS = ["FULL-2", "FULL-3", "S300-4", "S300-5"]
const ARMS = { gates: "i-det-gates@2+cold|small", oracle: "q8-det-oracle@1+cold|small", q1: "q-det-q1@1+cold|small", lite: "lite-det-ub@1+cold|small" }
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const setKeys = new Map(SETS.map((s) => [s, new Set(loadSet(dataDir, s, pool).questionKeys)]))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {}
}
const armOf = new Map(Object.entries(ARMS).map(([k, v]) => [v, k]))
const latest = new Map()
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    const m = line.match(/"set":"([^"]+)"/)
    if (!m || !setKeys.has(m[1])) continue
    const r = JSON.parse(line)
    if (!armOf.has(`${r.variant}@${r.version}|${r.alias}`) || !FINAL_STATUSES.has(r.status)) continue
    latest.set(r.key, r)
}
const q = new Map()
for (const r of latest.values()) {
    const arm = armOf.get(`${r.variant}@${r.version}|${r.alias}`)
    const record = pool.byKey.get(r.questionKey)
    const v = preGrade(r) ? { verdict: "INCORRECT" } : verdicts.get(answerVerdictKey(r, record, judge))
    const k = `${r.set}|${r.questionKey}`
    if (!q.has(k)) q.set(k, { record, set: r.set })
    q.get(k)[arm] = v ? (v.verdict === "CORRECT" ? 1 : 0) : null
    if (arm === "q1") q.get(k).q1log = r.log ?? []
}
const cell = () => ({ n: 0, gates: 0, oracle: 0, q1: 0 })
const cats = {}
for (const item of q.values()) {
    if (item.record.stratum !== "hit" || [item.gates, item.oracle, item.q1].some((x) => x == null)) continue
    const gold = new Set([item.record.path, ...(item.record.twins ?? []), ...(item.record.nearDups ?? [])])
    const checks = (item.q1log ?? []).filter((e) => e.act === "check")
    const firstYes = checks.find((e) => e.yes)
    const yesCount = checks.filter((e) => e.yes).length
    const lp = firstYes?.yesLp ?? null
    const cat = !firstYes ? "no YES" : gold.has(firstYes.path) ? (lp >= -0.1 ? "YES=gold, sure" : "YES=gold, doubted") : (lp >= -0.1 ? "YES≠gold, sure" : "YES≠gold, doubted")
    cats[cat] ??= cell()
    const c = cats[cat]
    c.n++; c.gates += item.gates; c.oracle += item.oracle; c.q1 += item.q1
}
let tot = cell()
console.log("category | n | gates | gold-alone (= YES-alone when YES = gold) | q1")
for (const [cat, c] of Object.entries(cats).sort()) {
    console.log(`${cat} | ${c.n} | ${c.gates} | ${c.oracle} | ${c.q1}`)
    for (const k of Object.keys(tot)) tot[k] += c[k]
}
console.log(`all hits | ${tot.n} | ${tot.gates} | ${tot.oracle} | ${tot.q1}`)
const yg = Object.entries(cats).filter(([k]) => k.startsWith("YES=gold")).reduce((a, [, c]) => a + c.oracle - c.gates, 0)
console.log(`YES-alone on YES=gold hits vs gates: net ${yg} of ${tot.n} hits = ${(100 * yg / tot.n).toFixed(2)} hit points (YES≠gold cases not counted)`)
