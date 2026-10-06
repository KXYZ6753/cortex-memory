// Worker m: x1 explore-path misses: was AB listed, picked, probed YES/NO, at which list position.
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
for (const set of ["S300-2", "S300-1", "FULL-0"]) {
    const t = {}
    const add = (k) => (t[k] = (t[k] ?? 0) + 1)
    const pos = []
    for (const it of graded("x1@1+cold", set)) {
        const a = it.answer
        if (a.step?.startsWith("commit")) continue
        const ab = bearing(it.record), log = a.log ?? []
        const picks = log.filter((l) => l.act === "pick")
        const checks = log.filter((l) => l.act === "check").slice(5)
        const listedAB = picks.some((p) => (p.listed ?? []).some(ab))
        const pickedAB = picks.some((p) => p.path && ab(p.path))
        const abNo = checks.some((c) => ab(c.path) && !c.yes)
        const firstList = picks[0]?.listed ?? []
        const i = firstList.findIndex(ab)
        if (i >= 0) pos.push(i + 1)
        const k = `${it.record.stratum} ${it.correct ? "ok " : "bad"} ${a.step.padEnd(7)} listedAB ${+listedAB} pickedAB ${+pickedAB} abProbedNO ${+abNo} opens ${checks.length}`
        add(k)
    }
    console.log(`\n== ${set}`)
    for (const [k, v] of Object.entries(t).sort()) if (k.startsWith("miss")) console.log(`  ${k}  ${v}`)
    console.log(`  AB position in first list (when listed): ${pos.sort((a, b) => a - b).join(",")}`)
}
process.exit(0)
