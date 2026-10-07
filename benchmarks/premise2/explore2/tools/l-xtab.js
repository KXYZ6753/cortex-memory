// Worker l: per x1 path, cross-tab of x1's answer vs one alternative source (fix = x1 wrong
// & alt right; break = x1 right & alt wrong), from stored proxies (see l-bound.js).
//   node benchmarks/premise2/explore2/tools/l-xtab.js [sets]
import { loadCandidates, DEV, yesPathOf, norm } from "./l-lib.js"
const sets = process.argv[2] ? process.argv[2].split(",") : DEV
const { Q } = await loadCandidates(sets)
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : s === "found" ? "found" : "nofound")
const T = {}
for (const q of Q.values()) {
    const x1 = q.by["x1@1+cold"]
    if (!x1) continue
    const yes = yesPathOf(x1)
    const get = (v) => Object.entries(q.by).find(([k]) => k.split("@")[0] === v)?.[1]
    const c = (t) => (t == null ? null : q.cands.get(norm(t))?.correct ?? null)
    const alts = {
        commit: x1.gatesAnswer,
        single: get("j1")?.j?.singleAnswer ?? get("j2")?.j?.singleAnswer ?? (yes && yes === q.record.path ? get("oracles")?.answer : null),
        cad: yes && yes === q.record.path ? get("u-ocad5")?.answer : null,
        labels: get("c-fin1")?.answer ?? get("c-xT")?.answer,
    }
    const xc = c(x1.answer)
    for (const [k, t] of Object.entries(alts)) {
        const ac = c(t)
        if (ac === null || xc === null) continue
        const key = `${route(x1.step)}|${q.record.stratum}|${k}|${yes === q.record.path ? "yes=gold" : "yes!=gold"}`
        T[key] ??= { n: 0, fix: 0, brk: 0, same: 0 }
        T[key].n++
        if (ac > xc) T[key].fix++; else if (ac < xc) T[key].brk++
        if (norm(t) === norm(x1.answer)) T[key].same++
    }
}
for (const k of Object.keys(T).sort()) console.log(k.padEnd(40), JSON.stringify(T[k]))
