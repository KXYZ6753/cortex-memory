// Worker lite: a two-term GPU energy model, J/q = a x genMs + b x (wallMs - genMs), fitted on
// worker i's measured det runs (S300-1, design-weighted; .data/premise2/explore/i-energy-summary.json),
// then applied to the lite simulation's per-question wall/gen (tools/lite-sim.js logic) for a
// pre-run estimate. The measured energy of the real runs (tools/i-energy.js) replaces it.
//   node benchmarks/premise2/explore2/tools/lite-power.js
import { readFileSync } from "node:fs"
import { openAll } from "./a-lib.js"
const { graded, missShare } = await openAll()
const summary = JSON.parse(readFileSync(".data/premise2/explore/i-energy-summary.json", "utf8"))
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const dw = (items, f) => missShare * mean(items.filter((i) => i.record.stratum === "miss").map(f)) + (1 - missShare) * mean(items.filter((i) => i.record.stratum === "hit").map(f))
const pts = []
for (const [v, at] of [["i-det-gates", "i-det-gates@2+cold"], ["i-det-tlk", "i-det-tlk@2+cold"], ["i-det-x1", "i-det-x1@2+cold"], ["i-e-gates", "i-e-gates@1+cold"], ["i-e-tlk", "i-e-tlk@1+cold"], ["i-e-x1", "i-e-x1@1+cold"], ["i-e-pb", "i-e-pb@1+cold"]]) {
    const row = summary.rows.find((r) => r.variant === v)
    const items = graded(at, "S300-1")
    const gen = dw(items, (i) => i.answer.genMs), wall = dw(items, (i) => i.answer.wallMs)
    pts.push({ v, J: row.dw.gpuJq, gen, rest: wall - gen, wall })
}
// least squares without intercept: J = a gen + b rest
const sgg = pts.reduce((s, p) => s + p.gen * p.gen, 0), srr = pts.reduce((s, p) => s + p.rest * p.rest, 0), sgr = pts.reduce((s, p) => s + p.gen * p.rest, 0)
const sJg = pts.reduce((s, p) => s + p.J * p.gen, 0), sJr = pts.reduce((s, p) => s + p.J * p.rest, 0)
const det = sgg * srr - sgr * sgr
const a = (sJg * srr - sJr * sgr) / det, b = (sJr * sgg - sJg * sgr) / det
console.log(`fit: GPU J/q = ${(1000 * a).toFixed(1)} W x gen s + ${(1000 * b).toFixed(1)} W x non-gen s`)
for (const p of pts) console.log(`  ${p.v}: measured ${p.J.toFixed(1)} J/q, model ${(a * p.gen + b * p.rest).toFixed(1)} (dw wall ${p.wall.toFixed(0)}, gen ${p.gen.toFixed(0)})`)
process.exit(0)
