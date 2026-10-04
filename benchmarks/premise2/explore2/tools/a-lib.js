// Offline helpers for worker `a` (agent & hybrid): join stored exploration answers
// with J1 verdicts, using pool records only (no TEST data).
import { join } from "node:path"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { ensureEmailStore } from "../../agent-run.js"
import { EvidenceCache } from "../../evidence.js"

export const dataDir = ".data/premise2"
if (process.env.OPENROUTER_API_KEY === undefined) try { process.loadEnvFile(".env") } catch {}

export async function openAll() {
    const pool = loadPool(dataDir)
    const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
    const evidence = new EvidenceCache({ get: emails.emailOf })
    const judge = judgeConfig("j1")
    const verdicts = verdictIndex(dataDir)
    const answers = latestAnswers(dataDir)
    const graded = (variantAtVersion, setName) => {
        const set = loadSet(dataDir, setName, pool)
        const keys = new Set(set.questionKeys)
        const out = []
        for (const answer of answers) {
            if (`${answer.variant}@${answer.version}` !== variantAtVersion || answer.set !== setName || !keys.has(answer.questionKey)) continue
            const record = pool.byKey.get(answer.questionKey)
            const pre = preGrade(answer)
            let correct = null
            if (pre) correct = 0
            else {
                const verdict = verdicts.get(answerVerdictKey(answer, record, judge))
                if (verdict) correct = verdict.verdict === "CORRECT" ? 1 : 0
            }
            out.push({ answer, record, correct, abstain: isAbstain(answer.answer) })
        }
        return out
    }
    const bearing = (record) => (path) => path === record.path || (record.twins ?? []).includes(path) || evidence.answerBearing(path, record) === true
    return { pool, emails, evidence, graded, bearing, missShare: pool.manifest.strata.missShare }
}

export const weightedOf = (items, missShare, value = (item) => item.correct) => {
    const mean = (list) => (list.length ? list.reduce((s, i) => s + value(i), 0) / list.length : NaN)
    const miss = items.filter((i) => i.record.stratum === "miss")
    const hit = items.filter((i) => i.record.stratum === "hit")
    return { weighted: missShare * mean(miss) + (1 - missShare) * mean(hit), miss: mean(miss), hit: mean(hit), nMiss: miss.length, nHit: hit.length }
}
