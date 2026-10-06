// Worker y: offline simulation of y1/y2 from the stored parents (x1, m2, j2, t-lx), J1.
// Per question: m2 recovered (recover-*) -> m2's verdict (recover-unsure: m2's verdict, the
// j2 re-read of E is not observable); else j2 handled the handover (commit-single /
// commit-g5) -> j2's verdict; else x1's. y2: explore questions take t-lx's verdict.
// Overstates: stored parents ran under different call sequences (cache re-rolls).
//   node benchmarks/premise2/explore2/tools/y-sim.js [S300-2+S300-1]
import { openAll, weightedOf, bootstrap, fmtCi, byKey } from "./y-lib.js"
const { graded, missShare } = await openAll()
const setArg = process.argv[2] ?? "S300-2+S300-1"
for (const sets of [...setArg.split("+").map((s) => [s]), setArg.split("+")]) {
    const X = byKey(graded, "x1@1+cold", sets), M = byKey(graded, "m2@1+cold", sets), J = byKey(graded, "j2@1+cold", sets), TL = byKey(graded, "t-lx@1+cold", sets)
    const sim = { y1: [], y2: [] }
    const tally = { m2rec: 0, m2recUnsure: 0, j2: 0, j2Single: 0, overlapNoE: 0, explore: 0, yesLpDoubt: 0, unsureCommits: 0 }
    for (const [k, x] of X) {
        const m = M.get(k), j = J.get(k), t = TL.get(k)
        if (!m || !j) continue
        const xs = x.answer.step
        const yesLp1 = (x.answer.log ?? []).find((l) => l.act === "check" && l.yes)?.yesLp ?? null
        const committed = xs === "commit" || xs === "commit-g5"
        if (committed && (yesLp1 ?? -9) < -0.1) tally.yesLpDoubt++
        if (xs === "commit-g5") tally.unsureCommits++
        let c
        if ((m.answer.step ?? "").startsWith("recover")) { c = m.correct; tally.m2rec++; if (m.answer.step === "recover-unsure") tally.m2recUnsure++ }
        else if (j.answer.step === "commit-single" || j.answer.step === "commit-g5") {
            c = j.correct; tally.j2++; if (j.answer.step === "commit-single") tally.j2Single++
            if ((yesLp1 ?? -9) < -0.1) tally.overlapNoE++
        } else c = x.correct
        const isExplore = ["found", "nofound", "nopick"].includes(xs)
        if (isExplore) tally.explore++
        sim.y1.push({ record: x.record, correct: c, ref: x.correct })
        sim.y2.push({ record: x.record, correct: isExplore && t ? t.correct : c, ref: x.correct })
    }
    console.log(`\n${sets.join("+")}  routing: ${JSON.stringify(tally)}`)
    const xw = weightedOf([...X.values()], missShare)
    console.log(`  x1 W ${(100 * xw.weighted).toFixed(2)} miss ${(100 * xw.miss).toFixed(1)} hit ${(100 * xw.hit).toFixed(1)}`)
    for (const [id, items] of Object.entries(sim)) {
        const w = weightedOf(items, missShare)
        const ci = bootstrap(items.map((i) => ({ stratum: i.record.stratum, d: i.correct - i.ref })), missShare)
        const fl = (st) => { const l = items.filter((i) => i.record.stratum === st); return `+${l.filter((i) => i.correct > i.ref).length}/-${l.filter((i) => i.correct < i.ref).length}` }
        console.log(`  ${id} (sim) W ${(100 * w.weighted).toFixed(2)} miss ${(100 * w.miss).toFixed(1)} hit ${(100 * w.hit).toFixed(1)}  Δ vs x1 ${fmtCi(ci)}  flips hit ${fl("hit")} miss ${fl("miss")}`)
    }
    for (const [id, Mv] of [["m2", M], ["j2", J], ["t-lx", TL]]) {
        const items = [...X].filter(([k]) => Mv.get(k)).map(([k, x]) => ({ stratum: x.record.stratum, d: Mv.get(k).correct - x.correct }))
        console.log(`  ${id} (stored) Δ vs x1 ${fmtCi(bootstrap(items, missShare))}`)
    }
}
process.exit(0)
