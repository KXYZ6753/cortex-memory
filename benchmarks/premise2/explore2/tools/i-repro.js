// Byte-identity of two variants' answers on one set, question by question in set order.
//   node benchmarks/premise2/explore2/tools/i-repro.js <set> <variantA> <variantB> [--first N]
// Compares answer text, route (step), final context (contextPaths/readPaths) and, when both
// carry det() diagnostics, the per-call server cache counts (resume points). Prints the
// counts overall and by A's route, where the first divergence happens, and verdict flips
// where both answers are graded. No GPU.

import { answersOf, setOf, correctOf, same, gradingContext } from "./i-lib.js"

const [setName, a, b, ...rest] = process.argv.slice(2)
const firstN = rest.includes("--first") ? Number(rest[rest.indexOf("--first") + 1]) : Infinity
if (!setName || !a || !b) throw new Error("usage: i-repro.js <set> <variantA> <variantB> [--first N]")

const set = setOf(setName)
const A = answersOf(setName, a)
const B = answersOf(setName, b)
const { pool } = gradingContext()
const keys = set.questionKeys.slice(0, firstN).filter((key) => A.has(key) && B.has(key))

const byStep = new Map()
const row = (step) => {
    if (!byStep.has(step)) byStep.set(step, { n: 0, text: 0, step: 0, ctx: 0, cached: 0, cachedN: 0 })
    return byStep.get(step)
}
let firstDiff = null
const diffIdx = []
const flips = { up: 0, down: 0, graded: 0 }
const total = { n: 0, text: 0, step: 0, ctx: 0, cached: 0, cachedN: 0 }
for (const [index, key] of keys.entries()) {
    const x = A.get(key)
    const y = B.get(key)
    const sameText = x.answer === y.answer
    const sameStep = (x.step ?? null) === (y.step ?? null)
    const sameCtx = same(x.readPaths ?? x.contextPaths, y.readPaths ?? y.contextPaths)
    const haveCached = Array.isArray(x.det?.cached) && Array.isArray(y.det?.cached)
    const sameCached = haveCached && same(x.det.cached, y.det.cached)
    for (const r of [row(x.step ?? "-"), total]) {
        r.n++
        r.text += sameText
        r.step += sameStep
        r.ctx += sameCtx
        if (haveCached) { r.cachedN++; r.cached += sameCached }
    }
    if (!sameText) { diffIdx.push(index); firstDiff ??= { index, key, step: x.step } }
    const cx = correctOf(x)
    const cy = correctOf(y)
    if (cx !== null && cy !== null) {
        flips.graded++
        if (cy > cx) flips.up++
        if (cy < cx) flips.down++
    }
}
const pct = (k, n) => `${k}/${n}${n ? ` (${(100 * k / n).toFixed(1)}%)` : ""}`
console.log(`${setName}: ${a} vs ${b}, ${keys.length} questions in set order${Number.isFinite(firstN) ? ` (first ${firstN})` : ""}`)
console.log(`  identical text ${pct(total.text, total.n)}, route ${pct(total.step, total.n)}, context ${pct(total.ctx, total.n)}${total.cachedN ? `, cache resume points ${pct(total.cached, total.cachedN)}` : ""}`)
console.log(`  first text difference at question #${firstDiff ? firstDiff.index + 1 : "-"}${firstDiff ? ` (${firstDiff.step})` : ""}; differing positions: ${diffIdx.slice(0, 40).map((i) => i + 1).join(" ")}${diffIdx.length > 40 ? " ..." : ""}`)
console.log(`  verdicts: ${flips.graded} graded pairs, ${b} better on ${flips.up}, worse on ${flips.down}`)
console.log("  by route of A:  route | n | same text | same route | same context | same resume points")
for (const [step, r] of [...byStep].sort((p, q) => q[1].n - p[1].n)) console.log(`    ${step} | ${r.n} | ${r.text} | ${r.step} | ${r.ctx} | ${r.cachedN ? r.cached : "-"}`)
const strata = { miss: 0, hit: 0 }
for (const key of keys) strata[pool.byKey.get(key).stratum]++
console.log(`  strata: miss ${strata.miss}, hit ${strata.hit}`)
