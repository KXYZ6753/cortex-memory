// J1-only screening grades for exploration answers (explore-plan.md §5, §7).
//
// Technical failures and exact abstentions are graded INCORRECT without a judge call
// (judge.js preGrade). Every other answer goes to J1 under the main study's verdict
// key, cached in .data/premise2/explore/verdicts.jsonl, so identical answers to the
// same question are judged once. Spend is read from OpenRouter's key endpoint before
// and after each batch and appended to spend.jsonl; exploration grading refuses to
// start once the cumulative exploration spend reaches the cap.

import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { judgeConfig, referenceVerdict, verdictKey, preGrade, USAGE, JudgePaused } from "../judge.js"
import { mapLimit } from "../bm25.js"
import { exploreDirOf, loadPool } from "./pool.js"
import { readJsonl, FINAL_STATUSES } from "./run.js"

export const EXPLORATION_CAP_USD = 3.5
export const TOTAL_CAP_USD = 5.0

export const referencesOf = (record) => [record.gold, ...(record.alternates ?? [])]

export async function openRouterUsage() {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) return null
    try {
        const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
        if (!response.ok) return null
        const data = await response.json()
        return typeof data.data?.usage === "number" ? data.data.usage : null
    } catch {
        return null
    }
}

export function spendSoFar(dataDir, phase = null) {
    return readJsonl(join(exploreDirOf(dataDir), "spend.jsonl"))
        .filter((entry) => !phase || entry.phase === phase)
        .reduce((sum, entry) => sum + (entry.usd ?? 0), 0)
}

// Latest answer per (variant@version, alias, questionKey) among final records.
export function latestAnswers(dataDir) {
    const latest = new Map()
    for (const record of readJsonl(join(exploreDirOf(dataDir), "answers.jsonl"))) {
        if (FINAL_STATUSES.has(record.status)) latest.set(record.key, record)
    }
    return [...latest.values()]
}

export function verdictIndex(dataDir) {
    const index = new Map()
    for (const entry of readJsonl(join(exploreDirOf(dataDir), "verdicts.jsonl"))) if (entry.verdict) index.set(entry.vkey, entry)
    return index
}

export const answerVerdictKey = (answer, record, judge) => verdictKey({ questionKey: record.questionKey, references: referencesOf(record), answer: answer.answer, judge })

export async function gradeExplore({ dataDir, sets = null, variants = null, phase = "explore", log = console.log }) {
    const judge = judgeConfig("j1")
    if (judge.provider !== "openrouter") throw new Error(`J1 provider is ${judge.provider}; set POC2_J1_PROVIDER=openrouter and POC2_J1_MODEL in .env`)
    const cap = phase === "explore" ? EXPLORATION_CAP_USD : TOTAL_CAP_USD
    const before = spendSoFar(dataDir, phase === "explore" ? "explore" : null)
    if (before >= cap) throw new Error(`spend cap reached: $${before.toFixed(3)} >= $${cap} (${phase})`)
    const pool = loadPool(dataDir)
    const verdicts = verdictIndex(dataDir)
    const path = join(exploreDirOf(dataDir), "verdicts.jsonl")
    const todo = []
    let cached = 0
    let deterministic = 0
    for (const answer of latestAnswers(dataDir)) {
        if (sets && !sets.includes(answer.set)) continue
        if (variants && !variants.includes(answer.variant)) continue
        const record = pool.byKey.get(answer.questionKey)
        if (preGrade(answer)) { deterministic++; continue }
        const vkey = answerVerdictKey(answer, record, judge)
        if (verdicts.has(vkey) || todo.some((item) => item.vkey === vkey)) { cached++; continue }
        todo.push({ vkey, record, answer })
    }
    log(`[grade] ${todo.length} J1 calls needed (${cached} cached, ${deterministic} deterministic)`)
    if (!todo.length) return { calls: 0, usd: 0 }
    const concurrency = Number(process.env.POC2_JUDGE_CONCURRENCY ?? 8)
    const usageBefore = await openRouterUsage()
    let done = 0
    let failed = 0
    let paused = null
    await mapLimit(todo, concurrency, async (item) => {
        if (paused) return
        try {
            const result = await referenceVerdict(judge, { question: item.record.question, references: referencesOf(item.record), candidate: item.answer.answer }, {})
            appendFileSync(path, JSON.stringify({ vkey: item.vkey, questionKey: item.record.questionKey, judge: `${judge.provider}:${judge.model}:${judge.think}`, ...result, at: new Date().toISOString() }) + "\n")
            if (!result.verdict) failed++
        } catch (error) {
            if (error instanceof JudgePaused) paused = error.message
            else failed++
        }
        done++
        if (done % 100 === 0) log(`[grade] ${done}/${todo.length}`)
    })
    const usageAfter = await openRouterUsage()
    const usage = Object.fromEntries(USAGE)
    const usd = usageBefore !== null && usageAfter !== null ? usageAfter - usageBefore : null
    const entry = { at: new Date().toISOString(), phase, calls: done, failed, usd, usageBefore, usageAfter, tokens: usage, sets, variants }
    appendFileSync(join(exploreDirOf(dataDir), "spend.jsonl"), JSON.stringify(entry) + "\n")
    log(`[grade] ${done} calls, ${failed} failed, $${usd?.toFixed(4) ?? "?"}; ${phase} total now $${(before + (usd ?? 0)).toFixed(3)}${paused ? `; PAUSED: ${paused}` : ""}`)
    return entry
}
