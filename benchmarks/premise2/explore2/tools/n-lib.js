// Shared offline helpers for prefix n (no GPU). Pool records + exploration answers only.
import { existsSync } from "node:fs"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade, normaliseAnswer } from "../../judge.js"
import { isAbstain } from "../../prompts.js"

if (existsSync(".env")) process.loadEnvFile(".env")
export const dataDir = ".data/premise2"
export const pool = loadPool(dataDir)
export const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
let verdicts = null
export const verdictsIdx = () => (verdicts ??= verdictIndex(dataDir))

// Verdict (1/0) for an answer text to a record, or null if never graded.
export function verdictOf(record, text) {
    const pre = preGrade({ answer: text, status: "ok" })
    if (pre) return 0
    const v = verdictsIdx().get(answerVerdictKey({ answer: text }, record, judge))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}
export function verdictRow(record, text) {
    return verdictsIdx().get(answerVerdictKey({ answer: text }, record, judge)) ?? null
}

// variant -> Map(questionKey -> { correct, answer, a })
export function loadTable(setName, variants = null) {
    const set = loadSet(dataDir, setName, pool)
    const keys = new Set(set.questionKeys)
    const table = new Map()
    for (const answer of latestAnswers(dataDir)) {
        if (answer.set !== setName || answer.alias !== "small" || !keys.has(answer.questionKey)) continue
        if (variants && !variants.includes(answer.variant)) continue
        const record = pool.byKey.get(answer.questionKey)
        const pre = preGrade(answer)
        let correct = null
        if (pre) correct = 0
        else { const v = verdictsIdx().get(answerVerdictKey(answer, record, judge)); if (v) correct = v.verdict === "CORRECT" ? 1 : 0 }
        if (!table.has(answer.variant)) table.set(answer.variant, new Map())
        table.get(answer.variant).set(answer.questionKey, { correct, abstain: isAbstain(answer.answer), answer: answer.answer, a: answer })
    }
    return { set, table, keys: set.questionKeys }
}

export function weightedOf(items) { // items: [{ stratum, v }]
    const m = items.filter((i) => i.stratum === "miss"), h = items.filter((i) => i.stratum === "hit")
    const mean = (l) => (l.length ? l.reduce((s, i) => s + i.v, 0) / l.length : NaN)
    return { w: 100 * (missShare * mean(m) + (1 - missShare) * mean(h)), miss: 100 * mean(m), hit: 100 * mean(h) }
}
export const same = (a, b) => normaliseAnswer(a) === normaliseAnswer(b)
