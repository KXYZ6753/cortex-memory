// Worker a6: offline composition of the a6 package from stored det replays (exact behind det:
// every form call is preceded by i-det's reset, so its answer depends only on its own prompt).
// Per question: TRUNC repair if the parent was cut (a6-r?-trunc), else top2 for the configured
// cells (split: a6-r?-top2; who / hdr / when: a6-r?-top2x), unless the guard keeps the parent
// (parent answer attributed to email 3-5 of its final context with share >= 0.5); else parent.
// Reports hits/misses Δ vs the parent with question and mailbox-cluster CIs, flips by cell, and
// the real variant's wall/calls (parent's stored + the form's).
//   node benchmarks/premise2/explore2/tools/a6-compose.js <g|q> <sets> <cells,comma> [guard=1] [trunc=1] [show]
import { loadRuns, pool, openEmails, bootHits, missShare } from "./a6-lib.js"
import { attribute } from "../variants/a-common.js"
import { cellOf } from "../variants/a6-surgery.js"

const [which = "g", setsArg = "S300-4,S300-5,FULL-2,FULL-3,S300-1", cellsArg = "split", guardArg = "1", truncArg = "1", show = ""] = process.argv.slice(2)
const sets = setsArg.split(",")
const cells = cellsArg.split(",").filter(Boolean)
const guard = guardArg === "1", trunc = truncArg === "1"
const P = which === "g" ? "i-det-gates@2+cold" : "q-det-q1@1+cold"
const R = (f) => `a6-r${which}-${f}@1+cold`
const runs = loadRuns(sets, [P, R("trunc"), R("top2"), R("top2x")])
const emails = await openEmails()
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const sg = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(2)}`
const out = { hit: [], miss: [] }
const byCell = {}
let missing = 0
const walls = [], calls = []
for (const [k, b] of runs.get(P)) {
    const r = pool.byKey.get(k)
    if (b.correct == null) continue
    let pick = b, how = "parent"
    const cell = cellOf(r.question)
    if (trunc && b.a.status === "output_limit") {
        const t = runs.get(R("trunc")).get(k)
        if (t?.a.a6?.fired) { pick = t; how = "trunc" }
    } else if (cell && cells.includes(cell)) {
        const t = runs.get(R(cell === "split" ? "top2" : "top2x")).get(k)
        if (!t) missing++
        else if (t.a.a6?.fired && t.a.a6.kept === "top2") {
            const final = t.a.a6.final
            const att = guard ? attribute(b.a.answer, r.question, final, emails.emailOf) : null
            if (!(guard && att && att.index >= 2 && att.share >= 0.5) && final.length > 2) { pick = t; how = `top2:${cell}` }
        }
    }
    if (pick.correct == null) { missing++; continue }
    out[r.stratum].push({ a: pick.correct, b: b.correct, user: r.user, k, how, cell })
    walls.push((b.a.wallMs ?? 0) + (how === "parent" ? 0 : pick.a.wallMs ?? 0))
    calls.push((b.a.calls - (b.a.det?.resets ?? 0)) + (how === "parent" ? 0 : (pick.a.calls ?? 0) - (pick.a.det?.resets ?? 0)))
    const c = (byCell[`${r.stratum} ${how}`] ??= { n: 0, plus: 0, minus: 0 })
    c.n++; c.plus += pick.correct > b.correct; c.minus += pick.correct < b.correct
}
console.log(`${which === "g" ? "det gates" : "det q1"} + package {cells: ${cells.join(",")}, guard: ${guard}, trunc: ${trunc}} on ${sets.join(",")}${missing ? ` (missing/ungraded ${missing})` : ""}`)
for (const st of ["hit", "miss"]) {
    const L = out[st]
    if (!L.length) continue
    const bh = bootHits(L)
    console.log(`  ${st}: n ${L.length} | ${(100 * mean(L.map((x) => x.a))).toFixed(2)} vs ${(100 * mean(L.map((x) => x.b))).toFixed(2)} | Δ ${sg(bh.delta)} [${sg(bh.low)}, ${sg(bh.high)}] cluster [${sg(bh.cLow)}, ${sg(bh.cHigh)}] flips +${bh.plus}/−${bh.minus}`)
    for (const s of sets) { const l = L.filter((x) => runs.get(P).get(x.k).set === s); if (l.length) console.log(`     ${s}: Δ ${sg(mean(l.map((x) => x.a - x.b)))} (+${l.filter((x) => x.a > x.b).length}/−${l.filter((x) => x.a < x.b).length})`) }
}
if (out.hit.length && out.miss.length) {
    const w = (key) => missShare * mean(out.miss.map((x) => x[key])) + (1 - missShare) * mean(out.hit.map((x) => x[key]))
    console.log(`  weighted ${(100 * w("a")).toFixed(2)} vs ${(100 * w("b")).toFixed(2)}`)
}
console.log("  by route: " + Object.entries(byCell).sort().map(([k, c]) => `${k} n ${c.n} +${c.plus}/−${c.minus}`).join(" | "))
console.log(`  real variant: wall ${Math.round(mean(walls))} ms, real calls ${mean(calls).toFixed(2)}`)
if (show) for (const st of ["hit", "miss"]) for (const x of out[st]) if (x.a !== x.b) {
    const r = pool.byKey.get(x.k)
    console.log(`\n[${x.a > x.b ? "+" : "−"} ${st} ${x.how}] Q: ${r.question}\n  G: ${r.gold}`)
}
emails.close()
