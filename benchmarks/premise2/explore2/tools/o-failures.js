// Offline (no GPU): joins stored answers of chosen variants on a set with J1 verdicts
// and dumps a per-question table, for reading-failure analysis. Pool records only.
// node benchmarks/premise2/explore2/tools/o-failures.js FULL-0 gates,oracles,pbs > out.json
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"

const dataDir = ".data/premise2"
const [setName = "FULL-0", list = "gates,oracles,pbs"] = process.argv.slice(2)
const wanted = list.split(",")
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const keys = new Set(set.questionKeys)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const rows = new Map()
for (const answer of latestAnswers(dataDir)) {
    if (answer.set !== setName || answer.alias !== "small" || !keys.has(answer.questionKey) || !wanted.includes(answer.variant)) continue
    const record = pool.byKey.get(answer.questionKey)
    const pre = preGrade(answer)
    let correct = null
    if (pre) correct = 0
    else { const v = verdicts.get(answerVerdictKey(answer, record, judge)); if (v) correct = v.verdict === "CORRECT" ? 1 : 0 }
    if (!rows.has(answer.questionKey)) rows.set(answer.questionKey, { questionKey: answer.questionKey, user: record.user, stratum: record.stratum, question: record.question, gold: record.gold, alternates: record.alternates, path: record.path, twins: record.twins, nearDups: record.nearDups })
    rows.get(answer.questionKey)[answer.variant] = { version: answer.version, answer: answer.answer, correct, abstain: isAbstain(answer.answer), contextPaths: answer.contextPaths, readPaths: answer.readPaths, switched: answer.switched, used: answer.used, wallMs: answer.wallMs }
}
console.log(JSON.stringify([...rows.values()]))
