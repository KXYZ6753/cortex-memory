// Comparator tier-A grading for addendum 3 (PREREG-EXPLORE.md §5 fallback, deviation log item 2;
// worker p3). The main study's tier-A TEST verdicts for e2b and 31b P-B are not on this machine,
// so the unchanged comparator answers are graded here by the same tier-A procedure as gates
// (tier-a.js = explore/confirm.js gradeConfirm, parameterised), and the verdicts are appended to
// .data/premise2/explore/confirm/verdicts.jsonl under unitVerdictKey(unit, judge), the file and
// the keys explore/confirm.js analyzeConfirm reads, so the frozen analysis picks them up
// unchanged. explore/ is not modified (its code hash stays addendum 3's).
//
//   node benchmarks/premise2/explore2/confirm-comp.js plan    counts only, no judge call
//   node benchmarks/premise2/explore2/confirm-comp.js grade   J1, J2, adjudication (OpenRouter)
//
// Units: exactly analyzeConfirm's comparators, i.e. gradingUnits(...) filtered to cell "P-B",
// aliases "small" (e2b) and "large" (31b), restricted to the first 600 questions of
// confirmRecords(dataDir, 955) (the agent's 600 TEST questions). Spend: phase "confirm-comp".

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { AnswerStore } from "../store.js"
import { gradingUnits } from "../grade.js"
import { confirmRecords, confirmDirOf } from "../explore/confirm.js"
import { gradeTierA, planTierA } from "./tier-a.js"

export const COMPARATOR_CELL = "P-B"
export const COMPARATOR_ALIASES = ["small", "large"]
export const COMPARATOR_PHASE = "confirm-comp"

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

// The comparator units analyzeConfirm builds (P-B, both aliases), on the first 600 questions.
export function comparatorUnits(dataDir, n = 600) {
    const state = readJson(join(dataDir, "run-state.json"))
    const { cells } = readJson(join(dataDir, "cells.json"))
    const pools = readJson(join(dataDir, "pools.json"))
    const recordByKey = new Map([...pools.dev, ...pools.test, ...pools.bridge].map((record) => [record.questionKey, record]))
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    const first = new Set(confirmRecords(dataDir, 955).slice(0, n).map((record) => record.questionKey))
    return gradingUnits({ cells, state, store, recordByKey })
        .filter((unit) => unit.cellId === COMPARATOR_CELL && COMPARATOR_ALIASES.includes(unit.alias) && first.has(unit.item.questionKey))
}

export const comparatorVerdictsPath = (dataDir) => join(confirmDirOf(dataDir), "verdicts.jsonl")

export function planComparators({ dataDir, log = console.log }) {
    const units = comparatorUnits(dataDir)
    const plan = planTierA({ dataDir, units, verdictsPath: comparatorVerdictsPath(dataDir), adjRate: 0.25 })
    const missing = COMPARATOR_ALIASES.filter((alias) => (plan.groups[alias]?.questions ?? 0) !== 600)
    plan.check = { expectedPerAlias: 600, missing, duplicateUnits: Object.fromEntries(Object.entries(plan.groups).map(([alias, g]) => [alias, g.units - g.questions])) }
    log(JSON.stringify(plan, null, 2))
    return plan
}

export async function gradeComparators({ dataDir, loadCorpus, log = console.log }) {
    const units = comparatorUnits(dataDir)
    const perAlias = Object.fromEntries(COMPARATOR_ALIASES.map((alias) => [alias, units.filter((unit) => unit.alias === alias).length]))
    if (COMPARATOR_ALIASES.some((alias) => perAlias[alias] !== 600)) throw new Error(`expected 600 P-B units per alias, got ${JSON.stringify(perAlias)}; no verdicts were written`)
    return gradeTierA({ dataDir, units, verdictsPath: comparatorVerdictsPath(dataDir), phase: COMPARATOR_PHASE, loadCorpus, label: "confirm-comp", log })
}

// explore/cli.js confirm-grade's corpus loader, unchanged.
export const loadCorpusOf = (dataDir) => async () => {
    const { loadRaw } = await import("../dataset.js")
    const { EvidenceCache } = await import("../evidence.js")
    const raw = await loadRaw(join(dataDir, "hf"))
    const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
    return { emailByPath, evidence: new EvidenceCache(emailByPath) }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    if (existsSync(".env")) process.loadEnvFile(".env")
    const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
    const [command] = process.argv.slice(2)
    try {
        if (command === "plan" || command === "--plan") planComparators({ dataDir })
        else if (command === "grade") await gradeComparators({ dataDir, loadCorpus: loadCorpusOf(dataDir) })
        else throw new Error("usage: confirm-comp.js plan | grade")
    } catch (error) {
        console.error(error?.message ?? error)
        process.exitCode = 1
    }
}
