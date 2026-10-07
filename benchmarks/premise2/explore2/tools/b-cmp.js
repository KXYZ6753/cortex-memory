// Worker b: paired comparison of two variants over one or more sets (offline; stored
// answers + J1 verdicts). Per set and pooled: weighted / miss / hit, Δ with the
// mailbox-cluster paired bootstrap CI (explore/analyze.js), verdict flips by stratum and
// by the variant's path (x1 steps), identical-text share, wall ms and calls.
//   node benchmarks/premise2/explore2/tools/b-cmp.js <A> <B> <set,set,...> [hitsOnly]
import { pairedBootstrap } from "../../explore/analyze.js"
import { pool, loadTable, missShare } from "./b-lib.js"
import { normaliseAnswer } from "../../judge.js"

const [A, B, setsArg, hitsOnly] = process.argv.slice(2)
const sets = setsArg.split(",")
const f1 = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) : "-")
const all = []
const rows = []
for (const setName of sets) {
    const { table, keys } = loadTable(setName, [A, B])
    const a = table.get(A), b = table.get(B)
    if (!a || !b) { console.log(`${setName}: missing ${!a ? A : B}`); continue }
    const pairs = []
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (hitsOnly && r.stratum !== "hit") continue
        const x = a.get(key), y = b.get(key)
        if (!x || !y || x.correct === null || y.correct === null) continue
        pairs.push({ set: setName, key, user: r.user, stratum: r.stratum, a: x.correct, b: y.correct, same: normaliseAnswer(x.answer) === normaliseAnswer(y.answer), stepA: x.a.step ?? "-", stepB: y.a.step ?? "-", wallA: x.a.wallMs, wallB: y.a.wallMs, callsA: x.a.calls, callsB: y.a.calls })
    }
    all.push(...pairs)
    rows.push([setName, pairs])
}
rows.push(["pooled", all])
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length)
console.log(`${A} vs ${B}${hitsOnly ? " (hits only)" : ""}`)
console.log("set      n    A w    B w   Δw [95% CI]            A miss B miss  A hit  B hit | hit flips +/-  miss flips +/- | same text | wall A/B | calls A/B")
for (const [name, pairs] of rows) {
    if (!pairs.length) continue
    const bs = pairedBootstrap(pairs, missShare)
    const wA = mean(pairs.filter((p) => p.stratum === "miss").map((p) => p.a)) * missShare + mean(pairs.filter((p) => p.stratum === "hit").map((p) => p.a)) * (1 - missShare)
    const wB = mean(pairs.filter((p) => p.stratum === "miss").map((p) => p.b)) * missShare + mean(pairs.filter((p) => p.stratum === "hit").map((p) => p.b)) * (1 - missShare)
    const st = (s, k) => pairs.filter((p) => p.stratum === s).map((p) => p[k])
    const flips = (s) => `+${pairs.filter((p) => p.stratum === s && p.a > p.b).length}/-${pairs.filter((p) => p.stratum === s && p.a < p.b).length}`
    console.log(`${name.padEnd(7)}${String(pairs.length).padStart(5)} ${f1(wA).padStart(6)} ${f1(wB).padStart(6)} ${(bs.weighted >= 0 ? "+" : "") + f1(bs.weighted)} [${f1(bs.low)}, ${f1(bs.high)}]`.padEnd(48) + ` ${f1(mean(st("miss", "a"))).padStart(6)} ${f1(mean(st("miss", "b"))).padStart(6)} ${f1(mean(st("hit", "a"))).padStart(6)} ${f1(mean(st("hit", "b"))).padStart(6)} | ${flips("hit").padStart(10)} ${flips("miss").padStart(12)} | ${f1(mean(pairs.map((p) => (p.same ? 1 : 0))))}% | ${Math.round(mean(pairs.map((p) => p.wallA)))}/${Math.round(mean(pairs.map((p) => p.wallB)))} | ${mean(pairs.map((p) => p.callsA)).toFixed(2)}/${mean(pairs.map((p) => p.callsB)).toFixed(2)}`)
}
// flips by A's path
const steps = [...new Set(all.map((p) => p.stepA))]
if (steps.length > 1 || steps[0] !== "-") {
    console.log("\nflips by A's path (pooled): step  n  hit +/-  miss +/-  same-text")
    for (const s of steps) {
        const p = all.filter((x) => x.stepA === s)
        const fl = (st) => `+${p.filter((x) => x.stratum === st && x.a > x.b).length}/-${p.filter((x) => x.stratum === st && x.a < x.b).length}`
        console.log(`  ${s.padEnd(12)} ${String(p.length).padStart(4)}  ${fl("hit").padStart(7)}  ${fl("miss").padStart(7)}  ${f1(mean(p.map((x) => (x.same ? 1 : 0))))}%`)
    }
    console.log("path changes A vs B (pooled): " + JSON.stringify(Object.entries(all.reduce((m, x) => { const k = `${x.stepB}->${x.stepA}`; m[k] = (m[k] ?? 0) + 1; return m }, {})).sort((x, y) => y[1] - x[1]).slice(0, 12)))
}
