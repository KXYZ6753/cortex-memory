// Worker u: speculative CAD diagnostics on the gold-only harness. Checks that the raw-mode
// greedy answer equals the chat-mode `oracles` answer (template equivalence), and reports
// branches / sites / raw calls / wall, and verdict flips CAD answer vs its own greedy text
// where the greedy text equals oracles' (so oracles' verdict is the greedy verdict).
//   node benchmarks/premise2/explore2/tools/u-cad.js S300-2 u-ocad@1+cold
import { openAll } from "./a-lib.js"
const { graded } = await openAll()
const [set, v] = process.argv.slice(2)
const or = new Map(graded("oracles@1+cold", set).map((i) => [i.record.questionKey, i]))
const items = graded(v, set)
let same = 0, changed = 0, n = 0, branches = 0, sites = 0, raw = 0, wall = 0, rawMs = 0
const flips = { hit: [0, 0, 0, 0], miss: [0, 0, 0, 0] } // [changed&greedy==oracles, +, -, same verdict]
for (const i of items) {
    n++
    const o = or.get(i.record.questionKey)
    const a = i.answer
    if (o && a.greedy === o.answer.answer.trim()) same++
    branches += a.cad?.branches ?? 0; sites += a.cad?.sites ?? 0; raw += a.uRawCalls ?? 0; wall += a.wallMs; rawMs += a.uRawMs ?? 0
    if (a.answer !== a.greedy) changed++
    if (o && a.greedy === o.answer.answer.trim() && a.answer !== a.greedy && i.correct != null && o.correct != null) {
        const f = flips[i.record.stratum]; f[0]++
        if (i.correct > o.correct) f[1]++; else if (i.correct < o.correct) f[2]++; else f[3]++
    }
}
console.log(`${set} ${v}: n ${n}, raw greedy == chat oracles ${same}/${n}, CAD changed the answer ${changed}, mean branches ${(branches / n).toFixed(2)}, sites ${(sites / n).toFixed(2)}, raw calls ${(raw / n).toFixed(2)}, wall ${Math.round(wall / n)} ms (raw ${Math.round(rawMs / n)})`)
for (const s of ["hit", "miss"]) console.log(`  ${s}: changed (greedy = oracles) ${flips[s][0]}: +${flips[s][1]} / -${flips[s][2]} / same ${flips[s][3]}`)
process.exit(0)
