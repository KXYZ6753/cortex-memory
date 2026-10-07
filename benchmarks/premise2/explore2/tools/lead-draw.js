// Round 6: draws a fresh, registered set with custom stratum sizes (the stratified
// S300/FULL draws fail once the miss stratum is exhausted). Same rules as
// explore/sets.js drawSet: email- and twin-disjoint from every earlier set, round-robin
// across mailboxes, immutable, registered. Dry run unless --write.
//   node benchmarks/premise2/explore2/tools/lead-draw.js <name> <miss> <hit> [--write]
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { drawFrom, loadRegistry } from "../../explore/sets.js"
import { loadPool, loadGuard, assertExplorable, exploreDirOf, SEED } from "../../explore/pool.js"
import { fnv1a32, sha256 } from "../../text.js"

const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const [name, missArg, hitArg, flag] = process.argv.slice(2)
const sizes = { miss: Number(missArg), hit: Number(hitArg) }
const pool = loadPool(dataDir)
const registry = loadRegistry(dataDir)
const guard = loadGuard(dataDir)
const quintileOf = new Map(pool.records.map((record) => [record.user, record.quintile]))
const claimed = new Set(registry.paths)
const usedKeys = new Set(registry.questionKeys)
const seed = (SEED ^ fnv1a32(`set:${name}`)) >>> 0
const chosen = drawFrom(pool.records, sizes, { claimed, usedKeys, seed, quintileOf })
for (const record of chosen) assertExplorable(record, guard)
const mailboxes = new Set(chosen.map((record) => record.user)).size
console.log(`[lead-draw] ${name}: ${chosen.length} questions (miss ${sizes.miss}, hit ${sizes.hit}) from ${mailboxes} mailboxes`)
if (flag === "--write") {
    const setsDir = join(exploreDirOf(dataDir), "sets")
    const path = join(setsDir, `${name}.json`)
    if (existsSync(path)) throw new Error(`set ${name} already exists; sets are immutable`)
    const set = {
        name, kind: `custom-${sizes.miss}m-${sizes.hit}h`, createdAt: new Date().toISOString(), seed,
        poolHash: pool.manifest.hashes.pool,
        missShare: pool.manifest.strata.missShare,
        counts: { miss: sizes.miss, hit: sizes.hit, mailboxes },
        questionKeys: chosen.map((record) => record.questionKey),
    }
    set.hash = sha256(JSON.stringify(set.questionKeys))
    writeFileSync(path, JSON.stringify(set, null, 2))
    registry.sets.push({ name, kind: set.kind, hash: set.hash, createdAt: set.createdAt })
    registry.questionKeys.push(...set.questionKeys)
    registry.paths = [...claimed]
    writeFileSync(join(setsDir, "registry.json"), JSON.stringify(registry))
    console.log(`[lead-draw] written ${path} (hash ${set.hash.slice(0, 12)})`)
}
