// Worker x: k3 "nofound" episodes: was an opened AB email in the final context?
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
for (const set of ["S300-2", "S300-1"]) {
    const K = graded("k3@1+cold", set), G = new Map(graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
    const c = {}
    const inc = (f) => (c[f] = (c[f] ?? 0) + 1)
    for (const k of K) {
        if (k.answer.step !== "nofound") continue
        const ab = bearing(k.record), st = k.record.stratum
        const opened = k.answer.openedPaths ?? []
        const final = k.answer.contextPaths
        inc(`${st}:n`)
        const abOpenIdx = opened.findIndex(ab)
        if (abOpenIdx >= 0) { inc(`${st}:abOpened@${abOpenIdx}`); if (k.correct) inc(`${st}:abOpened_ok`) }
        if (final.some(ab)) inc(`${st}:abInFinal`), k.correct && inc(`${st}:abInFinal_ok`)
        if (final.slice(0, 4).some(ab)) inc(`${st}:abInW0top4`)
        inc(`${st}:opens${opened.length}`)
    }
    console.log(set, c)
}
process.exit(0)
