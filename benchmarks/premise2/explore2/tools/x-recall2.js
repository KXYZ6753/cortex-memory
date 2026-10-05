// Worker x: does g5's own-query search surface AB emails that k3's explore never reached?
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
for (const set of ["S300-2", "S300-1"]) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const K = load("k3@1+cold"), A = load("g5@1+cold")
    const c = {}
    for (const [key, k] of K) {
        if (k.record.stratum !== "miss" || k.answer.step === "commit") continue
        const ab = bearing(k.record), a = A.get(key), log = k.answer.log ?? []
        const kSeen = new Set([...(k.answer.log ?? []).flatMap((l) => [...(l.listed ?? []), ...(l.results ?? []), l.path].filter(Boolean)), ...k.answer.contextPaths])
        const gShown = a.answer.shownPaths ?? [], gFull = a.answer.openedPaths ?? []
        const s = k.answer.step
        const inc = (f) => { c[`${s}:${f}`] = (c[`${s}:${f}`] ?? 0) + 1 }
        inc("n")
        if (gShown.some(ab)) inc("g5shownAB")
        if (gFull.some(ab)) inc("g5fullAB")
        if (gShown.some((p) => ab(p) && !kSeen.has(p))) inc("g5shownAB_notInK3")
        if (gFull.slice(0, 3).some((p) => ab(p))) inc("g5top3fullAB")
        if ([...kSeen].some(ab)) inc("k3sawAB")
        if (a.correct && !k.correct) inc("g5ok_k3wrong")
        if (!a.correct && k.correct) inc("k3ok_g5wrong")
    }
    console.log(set, c)
}
process.exit(0)
