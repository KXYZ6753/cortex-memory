// z: on x1's handover questions (commit & unsure -> g5), how often do gates' answer (A) and
// the g5 answer (B) differ in correctness? = the room for a selector between them.
import { loadTable, pool, verdictOf, same } from "./n-lib.js"
for (const set of ["S300-2", "S300-1"]) {
    const { table, keys } = loadTable(set, ["x1", "gates", "o4", "k3", "g5"])
    const x1 = table.get("x1")
    const c = {}
    const bump = (k) => (c[k] = (c[k] ?? 0) + 1)
    for (const k of keys) {
        const x = x1.get(k); if (!x) continue
        const r = pool.byKey.get(k)
        const step = x.a.step
        if (step !== "commit-g5") continue
        const a = verdictOf(r, x.a.gatesAnswer), b = x.correct
        const o4 = table.get("o4")?.get(k)?.correct
        bump(`${r.stratum} A${a}B${b}`)
        if (a !== null && b !== null && a !== b) bump(`${r.stratum} disagree o4=${o4}`)
        if (same(x.a.gatesAnswer, x.answer)) bump(`${r.stratum} sameText`)
    }
    console.log(set, Object.entries(c).sort())
    // also explore steps
    const e = {}
    for (const k of keys) { const x = x1.get(k); if (!x) continue; const r = pool.byKey.get(k); const kk = `${r.stratum} ${x.a.step} ${x.correct}`; e[kk] = (e[kk] ?? 0) + 1 }
    console.log(Object.entries(e).sort())
}
