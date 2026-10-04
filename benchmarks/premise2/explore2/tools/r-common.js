// Shared loaders for the r-* offline retrieval tools (exploration phase 2, retrieval
// engineer). Pool records only; the dev question set is FULL-0 + S300-1 + S100-0..9.
// S300-2 (screening), S300-3 and FULL-1 (lead's confirmation) are never used for tuning.

import { join } from "node:path"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { loadPool, loadGuard, assertExplorable } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { ensureEmailStore } from "../../agent-run.js"
import { openBm25 } from "../../bm25.js"
import { EvidenceCache } from "../../evidence.js"

export const DATA_DIR = ".data/premise2"
export const DEV_SETS = ["FULL-0", "S300-1", ...Array.from({ length: 10 }, (_, i) => `S100-${i}`)]
export const HELD_OUT = new Set(["S300-2", "S300-3", "FULL-1"])
export const SCRATCH = process.env.R_SCRATCH ?? "C:/Users/Kerem/AppData/Local/Temp/claude/C--Users-Kerem-code-cortex-memory/e3b3b9cc-fd3b-40c4-81c7-69f7f03fda02/scratchpad"

export async function openAll({ sets = DEV_SETS, log = () => {} } = {}) {
    const pool = loadPool(DATA_DIR)
    const guard = loadGuard(DATA_DIR)
    const keys = []
    const setOf = new Map()
    for (const name of sets) {
        if (HELD_OUT.has(name) && !process.env.R_ALLOW_HELDOUT) throw new Error(`${name} is held out`)
        for (const key of loadSet(DATA_DIR, name, pool).questionKeys) if (!setOf.has(key)) { setOf.set(key, name); keys.push(key) }
    }
    const records = keys.map((key) => pool.byKey.get(key))
    for (const record of records) assertExplorable(record, guard)
    const emails = await ensureEmailStore(DATA_DIR, join(DATA_DIR, "agent"), log)
    const bm25 = openBm25(join(DATA_DIR, "corpus.sqlite"))
    const evidence = new EvidenceCache({ get: emails.emailOf })
    const answerBearing = (record, path) => path === record.path || (record.twins ?? []).includes(path) || evidence.answerBearing(path, record) === true
    return { pool, records, setOf, emails, emailOf: emails.emailOf, bm25, answerBearing, missShare: pool.manifest.strata.missShare }
}

export const readJsonIf = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback)
export const writeJsonFile = (path, value) => writeFileSync(path, JSON.stringify(value))
