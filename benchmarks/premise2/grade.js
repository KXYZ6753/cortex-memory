// TEST grading, run once after all generation has ended (Mac or Windows; it loads no
// generator). Resumable and pause-tolerant.
//
//   1. deterministic pre-grade: technical failures and exact abstentions
//   2. J1 on every answer (tier A and B)
//   3. J2 on tier A plus a seeded 20% of tier B (agreement estimate)
//   4. blind adjudication (third family) on tier A: J1 != J2, consensus-INCORRECT
//      non-abstains, and a seeded 10% of consensus-CORRECT; quotes must verify
//      against the gold, its twins or answer-bearing emails only
//   5. an anchor set of 200 tier-A answers re-judged by J1 in every session (drift)
//
// Every call's verdict is appended to verdicts.jsonl; a verdict key already present
// with a verdict is never re-requested, and errors are retried in the next session.

import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"
import { AnswerStore, appendJsonl, generationKey, optionsHash, readJsonl } from "./store.js"
import { referenceVerdict, adjudicate, preGrade, verdictKey, judgeConfig, callJudge, inCorrectAudit, JudgePaused, JudgeAuthError } from "./judge.js"
import { JUDGES, testCells } from "./cells.js"
import { mapLimit } from "./bm25.js"
import { keyedRandom, shuffleInPlace, splitmix32 } from "./text.js"

export const TIER_A_ROLES = new Set(["primary", "secondary", "diagnostic", "bridge"])
export const J2_SAMPLE_RATE = 0.2
export const ANCHOR_SIZE = 200
export const DEV_TIER_A_TOP = 3
const SEED = 42

export const referencesOf = (record) => [record.gold, ...(record.alternates ?? [])]

// Everything that was generated and must be graded, one unit per (cell, model,
// question). P-Estar is materialised from the selected E* candidate cell.
// P-Estar has no items of its own in cells.json (its items are the selected E*
// candidate's), so it is added from the cell catalog when missing.
export function withEstarCell(cells) {
    if (cells.some((cell) => cell.estar)) return cells
    return [...cells, testCells().find((cell) => cell.estar)]
}

export function gradingUnits({ cells: listed, state, store, recordByKey }) {
    const cells = withEstarCell(listed)
    const digests = state.provenance.digests
    const optsHash = optionsHash(state.provenance.options)
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const devTop = new Set(Object.entries(state.estar?.table ?? {})
        .filter(([id, row]) => id !== "D-B" && row.accuracy !== null)
        .sort((a, b) => b[1].accuracy - a[1].accuracy)
        .slice(0, DEV_TIER_A_TOP)
        .map(([id]) => id))
    devTop.add("D-B")
    const graded = []
    for (const cell of cells) {
        if (cell.role === "probe" || cell.role === "estar-candidate") continue
        let source = cell
        if (cell.estar) {
            if (!state.estar) continue
            const candidate = cellById.get(`E-${state.estar.estar}`)
            if (!candidate) continue
            source = { ...candidate, id: cell.id, role: cell.role, models: cell.models }
        }
        const tier = cell.role === "dev" ? (devTop.has(cell.id) ? "A" : "B") : TIER_A_ROLES.has(cell.role) ? "A" : "B"
        for (const [alias, n] of Object.entries(source.models ?? {})) {
            if (!digests[alias]) continue
            const items = n == null ? source.items : source.items.slice(0, n)
            for (const item of items) {
                const answerKey = generationKey(digests[alias], optsHash, item.promptSha)
                const answer = store.get(answerKey)
                if (!answer) continue
                graded.push({ cellId: cell.id, role: cell.role, tier, alias, item, answerKey, answer, record: recordByKey.get(item.questionKey) })
            }
        }
    }
    return graded
}

export const j2Sampled = (unit) => unit.tier === "A" || keyedRandom(SEED, `j2:${unit.cellId}|${unit.alias}|${unit.item.questionKey}`)() < J2_SAMPLE_RATE

export const unitVerdictKey = (unit, judge) => verdictKey({
    questionKey: unit.item.questionKey,
    references: referencesOf(unit.record),
    answer: unit.answer.answer,
    judge,
    promptSha: judge.role === "adj" ? unit.item.promptSha : null,
})

// Latest graded verdict per key for one judge role and model.
export function verdictIndex(records, role, model) {
    const index = new Map()
    for (const record of records) {
        if (record.type !== "verdict" || record.judge !== role || !record.verdict) continue
        if (model && record.judgeModel !== model) continue
        index.set(record.verdictKey, record)
    }
    return index
}

export async function grade({ dataDir, ollamaUrl = "http://localhost:11434", log = console.log, stopAt, loadCorpus }) {
    const statePath = join(dataDir, "run-state.json")
    if (!existsSync(statePath)) throw new Error("run-state.json missing: grade runs after the generation run")
    const state = JSON.parse(readFileSync(statePath, "utf8"))
    const { cells } = JSON.parse(readFileSync(join(dataDir, "cells.json"), "utf8"))
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const recordByKey = new Map([...pools.dev, ...pools.test, ...pools.bridge].map((record) => [record.questionKey, record]))
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    const verdictsPath = join(dataDir, "verdicts.jsonl")
    const stopTime = stopAt ? new Date(stopAt).getTime() : Infinity
    if (Number.isNaN(stopTime)) throw new Error(`POC2_STOP_AT is not a valid time: ${stopAt}`)
    const width = Number(process.env.POC2_JUDGE_CONCURRENCY ?? state.probe?.judgeConcurrency ?? 1)
    const session = process.env.POC2_GRADE_SESSION ?? new Date().toISOString().slice(0, 10)

    const units = gradingUnits({ cells, state, store, recordByKey })
    // Seeded random order within priority groups (primaries, then the rest of tier
    // A, then tier B): every model of a cell sits in the same group, so judge drift is
    // balanced within each contrast, and a pass cut short by usage limits still
    // covers the confirmatory contrasts first.
    const random = splitmix32(SEED)
    shuffleInPlace(units, random)
    const priority = (unit) => (unit.role === "primary" ? 0 : unit.tier === "A" ? 1 : 2)
    units.sort((a, b) => priority(a) - priority(b))
    const pre = new Map(units.map((unit) => [unit, preGrade(unit.answer)]))
    const judgeable = units.filter((unit) => !pre.get(unit))
    log(`[grade] ${units.length} units (${units.filter((u) => u.tier === "A").length} tier A), ${units.length - judgeable.length} pre-graded (technical or abstain); concurrency ${width}; session ${session}`)

    let records = readJsonl(verdictsPath, { repair: true }).records
    const paused = { value: null }

    // Runs one judge over units, skipping keys that already have a verdict.
    const pass = async (label, judge, selected, call) => {
        const have = new Set(verdictIndex(records, judge.role, judge.model).keys())
        const seen = new Set()
        const tasks = []
        for (const unit of selected) {
            const key = unitVerdictKey(unit, judge)
            if (have.has(key) || seen.has(key)) continue
            seen.add(key)
            tasks.push({ unit, key })
        }
        log(`[grade] ${label}: ${tasks.length} calls to ${judge.model} (${selected.length} units)`)
        let done = 0
        let errors = 0
        await mapLimit(tasks, width, async ({ unit, key }) => {
            if (Date.now() > stopTime || paused.auth) return
            let result
            for (;;) {
                try {
                    result = await call(unit)
                    break
                } catch (error) {
                    if (!(error instanceof JudgePaused)) {
                        result = { verdict: null, error: error.message.slice(0, 200) }
                        errors++
                        break
                    }
                    paused.value = error.message
                    if (error instanceof JudgeAuthError) {
                        if (!paused.auth) log(`[grade] stopping: ${error.message.slice(0, 200)}`)
                        paused.auth = true
                        return
                    }
                    if (Date.now() + 600_000 > stopTime) return
                    log(`[grade] paused: ${error.message.slice(0, 160)}; retrying in 10 min`)
                    await delay(600_000)
                }
            }
            const verdict = {
                type: "verdict", tier: "test", judge: judge.role, judgeModel: judge.model, provider: judge.provider, think: judge.think,
                verdictKey: key, questionKey: unit.item.questionKey, cellId: unit.cellId, alias: unit.alias, answerKey: unit.answerKey,
                promptSha: judge.role === "adj" ? unit.item.promptSha : undefined, session, at: new Date().toISOString(), ...result,
            }
            appendJsonl(verdictsPath, verdict)
            records.push(verdict)
            done++
            if (done % 250 === 0) log(`[grade] ${label} ${done}/${tasks.length}${errors ? ` (${errors} errors)` : ""}`)
        })
        log(`[grade] ${label} complete: ${done} judged, ${errors} errors`)
        return { calls: tasks.length, done, errors }
    }

    const item = (unit) => ({ question: unit.record.question, references: referencesOf(unit.record), candidate: unit.answer.answer })
    const summary = { session, units: units.length }

    // ---- anchor set: J1 test-retest across sessions ----
    const j1 = judgeConfig("j1")
    const anchors = units.filter((unit) => unit.tier === "A" && !pre.get(unit)).slice(0, ANCHOR_SIZE)
    const anchorDone = new Set(records.filter((record) => record.type === "anchor" && record.session === session && record.verdict).map((record) => record.verdictKey))
    const anchorTasks = anchors.filter((unit) => !anchorDone.has(unitVerdictKey(unit, j1)))
    if (anchorTasks.length) {
        log(`[grade] anchor set: ${anchorTasks.length} J1 re-judgements for session ${session}`)
        await mapLimit(anchorTasks, width, async (unit) => {
            try {
                const result = await referenceVerdict(j1, item(unit), { ollamaUrl })
                const record = { type: "anchor", session, judge: "j1", judgeModel: j1.model, verdictKey: unitVerdictKey(unit, j1), questionKey: unit.item.questionKey, at: new Date().toISOString(), ...result }
                appendJsonl(verdictsPath, record)
                records.push(record)
            } catch (error) {
                if (error instanceof JudgePaused) paused.value = error.message
            }
        })
    }

    // ---- J1 on everything, J2 on tier A + sample ----
    summary.j1 = await pass("J1", j1, judgeable, (unit) => referenceVerdict(j1, item(unit), { ollamaUrl }))
    if (Date.now() > stopTime) return { ...summary, stopped: "time", paused: paused.value }
    const j2 = judgeConfig("j2")
    summary.j2 = await pass("J2", j2, judgeable.filter(j2Sampled), (unit) => referenceVerdict(j2, item(unit), { ollamaUrl }))
    if (Date.now() > stopTime) return { ...summary, stopped: "time", paused: paused.value }

    // ---- adjudication on tier A ----
    const j1Index = verdictIndex(records, "j1", j1.model)
    const j2Index = verdictIndex(records, "j2", j2.model)
    const toAdjudicate = []
    for (const unit of judgeable) {
        if (unit.tier !== "A") continue
        const v1 = j1Index.get(unitVerdictKey(unit, j1))?.verdict
        const v2 = j2Index.get(unitVerdictKey(unit, j2))?.verdict
        if (!v1 || !v2) continue
        if (v1 !== v2 || v1 === "INCORRECT" || inCorrectAudit(`${unit.cellId}|${unit.alias}|${unit.item.questionKey}`)) toAdjudicate.push(unit)
    }
    // The adjudicator is the first model of the chain that answers now (or the env
    // override). If none answers (e.g. every third-family model needs paid credits),
    // adjudication is skipped and the report uses the J1/J2 consensus.
    let adj = null
    const chain = process.env.POC2_ADJ_MODEL ? [process.env.POC2_ADJ_MODEL] : JUDGES.adjudicator.chain
    for (const model of chain) {
        const candidate = { ...judgeConfig("adj"), model }
        const ok = await callJudge(candidate, 'Reply with JSON only: {"ping": true}', undefined, { ollamaUrl, timeoutMs: 90_000 }).then(() => true, (error) => {
            log(`[grade] adjudicator ${model} unavailable: ${error.message.slice(0, 120)}`)
            return false
        })
        if (ok) {
            adj = candidate
            break
        }
    }
    if (!adj && toAdjudicate.length) log(`[grade] WARNING no adjudicator available; ${toAdjudicate.length} tier-A answers keep their J1/J2 consensus (disagreements stay unresolved)`)
    if (adj && toAdjudicate.length) {
        const { emailByPath, evidence } = await loadCorpus()
        const supporting = (unit) => {
            const record = unit.record
            const paths = new Set([record.path, ...(record.twins ?? [])])
            for (const path of unit.item.paths ?? []) if (!paths.has(path) && evidence.answerBearing(path, record) === true) paths.add(path)
            return [...paths].map((path) => emailByPath.get(path)).filter(Boolean)
        }
        const shown = (unit) => {
            const paths = unit.item.paths?.length ? unit.item.paths : [unit.record.path]
            return paths.map((path) => emailByPath.get(path) ?? "")
        }
        summary.adjudicator = adj.model
        summary.adjudication = await pass("adjudication", adj, toAdjudicate, (unit) => adjudicate(adj, { ...item(unit), emails: shown(unit) }, supporting(unit), { ollamaUrl }))
    }
    return { ...summary, paused: paused.value, stopped: null }
}
