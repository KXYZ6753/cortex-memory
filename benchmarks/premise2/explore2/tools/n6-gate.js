// Worker n6: offline view of the gate signals for gates' first-context answer on hits, from
// stored det x1 runs (x1's commit answer is gates' exact prompt over W0 = gates' first
// context, with logprobs: firstMean; yesAt = first YES position in W0). Joined with gates'
// own verdict (det gates where stored, else stored gates). No GPU.
//   node benchmarks/premise2/explore2/tools/n6-gate.js S300-1,S300-2,S300-3,S300-4,S300-5,FULL-2,FULL-3
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,S300-4,S300-5,FULL-2,FULL-3").split(",")
const bins = {}
let same = 0, both = 0
for (const s of sets) {
    let G = graded("i-det-gates@2+cold", s)
    if (!G.length) G = graded("gates@1+cold", s)
    const Gm = new Map(G.map((i) => [i.record.questionKey, i]))
    for (const x of graded("i-det-x1@2+cold", s)) {
        if (x.record.stratum !== "hit") continue
        const g = Gm.get(x.record.questionKey)
        if (!g || g.correct == null || x.answer.firstMean == null) continue
        both++
        if ((x.answer.gatesAnswer ?? "").trim() === g.answer.answer.trim()) same++
        const m = x.answer.firstMean
        const b = m >= -0.05 ? "a >= -0.05" : m >= -0.1 ? "b [-0.1,-0.05)" : m >= -0.2 ? "c [-0.2,-0.1)" : m >= -0.4 ? "d [-0.4,-0.2)" : "e < -0.4"
        const ya = x.answer.yesAt === 0 ? "yes@1" : x.answer.yesAt > 0 ? "yes@2-5" : "noYes"
        for (const k of [b, `${b} ${ya}`]) {
            const r = (bins[k] ??= { n: 0, g: 0 })
            r.n++; r.g += g.correct
        }
    }
}
console.log(`hits with x1 commit diag: ${both}; x1's logged W0 answer == gates' answer text: ${same}`)
for (const [k, r] of Object.entries(bins).sort()) console.log(`  ${k.padEnd(24)} n ${String(r.n).padStart(4)}  gates right ${(100 * r.g / r.n).toFixed(1)}%  wrong ${r.n - r.g}`)
process.exit(0)
