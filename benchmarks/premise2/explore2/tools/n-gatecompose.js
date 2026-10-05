// Offline: "gates when confident, else variant X" (confidence = gates' mean token logprob
// from n-lp0). Optionally keep gates when X's answer is an abstention.
import { pool, loadTable, weightedOf } from "./n-lib.js"
import { HEDGE } from "../variants/n-conf.js"
import { isAbstain } from "../../prompts.js"
const [setName = "S300-2", list = "r5,r4,s1"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, ["n-lp0", "gates", ...list.split(",")])
const g = table.get("gates")
const conf = new Map(keys.map((q) => { const a = table.get("n-lp0").get(q).a.lp.gates; const l = a.lps; return [q, { m: l.reduce((x, y) => x + y, 0) / Math.max(1, l.length), h: HEDGE.test(a.answer) || isAbstain(a.answer) }] }))
const base = weightedOf(keys.map((q) => ({ stratum: pool.byKey.get(q).stratum, v: g.get(q).correct })))
console.log(`${setName} gates ${base.w.toFixed(1)} (miss ${base.miss.toFixed(0)} hit ${base.hit.toFixed(1)})`)
for (const v of list.split(",")) {
    const m = table.get(v); if (!m) continue
    const full = weightedOf(keys.map((q) => ({ stratum: pool.byKey.get(q).stratum, v: m.get(q).correct ?? 0 })))
    console.log(`  ${v} alone ${full.w.toFixed(1)} (miss ${full.miss.toFixed(0)} hit ${full.hit.toFixed(1)})`)
    for (const tau of [-0.1, -0.13, -0.16, -0.2, -0.25]) {
        let n = 0; const fl = { hit: [0, 0], miss: [0, 0] }
        const items = keys.map((q) => {
            const r = pool.byKey.get(q), c = conf.get(q)
            let v0 = g.get(q).correct
            if (c.m < tau || c.h) { n++; const x = m.get(q); if (x && !x.abstain) { const v1 = x.correct ?? 0; if (v1 > v0) fl[r.stratum][0]++; if (v1 < v0) fl[r.stratum][1]++; v0 = v1 } }
            return { stratum: r.stratum, v: v0 }
        })
        const w = weightedOf(items)
        console.log(`    tau ${tau}: ${w.w.toFixed(1)} (Δ ${(w.w - base.w).toFixed(1)}) miss ${w.miss.toFixed(0)} hit ${w.hit.toFixed(1)} fired ${n} hit +${fl.hit[0]}/-${fl.hit[1]} miss +${fl.miss[0]}/-${fl.miss[1]}`)
    }
}
