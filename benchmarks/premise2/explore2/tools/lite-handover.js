// Worker lite: is x1's g5 handover worth more when the first YES is doubted too? (no GPU)
// On x1's handover questions (commit, A unsure), compare x1's g5 answer with t-lk's kept
// answer A, split by the first YES's token logprob (doubted: < -0.1). Unwrapped stored runs
// (x1 vs t-lk; history noise included) on every dev set where both exist, plus det x1 vs
// det t-lk on S300-1.
//   node benchmarks/premise2/explore2/tools/lite-handover.js
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const SETS = ["S300-1", "S300-2", "S300-3", "FULL-1"]
const pairsOf = (xv, tv, set) => {
    const T = new Map(graded(tv, set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
    const out = []
    for (const x of graded(xv, set)) {
        const t = T.get(x.record.questionKey)
        if (!t || x.correct === null || x.answer.step !== "commit-g5") continue
        const yes1 = (x.answer.log ?? []).find((l) => l.act === "check" && l.yes)
        out.push({ stratum: x.record.stratum, doubted: (yes1?.yesLp ?? -9) < -0.1, yesAt: x.answer.yesAt, x: x.correct, t: t.correct, tStep: t.answer.step })
    }
    return out
}
const tally = (rows) => {
    const cell = (f) => { const r = rows.filter(f); return `${r.length}: +${r.filter((p) => p.x > p.t).length}/−${r.filter((p) => p.x < p.t).length}` }
    return [cell((p) => p.stratum === "hit" && p.doubted), cell((p) => p.stratum === "hit" && !p.doubted), cell((p) => p.stratum === "miss" && p.doubted), cell((p) => p.stratum === "miss" && !p.doubted)]
}
console.log("g5 handover vs kept A (x1 better / worse), by first-YES doubt")
console.log("| comparison | set | hit, yes1 doubted | hit, yes1 confident | miss, yes1 doubted | miss, yes1 confident |")
console.log("|---|---|---|---|---|---|")
const pooled = []
for (const set of SETS) {
    const rows = pairsOf("x1@1+cold", "t-lk@1+cold", set)
    pooled.push(...rows)
    console.log(`| x1 vs t-lk (unwrapped) | ${set} | ${tally(rows).join(" | ")} |`)
}
console.log(`| x1 vs t-lk (unwrapped) | pooled | ${tally(pooled).join(" | ")} |`)
console.log(`| det x1 vs det t-lk | S300-1 | ${tally(pairsOf("i-det-x1@2+cold", "i-det-tlk@2+cold", "S300-1")).join(" | ")} |`)
// yesAt split (lead: x1 loses hits on the handover when the first YES was not W0's top email)
const at = (rows, f) => { const r = rows.filter(f); return `${r.length}: +${r.filter((p) => p.x > p.t).length}/−${r.filter((p) => p.x < p.t).length}` }
console.log(`\npooled unwrapped, by yesAt: hits yesAt 0 ${at(pooled, (p) => p.stratum === "hit" && p.yesAt === 0)}, yesAt > 0 ${at(pooled, (p) => p.stratum === "hit" && p.yesAt > 0)}; misses yesAt 0 ${at(pooled, (p) => p.stratum === "miss" && p.yesAt === 0)}, yesAt > 0 ${at(pooled, (p) => p.stratum === "miss" && p.yesAt > 0)}`)
process.exit(0)
