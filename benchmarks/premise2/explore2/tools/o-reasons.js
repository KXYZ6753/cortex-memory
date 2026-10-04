// Offline (no GPU): J1 reasons for a variant's INCORRECT answers on a set (hit stratum).
import { existsSync } from "node:fs"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig } from "../../judge.js"
if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const [setName, variant, stratum = "hit"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const keys = new Set(loadSet(dataDir, setName, pool).questionKeys)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
for (const answer of latestAnswers(dataDir)) {
    if (answer.set !== setName || answer.variant !== variant || !keys.has(answer.questionKey)) continue
    const record = pool.byKey.get(answer.questionKey)
    if (record.stratum !== stratum) continue
    const v = verdicts.get(answerVerdictKey(answer, record, judge))
    if (v && v.verdict !== "CORRECT") console.log(`${answer.questionKey} | parts ${v.partsCorrect}/${v.partsAsked} | missing: ${v.missing} | ${v.reason}`)
}
