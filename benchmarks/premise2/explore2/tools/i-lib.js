// Shared helpers for worker i's offline tools (no GPU). Exploration data only:
// answers.jsonl / verdicts.jsonl under .data/premise2/explore and pool records.

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadPool, exploreDirOf } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"

if (existsSync(".env")) process.loadEnvFile(".env")
export const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"

export function readJsonl(path) {
    const out = []
    for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue
        try { out.push(JSON.parse(line)) } catch {}
    }
    return out
}

let answersCache = null
export function allAnswers() {
    answersCache ??= readJsonl(join(exploreDirOf(dataDir), "answers.jsonl"))
    return answersCache
}

// variant id -> Map(questionKey -> latest record) on one set; `statuses` null = final only.
export function answersOf(setName, variant, { statuses = null, version = null } = {}) {
    if (variant.includes("@")) { const [id, v] = variant.split("@"); variant = id; version = v.includes("+") ? v : `${v}+cold` }
    const byKey = new Map()
    for (const record of allAnswers()) {
        if (record.set !== setName || record.variant !== variant) continue
        if (version && record.version !== version) continue
        if (statuses ? !statuses.includes(record.status) : !FINAL_STATUSES.has(record.status)) continue
        byKey.set(record.questionKey, record)
    }
    return byKey
}

let ctxCache = null
export function gradingContext() {
    if (!ctxCache) {
        const pool = loadPool(dataDir)
        ctxCache = { pool, verdicts: verdictIndex(dataDir), judge: judgeConfig("j1"), missShare: pool.manifest.strata.missShare }
    }
    return ctxCache
}

export const setOf = (name) => loadSet(dataDir, name, gradingContext().pool)

// 1 / 0 / null (not graded yet)
export function correctOf(answer) {
    const { pool, verdicts, judge } = gradingContext()
    const record = pool.byKey.get(answer.questionKey)
    if (preGrade(answer)) return 0
    const verdict = verdicts.get(answerVerdictKey(answer, record, judge))
    return verdict ? (verdict.verdict === "CORRECT" ? 1 : 0) : null
}

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN)
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
