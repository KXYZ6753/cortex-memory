// Worker lite: where m2's recovery and g5's handover spend time (stored det runs; no GPU).
//   node benchmarks/premise2/explore2/tools/lite-cost.js [S300-1]
import { openAll } from "./a-lib.js"
const set = process.argv[2] ?? "S300-1"
const { graded } = await openAll()
const byKey = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i.answer]))
const X = byKey("i-det-x1@2+cold"), T = byKey("i-det-tlk@2+cold"), Q = byKey("q-det-q1@1+cold")
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const groups = {}
for (const [k, q] of Q) {
    const t = T.get(k), x = X.get(k)
    if (!t || !x) continue
    const s = q.step
    const g = s === "commit" ? (q.q?.m2Fired ? "commit+m2 noE" : "commit") : s === "commit-g5" ? (q.q?.m2Fired ? "g5 after m2" : "g5") : s.startsWith("recover") ? s : "explore"
    const e = (groups[g] ??= { n: 0, dWall: [], dGen: [], dCalls: [], recProbes: [], recPos: [], xg5: [], xg5gen: [], qWall: [], tWall: [] })
    e.n++
    e.dWall.push(q.wallMs - t.wallMs); e.dGen.push(q.genMs - t.genMs); e.dCalls.push(q.calls - t.calls)
    e.qWall.push(q.wallMs); e.tWall.push(t.wallMs)
    const rec = (q.log ?? []).filter((l) => l.act === "rec")
    e.recProbes.push(rec.length)
    if (q.q?.recovered) e.recPos.push(rec.findIndex((l) => l.path === q.q.recovered) + 1)
    if (x.step === "commit-g5") { e.xg5.push(x.wallMs - t.wallMs); e.xg5gen.push(x.genMs - t.genMs) }
}
console.log(`${set}: q1 − det t-lk per path (ms), and det x1's g5 part`)
console.log(`| q1 path | n | Δwall | Δgen | Δnon-gen (CPU) | Δcalls | rec probes | E at probe # | det x1 g5 Δwall (Δgen) | q1 wall | t-lk wall |`)
for (const [g, e] of Object.entries(groups)) console.log(`| ${g} | ${e.n} | ${Math.round(mean(e.dWall))} | ${Math.round(mean(e.dGen))} | ${Math.round(mean(e.dWall) - mean(e.dGen))} | ${mean(e.dCalls).toFixed(1)} | ${mean(e.recProbes).toFixed(1)} | ${e.recPos.join(",")} | ${Math.round(mean(e.xg5))} (${Math.round(mean(e.xg5gen))}) | ${Math.round(mean(e.qWall))} | ${Math.round(mean(e.tWall))} |`)
process.exit(0)
