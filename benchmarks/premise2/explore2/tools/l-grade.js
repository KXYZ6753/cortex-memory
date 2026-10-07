// Worker l: J1-grade the extra candidate answers an l-* variant logs (l.cands[].text for
// deployable variants); the variant's own answer is graded by `cli2.js grade`. Verdicts go
// to the shared verdicts.jsonl (same keys as explore/grade.js). Takes the "grade" lock.
//   node benchmarks/premise2/explore2/tools/l-grade.js <set> <variant>
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
await withLock(dataDir, `l-grade ${setName} ${variant}`, async () => {
    const judge = judgeConfig("j1")
    if (spendSoFar(dataDir, "explore") >= EXPLORATION_CAP_USD) throw new Error("spend cap reached")
    const pool = loadPool(dataDir)
    const verdicts = verdictIndex(dataDir)
    const todo = new Map()
    for (const a of latestAnswers(dataDir)) {
        if (a.set !== setName || a.variant !== variant) continue
        const record = pool.byKey.get(a.questionKey)
        const texts = [...(a.l?.cands ?? []).map((c) => c.text), a.x1Answer].filter((t) => typeof t === "string" && t.trim())
        for (const text of texts) {
            const ans = { answer: text, status: "ok" }
            if (preGrade(ans)) continue
            const vkey = answerVerdictKey(ans, record, judge)
            if (!verdicts.has(vkey)) todo.set(vkey, { record, answer: text })
        }
    }
    console.log(`[l-grade] ${setName} ${variant}: ${todo.size} J1 calls`)
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
    appendFileSync(join(dataDir, "explore", "spend.jsonl"), JSON.stringify({ at: new Date().toISOString(), phase: "explore", calls: todo.size, failed, usd: null, estUsd: estimateUsd(usage), tokens: usage, sets: [setName], variants: [`${variant}:l-cands`] }) + "\n")
    console.log(`[l-grade] done, ${failed} failed, est $${estimateUsd(usage).toFixed(4)}`)
}, { name: "grade" })
