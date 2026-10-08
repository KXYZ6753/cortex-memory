// v6 (aux): oracle size of parent + alternative sets (no encoder): how many hits/misses could a perfect
// selector fix, and how often is the parent right on discordant questions (the prior a selector fights).
import { openV6, norm, sameCtx } from "./v6-lib.js"
const env = await openV6()
const conf = [
    { parent: "x1", sets: ["FULL-0", "S300-1", "S300-2"], alts: { commit: (by) => by.x1?.gatesAnswer, t2: (by) => { for (const v of ["gatea", "gate", "pb"]) if (by[v] && by.gates && sameCtx(by[v], by.gates)) return by[v].answer } } },
    { parent: "gates", sets: ["FULL-0", "S300-1", "S300-2"], alts: { t2: (by) => { for (const v of ["gatea", "gate", "pb"]) if (by[v] && sameCtx(by[v], by.gates)) return by[v].answer }, o4: (by) => by.o4 && sameCtx(by.o4, by.gates) ? by.o4.answer : null, x1: (by) => by.x1?.answer } },
]
for (const c of conf) {
    const names = Object.keys(c.alts)
    const subsets = [[]]
    for (const n of names) for (const s of [...subsets]) subsets.push([...s, n])
    for (const sub of subsets.filter((s) => s.length)) {
        const tally = { hit: { n: 0, par: 0, fix: 0, disc: 0, parRightDisc: 0 }, miss: { n: 0, par: 0, fix: 0, disc: 0, parRightDisc: 0 } }
        for (const set of c.sets) {
            const m = env.bySet.get(set)
            for (const key of env.setKeys(set)) {
                const by = m?.get(key)
                const P = by?.[c.parent]
                if (!P) continue
                if (sub.some((n) => !c.alts[n](by))) continue
                const rec = env.pool.byKey.get(key)
                const pc = env.verdictOf(rec, P.answer, P.status)
                const acs = sub.map((n) => env.verdictOf(rec, c.alts[n](by)))
                if (pc === null || acs.some((x) => x === null)) continue
                const t = tally[rec.stratum]
                t.n++; t.par += pc
                if (!pc && acs.some((x) => x)) t.fix++
                if (acs.some((x) => x !== pc)) { t.disc++; if (pc) t.parRightDisc++ }
            }
        }
        const h = tally.hit, mi = tally.miss
        console.log(`${c.parent} + ${sub.join("+").padEnd(14)} hits ${h.n}: parent ${(100 * h.par / h.n).toFixed(1)}, oracle +${(100 * h.fix / h.n).toFixed(2)} pts (${h.fix} fixable; parent right on ${h.parRightDisc}/${h.disc} discordant) | misses ${mi.n}: oracle +${(100 * mi.fix / Math.max(1, mi.n)).toFixed(1)}`)
    }
}
