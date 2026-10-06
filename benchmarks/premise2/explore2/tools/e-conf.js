// e: on x1's unsure handover questions where g5 and gates disagree, does gates' confidence
// (x1.firstMean) or the third's agreement tell which one is right? (pooled over sets)
import { table, sim } from "./e-lib.js"
import { verdictOf } from "./n-lib.js"
const rows = []
for (const set of ["S300-2", "S300-1", "FULL-0"]) {
    const ids = ["x1@1+cold", "gates@1+cold", "r5@1+cold"].concat(set === "FULL-0" ? [] : ["o4@1+cold"])
    const T = table(set, ids)
    for (const [k, x] of T.get("x1")) {
        if (x.a.step !== "commit-g5") continue
        const q = x.record.question, g = x.a.gatesAnswer
        if (sim(x.text, g, q) >= 0.5) continue
        let gv = verdictOf(x.record, g); if (gv == null) gv = T.get("gates").get(k)?.correct
        const r5 = T.get("r5").get(k), o4 = T.get("o4")?.get(k)
        rows.push({ set, stratum: x.record.stratum, g5: x.correct, gx: gv, mean: x.a.firstMean, r5g: r5 ? sim(r5.text, g, q) >= .5 && sim(r5.text, x.text, q) < .5 : null, o4g: o4 ? sim(o4.text, g, q) >= .5 && sim(o4.text, x.text, q) < .5 : null })
    }
}
const show = (name, f) => { const s = rows.filter(f); const c = (k) => s.filter((r) => r[k]).length; console.log(name.padEnd(34), "n", s.length, "g5 right", c("g5"), "gates right", c("gx"), " hits:", s.filter((r) => r.stratum === "hit").length) }
show("all disagreements", () => true)
for (const [lo, hi] of [[-9, -0.4], [-0.4, -0.25], [-0.25, -0.15], [-0.15, 0]]) show(`firstMean in [${lo}, ${hi})`, (r) => r.mean >= lo && r.mean < hi)
show("r5 sides with gates", (r) => r.r5g === true); show("r5 does not", (r) => r.r5g === false)
show("o4 sides with gates", (r) => r.o4g === true); show("o4 does not", (r) => r.o4g === false)
for (const s of ["S300-2", "S300-1", "FULL-0"]) show(` ${s} o4|r5 side with gates`, (r) => r.set === s && (s === "FULL-0" ? r.r5g : r.o4g))
