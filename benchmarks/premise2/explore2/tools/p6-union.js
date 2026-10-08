// Worker p6: how many hits are shape-sensitive at all (no GPU).
//   node benchmarks/premise2/explore2/tools/p6-union.js <set,set> <parent|alt> <arm,arm,...>
// Over the hits every arm and the parent answered: how many are right under every prompt, wrong
// under every prompt, or split (right under some, wrong under others); for split questions, how
// often the parent is right; and the pairwise overlap of the arms' flip sets (if a shape had a
// systematic effect, its flips would differ from a placebo's; if the flips are a lottery over one
// fragile set, all arms flip the same questions in both directions).
import { loadAnswers, correctOf, setKeys, grading } from "./p6-lib.js"

const [setsArg, parentArg, armsArg] = process.argv.slice(2)
const parents = parentArg.split("|")
const arms = armsArg.split(",")
const A = await loadAnswers([...parents, ...arms])
const { pool } = grading()
const rows = []
for (const set of setsArg.split(",")) for (const qk of setKeys(set)) {
    if (pool.byKey.get(qk).stratum !== "hit") continue
    const key = `${set}|${qk}`
    const p = parents.map((s) => A.get(s).get(key)).find(Boolean)
    const as = arms.map((s) => A.get(s).get(key))
    if (!p || as.some((a) => !a)) continue
    const c = [p, ...as].map(correctOf)
    if (c.some((x) => x === null)) continue
    rows.push({ key, c })
}
const n = rows.length
const all = rows.filter((r) => r.c.every((x) => x === 1)).length
const none = rows.filter((r) => r.c.every((x) => x === 0)).length
const split = rows.filter((r) => r.c.some((x) => x === 1) && r.c.some((x) => x === 0))
console.log(`${n} hits answered by the parent and ${arms.length} arms (${arms.join(", ")})`)
console.log(`right under every prompt ${all} (${(100 * all / n).toFixed(1)}%), wrong under every prompt ${none} (${(100 * none / n).toFixed(1)}%), split ${split.length} (${(100 * split.length / n).toFixed(1)}%)`)
console.log(`parent right on ${split.filter((r) => r.c[0] === 1).length} of the split; best-of-${arms.length + 1} oracle: ${(100 * (all + split.length) / n).toFixed(1)} vs parent ${(100 * rows.filter((r) => r.c[0] === 1).length / n).toFixed(1)}`)
const flips = arms.map((_, j) => new Set(rows.filter((r) => r.c[j + 1] !== r.c[0]).map((r) => r.key)))
console.log("\npairwise overlap of flip sets (questions whose verdict differs from the parent's): |A∩B| / |A|, |B|")
for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const inter = [...flips[i]].filter((k) => flips[j].has(k)).length
    console.log(`  ${arms[i]} (${flips[i].size}) & ${arms[j]} (${flips[j].size}): ${inter} shared`)
}
process.exit(0)
