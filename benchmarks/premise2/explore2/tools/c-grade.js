// Worker c: J1-grade the extra answers a diagnostic c-* variant stores in `renders`
// (the variant's own answer is graded by `cli2.js grade`). Verdicts go to the shared
// verdicts.jsonl (same format and keys as explore/grade.js, so any later lookup by
// answer text finds them); spend goes to spend.jsonl. Takes the "grade" lock.
//   node benchmarks/premise2/explore2/tools/c-grade.js <set> <variant>
import { appendFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { judgeConfig, referenceVerdict, preGrade, USAGE } from "../../judge.js"
import { latestAnswers, verdictIndex, answerVerdictKey, referencesOf, estimateUsd, spendSoFar, EXPLORATION_CAP_USD } from "../../explore/grade.js"
import { mapLimit } from "../../bm25.js"
import { loadPool } from "../../explore/pool.js"
import { withLock } from "../lock.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const [setName, variant] = process.argv.slice(2)
await withLock(dataDir, `c-grade ${setName} ${variant}`, async () => {
    const judge = judgeConfig("j1")
    if (spendSoFar(dataDir, "explore") >= EXPLORATION_CAP_USD) throw new Error("spend cap reached")
    const pool = loadPool(dataDir)
    const verdicts = verdictIndex(dataDir)
    const todo = new Map()
    for (const a of latestAnswers(dataDir)) {
        if (a.set !== setName || a.variant !== variant || !a.renders) continue
        const record = pool.byKey.get(a.questionKey)
        for (const r of Object.values(a.renders)) {
            const ans = { answer: r.answer, status: r.status }
            if (preGrade(ans)) continue
            const vkey = answerVerdictKey(ans, record, judge)
            if (!verdicts.has(vkey)) todo.set(vkey, { record, answer: r.answer })
        }
    }
    console.log(`[c-grade] ${setName} ${variant}: ${todo.size} J1 calls`)
    const path = join(dataDir, "explore", "verdicts.jsonl")
    let done = 0, failed = 0
    await mapLimit([...todo], 8, async ([vkey, item]) => {
        try {
            const result = await referenceVerdict(judge, { question: item.record.question, references: referencesOf(item.record), candidate: item.answer }, {})
            appendFileSync(path, JSON.stringify({ vkey, questionKey: item.record.questionKey, judge: `${judge.provider}:${judge.model}:${judge.think}`, ...result, at: new Date().toISOString() }) + "\n")
            if (!result.verdict) failed++
        } catch { failed++ }
        done++
    })
    const usage = Object.fromEntries(USAGE)
    appendFileSync(join(dataDir, "explore", "spend.jsonl"), JSON.stringify({ at: new Date().toISOString(), phase: "explore", calls: done, failed, usd: null, estUsd: estimateUsd(usage), tokens: usage, sets: [setName], variants: [`${variant}:renders`] }) + "\n")
    console.log(`[c-grade] ${done} calls, ${failed} failed, est $${estimateUsd(usage).toFixed(4)}`)
}, { name: "grade" })
