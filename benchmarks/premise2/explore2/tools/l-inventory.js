// Worker l: inventory of stored, graded answers per variant@version on the dev sets.
//   node benchmarks/premise2/explore2/tools/l-inventory.js [sets]
import { openAll } from "./a-lib.js"
import { latestAnswers } from "../../explore/grade.js"

const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,FULL-1").split(",")
const { graded } = await openAll()
const answers = latestAnswers(".data/premise2")
const vv = new Map()
for (const a of answers) if (sets.includes(a.set)) { const k = `${a.variant}@${a.version}`; if (!vv.has(k)) vv.set(k, new Set()); vv.get(k).add(a.set) }
const rows = []
for (const [k, ss] of vv) {
    const cells = []
    for (const s of sets) {
        if (!ss.has(s)) { cells.push("-"); continue }
        const items = graded(k, s)
        const g = items.filter((i) => i.correct !== null).length
        cells.push(`${g}/${items.length}`)
    }
    rows.push([k, ...cells])
}
rows.sort((a, b) => a[0].localeCompare(b[0]))
console.log(["variant@version", ...sets].join("\t"))
for (const r of rows) console.log(r.join("\t"))
