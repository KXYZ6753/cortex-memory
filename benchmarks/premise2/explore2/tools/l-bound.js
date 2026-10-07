// Worker l: oracle-selection bounds by x1 path for deployable candidate sources (proxies
// from stored answers): x1's final answer, x1's commit answer (gates' prompt over W0), the
// YES email read alone (j1/j2's stored single read; else oracles' text when the YES email is
// the gold), CAD on the YES email alone (u-ocad5's text when the YES email is the gold),
// x1 + thread labels (c-fin1 / c-xT), u-xcad.
//   node benchmarks/premise2/explore2/tools/l-bound.js [sets]
import { loadCandidates, DEV, yesPathOf, norm } from "./l-lib.js"

const sets = process.argv[2] ? process.argv[2].split(",") : DEV
const { env, Q } = await loadCandidates(sets)
const ms = env.missShare
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : "explore")
const pools = {
    "x1": ["x1"],
    "x1+commit": ["x1", "commit"],
    "x1+single": ["x1", "single"],
    "x1+commit+single": ["x1", "commit", "single"],
    "x1+single+cad": ["x1", "single", "cad"],
    "x1+commit+single+cad": ["x1", "commit", "single", "cad"],
    "x1+labels": ["x1", "labels"],
    "all six": ["x1", "commit", "single", "cad", "labels", "xcad"],
}
const T = {}
for (const q of Q.values()) {
    const x1 = q.by["x1@1+cold"]
    if (!x1) continue
    const r = route(x1.step), st = q.record.stratum
    const yes = yesPathOf(x1)
    const c = (text) => (text == null ? null : q.cands.get(norm(text))?.correct ?? null)
    const get = (v) => Object.entries(q.by).find(([k]) => k.split("@")[0] === v)?.[1]
    const single = get("j1")?.j?.singleAnswer ?? get("j2")?.j?.singleAnswer ?? (yes && yes === q.record.path ? get("oracles")?.answer : null)
    const cad = yes && yes === q.record.path ? get("u-ocad5")?.answer : null
    const labels = get("c-fin1")?.answer ?? get("c-xT")?.answer
    const xcad = get("u-xcad")?.answer
    const val = { x1: c(x1.answer), commit: x1.gatesAnswer ? c(x1.gatesAnswer) : null, single: c(single), cad: c(cad), labels: c(labels), xcad: c(xcad) }
    for (const [name, srcs] of Object.entries(pools)) {
        const vs = srcs.map((s) => val[s]).filter((v) => v !== null)
        const k = `${r}|${st}|${name}`
        T[k] ??= { n: 0, x1: 0, best: 0, avail: 0 }
        T[k].n++; T[k].x1 += val.x1 ?? 0; T[k].best += vs.some((v) => v === 1) ? 1 : 0
        T[k].avail += srcs.every((s) => val[s] !== null) ? 1 : 0
    }
}
for (const r of ["sure", "unsure", "explore"]) for (const st of ["hit", "miss"]) {
    console.log(`${r} ${st}:`)
    for (const name of Object.keys(pools)) {
        const t = T[`${r}|${st}|${name}`]
        if (!t) continue
        const wt = st === "hit" ? 1 - ms : ms
        console.log(`  ${name.padEnd(22)} n ${t.n} all-available ${t.avail}  x1 ${t.x1}  oracle ${t.best}  (+${t.best - t.x1}, weighted +${(100 * wt * (t.best - t.x1) / (st === "hit" ? 1050 : 450) * (sets === DEV ? 1 : 1)).toFixed(2)} over ${sets.length} sets)`)
    }
}
