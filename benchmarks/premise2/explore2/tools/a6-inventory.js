// Worker a6: inventory of stored answers (variant@version x set: n, graded) on the given sets.
//   node benchmarks/premise2/explore2/tools/a6-inventory.js S300-4,S300-5,FULL-2,FULL-3 [variant-substring]
import { openAll } from "./a-lib.js"
import { latestAnswers } from "../../explore/grade.js"
const sets = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3").split(",")
const filt = process.argv[3] ?? ""
const answers = latestAnswers(".data/premise2")
const count = new Map()
for (const a of answers) {
    if (!sets.includes(a.set)) continue
    const k = `${a.variant}@${a.version}`
    if (filt && !k.includes(filt)) continue
    const c = count.get(k) ?? {}
    c[a.set] = (c[a.set] ?? 0) + 1
    count.set(k, c)
}
for (const [k, c] of [...count].sort()) console.log(k.padEnd(40), sets.map((s) => `${s}:${c[s] ?? 0}`).join("  "))
