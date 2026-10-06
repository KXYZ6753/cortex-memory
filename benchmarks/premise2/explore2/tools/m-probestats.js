// Worker m: m-diag probe statistics: YES rate / YES logprob for AB vs non-AB recovery candidates,
// pairwise and extract discriminators on (first W0 YES, best recovery YES).
import { openAll } from "./a-lib.js"
import { diagRows } from "./m-lib.js"
const { pool, bearing } = await openAll()
for (const set of process.argv.slice(2)) {
    const D = diagRows(set)
    const s = { recAB: [0, 0], recNon: [0, 0], lpAB: [], lpNon: [], w0AB: [0, 0], w0Non: [0, 0] }
    const pairs = { trueA: [0, 0, 0], falseA_abB: [0, 0, 0], falseA_nonB: [0, 0, 0] }
    const ext = { AB: [0, 0], non: [0, 0] }
    for (const [key, d] of D) {
        const rec = pool.byKey.get(key), ab = bearing(rec), a = d.answer
        for (const l of a.log ?? []) {
            const b = ab(l.path)
            const k = l.act === "w0" ? (b ? "w0AB" : "w0Non") : b ? "recAB" : "recNon"
            s[k][0]++; if (l.yes) { s[k][1]++; if (l.act === "rec") (b ? s.lpAB : s.lpNon).push(l.yesLp ?? -9) }
        }
        for (const e of a.extracts ?? []) { const k = ab(e.path) ? "AB" : "non"; ext[k][0]++; if (e.abstain) ext[k][1]++ }
        if (a.pair) {
            const k = ab(a.pair.a) ? "trueA" : ab(a.pair.b) ? "falseA_abB" : "falseA_nonB"
            const v = (a.pair.ab.pick === 2 ? 1 : 0) + (a.pair.ba.pick === 1 ? 1 : 0)
            pairs[k][v]++
        }
    }
    const med = (x) => (x.sort((a, b) => a - b), x.length ? x[x.length >> 1].toFixed(3) : "-")
    console.log(`== ${set}: W0 YES AB ${s.w0AB[1]}/${s.w0AB[0]}, non ${s.w0Non[1]}/${s.w0Non[0]}; recovery YES AB ${s.recAB[1]}/${s.recAB[0]}, non ${s.recNon[1]}/${s.recNon[0]}; median yesLp of recovery YES: AB ${med(s.lpAB)}, non ${med(s.lpNon)}`)
    console.log(`   extract abstains: AB ${ext.AB[1]}/${ext.AB[0]}, non-AB ${ext.non[1]}/${ext.non[0]}`)
    console.log(`   pair (votes for the recovery email 0/1/2 of 2 orders): first YES is AB ${pairs.trueA}; first YES non-AB & recovery AB ${pairs.falseA_abB}; both non-AB ${pairs.falseA_nonB}`)
}
process.exit(0)
