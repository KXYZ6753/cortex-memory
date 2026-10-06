// Worker j: offline sweep of the single-read confidence gate. Uses j1's logged
// single-email answers (singleMean) and x1's stored answers as the g5 fallback
// (x1 = j1 outside the handover, byte for byte on S300-2). Δ vs x1, weighted.
//   node benchmarks/premise2/explore2/tools/j-tau.js S300-2 S300-1
import { pool, loadTable, weightedOf, verdictOf } from "./n-lib.js"
for (const setName of process.argv.slice(2)) {
    const { table, keys } = loadTable(setName, ["j1", "x1"])
    const base = keys.map((k) => ({ stratum: pool.byKey.get(k).stratum, v: table.get("x1").get(k).correct ?? 0 }))
    const w0 = weightedOf(base).w
    const out = []
    for (const tau of [-Infinity, -0.2, -0.15, -0.13, -0.12, -0.11, -0.1, -0.09, -0.08, -0.06, -0.04]) {
        let ph = 0, mh = 0, pm = 0, mm = 0, fired = 0
        const items = keys.map((k) => {
            const r = pool.byKey.get(k), j = table.get("j1").get(k), x = table.get("x1").get(k)
            let v = x.correct ?? 0
            if (j.a.step === "commit-single" && j.a.j.singleMean >= tau) {
                fired++
                const jv = j.correct ?? verdictOf(r, j.answer) ?? 0
                if (jv > v) r.stratum === "hit" ? ph++ : pm++
                if (jv < v) r.stratum === "hit" ? mh++ : mm++
                v = jv
            }
            return { stratum: r.stratum, v }
        })
        out.push(`tau ${tau}: fired ${fired}, Δ vs x1 ${(weightedOf(items).w - w0).toFixed(2)}, hits +${ph}/-${mh}, misses +${pm}/-${mm}`)
    }
    console.log(setName + "\n  " + out.join("\n  "))
}
