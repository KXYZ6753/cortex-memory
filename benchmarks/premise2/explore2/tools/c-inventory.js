// Worker c: which variants have stored answers (and grades) on which sets. Offline.
//   node benchmarks/premise2/explore2/tools/c-inventory.js [variant,variant]
import { latestAnswers } from "../../explore/grade.js"
import { dataDir } from "./n-lib.js"
const want = process.argv[2] ? process.argv[2].split(",") : null
const count = new Map()
for (const a of latestAnswers(dataDir)) {
    if (a.alias !== "small") continue
    if (want && !want.includes(a.variant)) continue
    const k = `${a.variant}\t${a.set}`
    count.set(k, (count.get(k) ?? 0) + 1)
}
for (const [k, n] of [...count].sort()) console.log(`${k}\t${n}`)
