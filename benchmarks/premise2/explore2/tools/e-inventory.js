// e: inventory of graded variant@version per set (offline; pool records + exploration answers only)
import { latestAnswers } from "../../explore/grade.js"
import { openAll, weightedOf } from "./a-lib.js"
const { graded, missShare } = await openAll()
const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["S300-2", "S300-1"]
const all = latestAnswers(".data/premise2")
for (const s of sets) {
    const vs = new Map()
    for (const a of all) if (a.set === s && a.alias === "small") vs.set(`${a.variant}@${a.version}`, (vs.get(`${a.variant}@${a.version}`) ?? 0) + 1)
    console.log(`== ${s}`)
    const rows = []
    for (const [v, n] of vs) {
        if (n < 290) continue
        const g = graded(v, s).filter((i) => i.correct != null)
        if (g.length < n * 0.97) { rows.push(`${v.padEnd(22)} n ${n} graded ${g.length}`); continue }
        const w = weightedOf(g, missShare)
        rows.push(`${v.padEnd(22)} n ${n} graded ${g.length}  W ${(100 * w.weighted).toFixed(1)} miss ${(100 * w.miss).toFixed(1)} hit ${(100 * w.hit).toFixed(1)}`)
    }
    console.log(rows.sort().join("\n"))
}
