// Worker q8 (round 6): inventory of stored answers relevant to the precision diagnostic.
//
//   node benchmarks/premise2/explore2/tools/q8-inventory.js [regex]
//
// Streams .data/premise2/explore/answers.jsonl (the exploration store only; TEST answers
// live in other directories and are never opened) and counts final answers per
// (set, variant@version, alias, digest prefix, det mode) for variants matching the regex
// (default: oracle|perfect|det). Only development sets are counted: H6-C, DEMO-* and any
// set name starting with TEST are skipped before the record is used.

import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { FINAL_STATUSES } from "../../explore/run.js"

const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const pattern = new RegExp(process.argv[2] ?? "oracle|perfect|det", "i")
const DEV = /^(S100-\d|S300-[1-5]|FULL-[0-3]|H6-D)$/

const counts = new Map()
const lines = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of lines) {
    if (!line) continue
    // Cheap pre-filter on the set name before parsing.
    const setMatch = line.match(/"set":"([^"]+)"/)
    if (!setMatch || !DEV.test(setMatch[1])) continue
    const variantMatch = line.match(/"variant":"([^"]+)"/)
    if (!variantMatch || !pattern.test(variantMatch[1])) continue
    let record
    try { record = JSON.parse(line) } catch { continue }
    if (!FINAL_STATUSES.has(record.status)) continue
    const id = `${record.set}\t${record.variant}@${record.version}\t${record.alias}\t${String(record.digest).slice(0, 8)}\t${record.det?.mode ?? "-"}`
    const entry = counts.get(id) ?? { keys: new Set(), hit: new Set(), miss: new Set(), wall: 0, n: 0 }
    entry.keys.add(record.questionKey)
    entry[record.stratum]?.add(record.questionKey)
    entry.wall += record.wallMs ?? 0
    entry.n++
    counts.set(id, entry)
}
console.log("set\tvariant@version\talias\tdigest\tdet\tquestions\thit\tmiss\tmeanWallMs")
for (const [id, entry] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${id}\t${entry.keys.size}\t${entry.hit.size}\t${entry.miss.size}\t${Math.round(entry.wall / entry.n)}`)
}
