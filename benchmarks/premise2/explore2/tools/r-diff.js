// Paired per-question comparison of two variants on a set (diagnosis of a finished
// screening run; not used for tuning): flips by stratum and by r-variant flags.
//   node benchmarks/premise2/explore2/tools/r-diff.js S300-2 r1 gates
import { judgeConfig, preGrade } from "../../judge.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { loadPool } from "../../explore/pool.js"
import { DATA_DIR } from "./r-common.js"
try { process.loadEnvFile(".env") } catch {}
const [set, a, b] = process.argv.slice(2)
const pool = loadPool(DATA_DIR)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(DATA_DIR)
const by = { [a]: new Map(), [b]: new Map() }
for (const ans of latestAnswers(DATA_DIR)) {
    if (ans.set !== set || !(ans.variant in by) || ans.alias !== "small") continue
    const record = pool.byKey.get(ans.questionKey)
    let c
    if (preGrade(ans)) c = 0
    else { const v = verdicts.get(answerVerdictKey(ans, record, judge)); if (!v) continue; c = v.verdict === "CORRECT" ? 1 : 0 }
    by[ans.variant].set(ans.questionKey, { c, ans, record })
}
const t = {}
for (const [key, x] of by[a]) {
    const y = by[b].get(key)
    if (!y) continue
    const flag = `${x.record.stratum} sw=${x.ans.switched ? 1 : 0} swap=${x.ans.swapped ? 1 : 0} used=${x.ans.used}`
    t[flag] ??= { n: 0, win: 0, loss: 0 }
    t[flag].n++
    if (x.c > y.c) t[flag].win++
    if (x.c < y.c) t[flag].loss++
}
for (const [k, v] of Object.entries(t).sort()) console.log(k.padEnd(30), `n=${v.n} ${a} wins ${v.win} losses ${v.loss}`)
