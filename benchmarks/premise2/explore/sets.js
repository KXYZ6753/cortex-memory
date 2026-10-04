// Screening sets drawn from the frozen exploration pool (explore-plan.md §6).
//
// Each set is drawn once, saved immutably, and its questions are registered so no
// later set reuses them. A set also claims its emails and their twin groups, so two
// sets never share an email (a new question on an already-seen email would not be
// fresh evidence). Draws are round-robin across mailboxes within inbox-size strata
// (dataset.js roundRobin), separately for the miss and hit strata.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { roundRobin } from "../dataset.js"
import { keyedRandom, fnv1a32, sha256 } from "../text.js"
import { exploreDirOf, loadGuard, assertExplorable, SEED } from "./pool.js"

export const SET_SIZES = {
    S100: { miss: 50, hit: 50 },
    S300: { miss: 100, hit: 200 },
    FULL: { miss: 150, hit: 450 },
}

const setsDir = (dataDir) => join(exploreDirOf(dataDir), "sets")
const registryPath = (dataDir) => join(setsDir(dataDir), "registry.json")

export function loadRegistry(dataDir) {
    const path = registryPath(dataDir)
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { sets: [], questionKeys: [], paths: [] }
}

const groupOf = (record) => [record.path, ...(record.twins ?? []), ...(record.nearDups ?? [])]

// Pure draw: `records` are pool records, `claimed` a Set of emails already used.
// Returns the chosen records in draw order; mutates `claimed`.
export function drawFrom(records, { miss, hit }, { claimed, usedKeys, seed, quintileOf }) {
    const chosen = []
    for (const [stratum, quota] of [["miss", miss], ["hit", hit]]) {
        const pool = records.filter((record) => record.stratum === stratum && !usedKeys.has(record.questionKey))
        // One random question per email first, so an email with many questions is not
        // over-represented; roundRobin then balances mailboxes.
        const perEmail = new Map()
        for (const record of pool) {
            const r = keyedRandom(seed, `pick:${record.questionKey}`)()
            const best = perEmail.get(record.path)
            if (!best || r < best.r) perEmail.set(record.path, { r, record })
        }
        const ordered = roundRobin([...perEmail.values()].map((entry) => entry.record), quintileOf, seed)
        let taken = 0
        for (const record of ordered) {
            if (taken >= quota) break
            if (groupOf(record).some((path) => claimed.has(path))) continue
            for (const path of groupOf(record)) claimed.add(path)
            chosen.push(record)
            taken++
        }
        if (taken < quota) throw new Error(`only ${taken} of ${quota} ${stratum} questions available`)
    }
    return chosen
}

export function drawSet({ dataDir, name, kind, pool }) {
    const sizes = SET_SIZES[kind]
    if (!sizes) throw new Error(`unknown set kind ${kind}`)
    mkdirSync(setsDir(dataDir), { recursive: true })
    const path = join(setsDir(dataDir), `${name}.json`)
    if (existsSync(path)) throw new Error(`set ${name} already exists; sets are immutable`)
    const registry = loadRegistry(dataDir)
    const guard = loadGuard(dataDir)
    const quintileOf = new Map(pool.records.map((record) => [record.user, record.quintile]))
    const claimed = new Set(registry.paths)
    const usedKeys = new Set(registry.questionKeys)
    const seed = (SEED ^ fnv1a32(`set:${name}`)) >>> 0
    const chosen = drawFrom(pool.records, sizes, { claimed, usedKeys, seed, quintileOf })
    for (const record of chosen) assertExplorable(record, guard)
    const set = {
        name, kind, createdAt: new Date().toISOString(), seed,
        poolHash: pool.manifest.hashes.pool,
        missShare: pool.manifest.strata.missShare,
        counts: { miss: sizes.miss, hit: sizes.hit, mailboxes: new Set(chosen.map((record) => record.user)).size },
        questionKeys: chosen.map((record) => record.questionKey),
    }
    set.hash = sha256(JSON.stringify(set.questionKeys))
    writeFileSync(path, JSON.stringify(set, null, 2))
    registry.sets.push({ name, kind, hash: set.hash, createdAt: set.createdAt })
    registry.questionKeys.push(...set.questionKeys)
    registry.paths = [...claimed]
    writeFileSync(registryPath(dataDir), JSON.stringify(registry))
    return set
}

export function loadSet(dataDir, name, pool) {
    const set = JSON.parse(readFileSync(join(setsDir(dataDir), `${name}.json`), "utf8"))
    if (sha256(JSON.stringify(set.questionKeys)) !== set.hash) throw new Error(`set ${name} does not match its hash`)
    if (pool && set.poolHash !== pool.manifest.hashes.pool) throw new Error(`set ${name} was drawn from a different pool`)
    return set
}
