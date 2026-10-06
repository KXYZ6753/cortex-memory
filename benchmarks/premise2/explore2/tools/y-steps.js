// Worker y: route counts, add-on firing, wall and calls of stored y answers on a set (no verdicts).
//   node benchmarks/premise2/explore2/tools/y-steps.js S100-3 y1,y2
import { latestAnswers } from "../../explore/grade.js"
const [set, ids = "y1,y2"] = process.argv.slice(2)
const answers = latestAnswers(".data/premise2")
for (const id of ids.split(",")) {
    const a = answers.filter((x) => x.variant === id && x.set === set)
    if (!a.length) { console.log(`${id}: none`); continue }
    const steps = {}, flags = { m2Fired: 0, recovered: 0, j2Fired: 0, relonged: 0, errors: 0 }
    for (const x of a) {
        steps[x.step] = (steps[x.step] ?? 0) + 1
        if (x.y?.m2Fired) flags.m2Fired++
        if (x.y?.recovered) flags.recovered++
        if (x.y?.j2Fired) flags.j2Fired++
        if (x.relonged) flags.relonged++
        if (x.status !== "ok") flags.errors++
    }
    const mean = (l) => l.reduce((s, v) => s + v, 0) / l.length
    console.log(`${id} v${a[0].version} n ${a.length} wall ${Math.round(mean(a.map((x) => x.wallMs)))} calls ${mean(a.map((x) => x.calls)).toFixed(2)} steps ${JSON.stringify(steps)} ${JSON.stringify(flags)}`)
}
process.exit(0)
