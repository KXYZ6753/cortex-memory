// Worker k (agent control loop): offline stop-rule simulation on S300-2 from stored
// gates / w7 / r5 / a2 answers (w7 stores e2b's YES/NO probe for <= 20 candidates).
// node benchmarks/premise2/explore2/tools/k-sim.js [set]
import { openAll, weightedOf } from "./a-lib.js"
const setName = process.argv[2] ?? "S300-2"
const { graded, bearing, missShare } = await openAll()
const get = (v) => new Map(graded(v, setName).map((i) => [i.record.questionKey, i]))
const gates = get("gates@1+cold"), w7 = get("w7@1+cold"), r5 = get("r5@1+cold"), a2 = get("a2@1+cold"), w6 = get("w6@1+cold")
const rows = []
for (const [key, g] of gates) {
    const w = w7.get(key); if (!w) continue
    const isAB = bearing(g.record)
    const W0 = g.answer.contextPaths
    const yes = new Set(w.answer.yes)
    const yesW0 = W0.filter((p) => yes.has(p))
    rows.push({ key, record: g.record, g, w, r: r5.get(key), a: a2.get(key), W0, yesW0, abW0: W0.filter(isAB), ab1: isAB(W0[0]), yes1: yes.has(W0[0]), anyYesAB: w.answer.yes.some(isAB), candAB: w.answer.candidates.some(isAB) })
}
const tab = (name, f) => { const t = {}; for (const r of rows) { const k = `${r.record.stratum} ${f(r)}`; t[k] ??= { n: 0, gates: 0, w7: 0, r5: 0 }; t[k].n++; t[k].gates += r.g.correct; t[k].w7 += r.w.correct; t[k].r5 += r.r?.correct ?? 0 } ; console.log(name); console.table(t) }
tab("YES on W0[0] / any YES in W0", (r) => `y1=${+r.yes1} anyW0=${+(r.yesW0.length > 0)} abW0=${+(r.abW0.length > 0)}`)
const policy = (name, pick) => { const items = rows.map((r) => ({ record: r.record, correct: pick(r).correct })); const s = weightedOf(items, missShare); console.log(name.padEnd(48), (100*s.weighted).toFixed(1), (100*s.miss).toFixed(1), (100*s.hit).toFixed(1)) }
policy("gates", (r) => r.g)
policy("w7", (r) => r.w)
policy("r5", (r) => r.r)
policy("stop if any YES in W0 -> gates else w7", (r) => (r.yesW0.length ? r.g : r.w))
policy("stop if W0[0] YES -> gates else w7", (r) => (r.yes1 ? r.g : r.w))
policy("stop if any YES in W0 -> r5 else w7", (r) => (r.yesW0.length ? r.r : r.w))
policy("oracle(gates,w7)", (r) => ({ correct: Math.max(r.g.correct, r.w.correct) }))
// The explore arena: questions with no YES in W0.
const arena = rows.filter((r) => !r.yesW0.length)
const t2 = {}
for (const r of arena) {
    const isAB = bearing(r.record)
    const shown = r.a?.answer.shownPaths ?? []
    const pickN = Number(String(r.a?.answer.picks?.[0] ?? "").match(/\d+/)?.[0])
    const picked = shown[pickN - 1]
    const k = `${r.record.stratum} candAB=${+r.candAB} yesAB=${+r.anyYesAB} listAB=${+shown.some(isAB)}`
    t2[k] ??= { n: 0, gates: 0, w7: 0, a2: 0, a2pickAB: 0, nYes: 0 }
    const o = t2[k]; o.n++; o.gates += r.g.correct; o.w7 += r.w.correct; o.a2 += r.a?.correct ?? 0; o.a2pickAB += picked && isAB(picked) ? 1 : 0; o.nYes += r.w.answer.yes.length
}
console.table(t2)
