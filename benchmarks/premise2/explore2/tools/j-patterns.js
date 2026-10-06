// Worker j: accuracy of surface patterns in answers, over every graded variant's answers
// on the given sets (hit and miss separately). Finds answer shapes that are reliably
// wrong (candidates for a targeted second pass) and checks how often a pattern occurs.
//   node benchmarks/premise2/explore2/tools/j-patterns.js FULL-0 S300-1 S300-2
import { pool, loadTable } from "./n-lib.js"
import { PATTERNS } from "./j-lib.js"


const sets = process.argv.slice(2)
const stats = new Map()
let truncated = { n: 0, right: 0 }
for (const setName of sets) {
    const { table, keys } = loadTable(setName)
    const keySet = new Set(keys)
    for (const [variant, rows] of table) {
        if (variant === "oracles") continue
        for (const [key, row] of rows) {
            if (!keySet.has(key) || row.correct === null) continue
            const r = pool.byKey.get(key)
            const t = String(row.answer ?? "")
            if (row.a.status === "output_limit" && r.stratum === "hit") { truncated.n++; truncated.right += row.correct }
            for (const [name, test] of Object.entries({ all: () => true, ...PATTERNS })) {
                const id = `${r.stratum}\t${name}`
                const s = stats.get(id) ?? { n: 0, right: 0 }
                if (test(t)) { s.n++; s.right += row.correct }
                stats.set(id, s)
            }
        }
    }
}
console.log("stratum\tpattern\tn\tacc")
for (const [id, s] of [...stats].sort()) console.log(`${id}\t${s.n}\t${s.n ? (100 * s.right / s.n).toFixed(1) : "-"}`)
console.log(`hit output_limit: n ${truncated.n}, acc ${(100 * truncated.right / Math.max(1, truncated.n)).toFixed(1)}`)
