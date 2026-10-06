// Worker v: inventory of stored answers / J1 verdicts per variant@version on the phase-2 sets.
//   node benchmarks/premise2/explore2/tools/v-inventory.js [S300-2,S300-1,S300-3,FULL-0,FULL-1]
import { join } from "node:path"
import { judgeConfig, preGrade } from "../../judge.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
const dataDir = ".data/premise2"
try { process.loadEnvFile(".env") } catch {}
const sets = (process.argv[2] ?? "S300-2,S300-1,S300-3,FULL-0,FULL-1").split(",")
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const answers = latestAnswers(dataDir)
const setKeys = new Map(sets.map((s) => [s, new Set(loadSet(dataDir, s, pool).questionKeys)]))
const table = new Map() // id -> set -> {n, graded, alias}
for (const a of answers) {
    if (!setKeys.has(a.set)) continue
    if (!setKeys.get(a.set).has(a.questionKey)) continue
    const id = `${a.variant}@${a.version}${a.alias === "small" ? "" : ":" + a.alias}`
    if (!table.has(id)) table.set(id, {})
    const row = (table.get(id)[a.set] ??= { n: 0, g: 0 })
    row.n++
    const record = pool.byKey.get(a.questionKey)
    if (preGrade(a) || verdicts.has(answerVerdictKey(a, record, judge))) row.g++
}
const ids = [...table.keys()].sort()
console.log(["id", ...sets].join("\t"))
for (const id of ids) console.log([id.padEnd(22), ...sets.map((s) => { const r = table.get(id)[s]; return r ? `${r.g}/${r.n}` : "-" })].join("\t"))
