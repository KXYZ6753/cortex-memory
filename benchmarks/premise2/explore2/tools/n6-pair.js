// Worker n6: a single-config n6 variant vs its det parent on hits (offline, no GPU). Per set and
// pooled: Δ hit points with question and mailbox-cluster bootstrap CIs (mulberry32, B = 10,000),
// +fixed/−broken, how often the logged greedy text equals the parent's answer, fired share,
// flips split by fired / not fired and by E1 = gold, mean wall ms and model calls (counted ctx
// calls + raw calls + resets) for both arms.
//   node benchmarks/premise2/explore2/tools/n6-pair.js <variant@ver> <set,set> [parent@ver]
import { openN6, hitDelta, fmtD } from "./n6-lib.js"
const [v, setsArg, parentArg = "i-det-gates@2+cold"] = process.argv.slice(2)
const { graded } = await openN6()
const all = []
const rows = []
for (const s of setsArg.split(",")) {
    const P = new Map(graded(parentArg, s).map((i) => [i.record.questionKey, i]))
    const pairs = []
    for (const it of graded(v, s)) {
        if (it.record.stratum !== "hit" || it.correct == null || !it.answer.n6) continue
        const p = P.get(it.record.questionKey)
        if (!p || p.correct == null) continue
        const inf = it.answer.n6.info ?? []
        const last = inf.at(-1) ?? {}
        const e1gold = last.e1 === it.record.path || (it.record.twins ?? []).includes(last.e1)
        const x = {
            user: it.record.user, d: it.correct - p.correct, set: s,
            fired: inf.some((f) => f.fired), greedySame: inf.length && (inf[0].greedy ?? "").trim() === (it.answer.used > 1 ? null : p.answer.answer.trim()),
            changed: it.answer.answer.trim() !== p.answer.answer.trim(), e1gold,
            wall: it.answer.wallMs, pwall: p.answer.wallMs, calls: (it.answer.calls ?? 0) + (it.answer.n6RawCalls ?? 0), pcalls: p.answer.calls ?? 0,
        }
        pairs.push(x); all.push(x)
    }
    rows.push([s, pairs])
}
const line = (name, pairs) => {
    if (!pairs.length) return `${name}: no pairs`
    const h = hitDelta(pairs)
    const m = (f) => pairs.reduce((a, p) => a + f(p), 0) / pairs.length
    const fl = (f) => { const q = pairs.filter(f); return `+${q.filter((p) => p.d > 0).length}/-${q.filter((p) => p.d < 0).length}` }
    return `${name.padEnd(8)} Δ ${fmtD(h)}\n         fired ${pairs.filter((p) => p.fired).length}, answer changed ${pairs.filter((p) => p.changed).length}, greedy == parent ${pairs.filter((p) => p.greedySame).length}; flips fired ${fl((p) => p.fired)}, not fired ${fl((p) => !p.fired)}; E1=gold ${fl((p) => p.e1gold)}, E1≠gold ${fl((p) => !p.e1gold)}\n         wall ${Math.round(m((p) => p.wall))} ms (parent ${Math.round(m((p) => p.pwall))}), calls ${m((p) => p.calls).toFixed(2)} (parent ${m((p) => p.pcalls).toFixed(2)})`
}
console.log(`${v} vs ${parentArg}, hits`)
for (const [s, pairs] of rows) console.log(line(s, pairs))
if (rows.length > 1) console.log(line("POOLED", all))
process.exit(0)
