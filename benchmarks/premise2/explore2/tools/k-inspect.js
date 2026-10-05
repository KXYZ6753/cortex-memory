// Worker k: behaviour stats of a k agent on a set (works before grading; verdict
// columns fill in once graded). node benchmarks/premise2/explore2/tools/k-inspect.js S300-2 k1 [ref]
import { openAll, weightedOf } from "./a-lib.js"
const [setName = "S300-2", variant = "k1", ref = "gates"] = process.argv.slice(2)
const { graded, bearing, missShare } = await openAll()
const pick = (id) => { const m = new Map(); for (const i of graded(id, setName)) m.set(i.record.questionKey, i); return m }
// find version automatically
import { latestAnswers } from "../../explore/grade.js"
const versions = new Set(latestAnswers(".data/premise2").filter((a) => a.variant === variant && a.set === setName).map((a) => a.version))
const ver = [...versions].sort().pop()
const refVer = [...new Set(latestAnswers(".data/premise2").filter((a) => a.variant === ref && a.set === setName).map((a) => a.version))].sort().pop()
const items = pick(`${variant}@${ver}`), refs = pick(`${ref}@${refVer}`)
const T = {}
const add = (k, f, v = 1) => { T[k] ??= {}; T[k][f] = (T[k][f] ?? 0) + v }
let wall = 0, calls = 0, n = 0
const S = { checks: 0, picks: 0, searches: 0, opens: 0, listShownAB: 0, pickedABwhenShown: 0, openedAB: 0, foundAB: 0, found: 0, finalAB: 0, finalAB1: 0, commitNoAB: 0, arena: 0 }
for (const [key, it] of items) {
    const a = it.answer, isAB = bearing(it.record), st = it.record.stratum
    n++; wall += a.wallMs; calls += a.calls
    const log = a.log ?? []
    const stepKey = `${st} ${a.step}`
    add(stepKey, "n"); if (it.correct !== null) add(stepKey, "ok", it.correct)
    const r = refs.get(key); if (r?.correct !== null && r) add(stepKey, ref, r.correct)
    if (r && it.correct !== null && r.correct !== null) { if (it.correct && !r.correct) add(stepKey, "+"); if (!it.correct && r.correct) add(stepKey, "-") }
    S.checks += log.filter((l) => l.act.startsWith("check")).length
    const picks = log.filter((l) => l.act === "pick"); S.picks += picks.length
    S.searches += log.filter((l) => l.act === "search").length
    S.opens += (a.openedPaths ?? []).length
    if (a.step !== "commit") {
        S.arena++
        const shownAB = picks.some((p) => p.listed?.some(isAB)); if (shownAB) { S.listShownAB++; if (picks.some((p) => p.path && isAB(p.path))) S.pickedABwhenShown++ }
        if ((a.openedPaths ?? []).some(isAB)) S.openedAB++
        if (a.foundPath) { S.found++; if (isAB(a.foundPath)) S.foundAB++ }
        if (a.contextPaths.some(isAB)) S.finalAB++
    } else if (!a.contextPaths.some(isAB)) S.commitNoAB++
    if (isAB(a.contextPaths[0])) S.finalAB1++
}
console.log(`${variant}@${ver} on ${setName}: n=${n} wall ${Math.round(wall / n)} ms, calls ${(calls / n).toFixed(2)}`)
console.log(S)
console.table(T)
const g = [...items.values()].filter((i) => i.correct !== null)
if (g.length === items.size) { const w = weightedOf(g, missShare); console.log(`weighted ${(100 * w.weighted).toFixed(1)} miss ${(100 * w.miss).toFixed(1)} hit ${(100 * w.hit).toFixed(1)}`) }
process.exit(0)
