// Offline: confidence-triggered retry on gates' other context, simulated from n-lp0
// (first answer + logprobs) and n-cs2 (other-context sandwich answer + logprobs, graded).
import { pool, loadTable, weightedOf, verdictOf } from "./n-lib.js"
import { HEDGE } from "../variants/n-conf.js"
import { isAbstain } from "../../prompts.js"
const [setName = "S300-2"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, ["n-lp0", "n-cs2", "gates"])
const mean = (t) => (t.lps.length ? t.lps.reduce((a, b) => a + b, 0) / t.lps.length : -Infinity)
const rows = keys.map((q) => {
    const r = pool.byKey.get(q), a = table.get("n-lp0").get(q).a, b = table.get("n-cs2").get(q)
    return { st: r.stratum, g: table.get("gates").get(q).correct, first: a.lp.gates, fm: mean(a.lp.gates), oth: b.a.lp.other, om: mean(b.a.lp.other), ov: b.correct, o5: b.a.lp.o5, r, switched: a.switched }
})
console.log("other-context alone:", weightedOf(rows.map((x) => ({ stratum: x.st, v: x.ov ?? 0 }))))
for (const tau of [-0.15, -0.18, -0.2, -0.25, -0.3]) for (const hedge of [true, false]) for (const margin of [0, 0.03, 0.06]) {
    let trig = 0, ch = { hit: [0, 0], miss: [0, 0] }
    const items = rows.map((x) => {
        const low = isAbstain(x.first.answer) || x.fm < tau || (hedge && HEDGE.test(x.first.answer))
        if (!low) return { stratum: x.st, v: x.g }
        trig++
        const ok2 = x.oth.answer && !isAbstain(x.oth.answer)
        const take = ok2 && (isAbstain(x.first.answer) || x.om > x.fm + margin)
        const v = take ? x.ov ?? 0 : x.g
        if (v > x.g) ch[x.st][0]++; if (v < x.g) ch[x.st][1]++
        return { stratum: x.st, v }
    })
    const w = weightedOf(items)
    console.log(`tau ${tau} hedge ${hedge} m ${margin}: ${w.w.toFixed(1)} miss ${w.miss.toFixed(0)} hit ${w.hit.toFixed(1)} trig ${trig} hit +${ch.hit[0]}/-${ch.hit[1]} miss +${ch.miss[0]}/-${ch.miss[1]}`)
}
