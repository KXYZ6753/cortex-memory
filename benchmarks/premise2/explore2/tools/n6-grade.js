// Worker n6: J1-grade the extra answers an n6-* diagnostic variant logs (n6.cfg[name].answer);
// the variant's own answer is graded by `cli2.js grade`. Verdicts go to the shared
// verdicts.jsonl (same keys as explore/grade.js, so identical texts share verdicts). Takes
// the "grade" lock. Pool records only (no TEST data).
//   node benchmarks/premise2/explore2/tools/n6-grade.js <set[,set]> <variant>
import { appendFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { judgeConfig, referenceVerdict, preGrade, USAGE } from "../../judge.js"
import { latestAnswers, verdictIndex, answerVerdictKey, referencesOf, estimateUsd, spendSoFar, EXPLORATION_CAP_USD } from "../../explore/grade.js"
import { mapLimit } from "../../bm25.js"
import { loadPool } from "../../explore/pool.js"
import { withLock } from "../lock.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const [setsArg, variant] = process.argv.slice(2)
const sets = new Set(setsArg.split(","))
if ([...sets].some((s) => /^(H6-C|DEMO|TEST)/i.test(s))) throw new Error("n6-grade: set not allowed")
await withLock(dataDir, `n6-grade ${setsArg} ${variant}`, async () => {
    const judge = judgeConfig("j1")
    if (spendSoFar(dataDir, "explore") >= EXPLORATION_CAP_USD) throw new Error("spend cap reached")
    const pool = loadPool(dataDir)
    const verdicts = verdictIndex(dataDir)
    const todo = new Map()
    for (const a of latestAnswers(dataDir)) {
        if (!sets.has(a.set) || a.variant !== variant || !a.n6?.cfg) continue
        const record = pool.byKey.get(a.questionKey)
        if (!record) continue
        for (const c of Object.values(a.n6.cfg)) {
            const ans = { answer: c.answer ?? "", status: c.status ?? "ok" }
            if (preGrade(ans)) continue
            const vkey = answerVerdictKey(ans, record, judge)
            if (!verdicts.has(vkey)) todo.set(vkey, { record, answer: ans.answer })
        }
    }
    console.log(`[n6-grade] ${setsArg} ${variant}: ${todo.size} J1 calls`)
    const path = join(dataDir, "explore", "verdicts.jsonl")
    let failed = 0
    await mapLimit([...todo], 8, async ([vkey, item]) => {
        try {
            const result = await referenceVerdict(judge, { question: item.record.question, references: referencesOf(item.record), candidate: item.answer }, {})
            appendFileSync(path, JSON.stringify({ vkey, questionKey: item.record.questionKey, judge: `${judge.provider}:${judge.model}:${judge.think}`, ...result, at: new Date().toISOString() }) + "\n")
            if (!result.verdict) failed++
        } catch (e) { failed++ }
    })
    const usage = Object.fromEntries(USAGE)
    appendFileSync(join(dataDir, "explore", "spend.jsonl"), JSON.stringify({ at: new Date().toISOString(), phase: "explore", calls: todo.size, failed, usd: null, estUsd: estimateUsd(usage), tokens: usage, sets: [...sets], variants: [`${variant}:n6-cfg`] }) + "\n")
    console.log(`[n6-grade] done, ${failed} failed, est $${estimateUsd(usage).toFixed(4)}`)
}, { name: "grade" })
process.exit(0)
