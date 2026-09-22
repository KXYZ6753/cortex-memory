// DEV grading and the pre-registered E* selection.
//
// Rule: E* is the DEV config with the highest J1-only accuracy on e2b. Configs
// within 2 points of the best (about one paired SE at n=400) are treated as tied,
// and the tie goes to the config with the fewest components differing from the
// baseline B, then to the earlier config in the fixed grid order.

import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { appendJsonl, generationKey, readJsonl, MAX_FAILED_ATTEMPTS, PERMANENT_FAILURES } from "./store.js"
import { engineeredConfigs, distanceFromBaseline } from "./cells.js"
import { referenceVerdict, preGrade, verdictKey, judgeConfig, JudgePaused } from "./judge.js"
import { mapLimit } from "./bm25.js"

export const TIE_MARGIN = 0.02
export const MIN_GRADED_SHARE = 0.95

const references = (record) => [record.gold, ...(record.alternates ?? [])]

export async function judgeDevAnswers({ dataDir, cells, store, digests, optsHash, recordByKey, ollamaUrl, log, stopTime = Infinity, concurrency, shouldStop = () => false }) {
    const verdictsPath = join(dataDir, "verdicts.jsonl")
    const judge = judgeConfig("j1")
    // Only graded verdicts count as done: errors and parse failures are retried on
    // the next pass instead of silently lowering the graded share.
    const existing = new Set(readJsonl(verdictsPath, { repair: true }).records.filter((record) => record.type === "verdict" && record.judge === "j1" && record.judgeModel === judge.model && record.verdict).map((record) => record.verdictKey))
    const width = concurrency ?? Number(process.env.POC2_JUDGE_CONCURRENCY ?? 1)
    const tasks = []
    for (const cell of cells) {
        for (const item of cell.items) {
            const answerKey = generationKey(digests.small, optsHash, item.promptSha)
            const answer = store.get(answerKey)
            if (!answer || preGrade(answer)) continue
            const record = recordByKey.get(item.questionKey)
            const key = verdictKey({ questionKey: item.questionKey, references: references(record), answer: answer.answer, judge })
            if (existing.has(key)) continue
            existing.add(key)
            tasks.push({ cell, item, answer, record, key, answerKey })
        }
    }
    log(`[judge] DEV: ${tasks.length} answers to grade with ${judge.model} (concurrency ${width})`)
    let done = 0
    let paused = null
    const stopped = () => shouldStop() || Date.now() > stopTime
    await mapLimit(tasks, width, async (task) => {
        if (stopped()) return
        let result
        for (;;) {
            try {
                result = { ...(await referenceVerdict(judge, { question: task.record.question, references: references(task.record), candidate: task.answer.answer }, { ollamaUrl })), source: "j1" }
                break
            } catch (error) {
                if (!(error instanceof JudgePaused)) {
                    result = { verdict: null, source: "j1", error: error.message.slice(0, 200) }
                    break
                }
                paused = error.message
                if (stopped() || Date.now() + 600_000 > stopTime) return
                log(`[judge] paused: ${error.message.slice(0, 200)}; retrying in 10 min`)
                await delay(600_000)
                if (stopped()) return
            }
        }
        appendJsonl(verdictsPath, {
            type: "verdict", tier: "dev", judge: "j1", judgeModel: judge.model, provider: judge.provider, think: judge.think, verdictKey: task.key,
            questionKey: task.item.questionKey, cellId: task.cell.id, answerKey: task.answerKey, at: new Date().toISOString(), ...result,
        })
        done++
        if (done % 200 === 0) log(`[judge] DEV ${done}/${tasks.length}`)
    })
    return { graded: done, total: tasks.length, paused }
}

// DEV accuracy per config under J1. Verdicts are looked up by verdict key (question,
// references, normalised answer, judge), not by answer key: an identical answer in
// two configs is judged once and counts for both. Pre-graded answers (technical
// failures, abstentions) and answers that failed for good are INCORRECT (ITT).
export function devTable({ dataDir, cells, store, recordByKey, digests, optsHash, maxItems = Infinity }) {
    const judge = judgeConfig("j1")
    const verdicts = new Map()
    for (const record of readJsonl(join(dataDir, "verdicts.jsonl")).records) {
        if (record.type === "verdict" && record.judge === "j1" && record.judgeModel === judge.model && record.verdict) verdicts.set(record.verdictKey, record.verdict)
    }
    const table = {}
    for (const cell of cells) {
        let graded = 0
        let correct = 0
        let excluded = 0
        const items = cell.items.slice(0, maxItems)
        for (const item of items) {
            const answerKey = generationKey(digests.small, optsHash, item.promptSha)
            const answer = store.get(answerKey)
            let verdict = null
            if (!answer) {
                const failure = store.finalFailure?.(answerKey)
                if (failure && PERMANENT_FAILURES.has(failure.status)) {
                    excluded++
                    continue
                }
                if ((store.failures.get(answerKey) ?? 0) >= MAX_FAILED_ATTEMPTS) verdict = "INCORRECT"
            } else {
                const pre = preGrade(answer)
                if (pre) verdict = pre.final
                else {
                    const record = recordByKey.get(item.questionKey)
                    verdict = verdicts.get(verdictKey({ questionKey: item.questionKey, references: references(record), answer: answer.answer, judge })) ?? null
                }
            }
            if (!verdict) continue
            graded++
            if (verdict === "CORRECT") correct++
        }
        table[cell.id] = { n: items.length - excluded, graded, excludedOverflow: excluded, accuracy: graded ? correct / graded : null }
    }
    return table
}

export function selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash, maxItems }) {
    const table = devTable({ dataDir, cells, store, recordByKey, digests, optsHash, maxItems })
    const configById = new Map(cells.map((cell) => [cell.id, cell]))
    const candidates = cells.filter((cell) => cell.id !== "D-B")
    for (const cell of candidates) {
        const row = table[cell.id]
        if (!row.graded || row.graded < MIN_GRADED_SHARE * row.n) return null
    }
    const best = Math.max(...candidates.map((cell) => table[cell.id].accuracy))
    const tied = candidates.filter((cell) => table[cell.id].accuracy >= best - TIE_MARGIN)
    tied.sort((a, b) => distanceFromBaseline(configById.get(a.id)) - distanceFromBaseline(configById.get(b.id)) || cells.indexOf(a) - cells.indexOf(b))
    const chosen = tied[0]
    return {
        estar: chosen.id.replace(/^D-/, ""),
        rule: `max J1 DEV accuracy; ties within ${TIE_MARGIN * 100} pts -> fewest components differing from B -> grid order`,
        table: Object.fromEntries(Object.entries(table).map(([id, row]) => [id, { ...row, accuracy: row.accuracy === null ? null : Number(row.accuracy.toFixed(4)) }])),
        tiedWith: tied.map((cell) => cell.id),
        selectedAt: new Date().toISOString(),
    }
}

export { engineeredConfigs }
