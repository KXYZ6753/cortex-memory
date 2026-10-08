// Worker n6: evaluate the configurations an n6 multi-config diagnostic logged (offline, no GPU).
// Reference = the run's own greedy pass (its official answer; behind det it equals the det
// parent's answer, checked here). Each config is also evaluated gated: the config's answer
// is used only when the greedy pass's mean token logprob < tau, else the greedy answer.
// Hits only. Δ in hit points with question and mailbox-cluster bootstrap CIs (mulberry32).
// Cost: estimated single-config wall = context build + the config's own raw calls and resets.
//   node benchmarks/premise2/explore2/tools/n6-eval.js <variant@ver> <set,set> [parent@ver]
import { openN6, hitDelta, fmtD } from "./n6-lib.js"
const [v, setsArg, parentArg] = process.argv.slice(2)
const { graded, verdictOf } = await openN6()
const sets = setsArg.split(",")
const TAUS = [null, -0.05, -0.1, -0.15, -0.2]
const items = []
let parentSame = 0, parentN = 0, parentDisc = [0, 0]
for (const s of sets) {
    const parentName = parentArg ?? (graded("i-det-gates@2+cold", s).length ? "i-det-gates@2+cold" : "gates@1+cold")
    const P = new Map(graded(parentName, s).map((i) => [i.record.questionKey, i]))
    for (const it of graded(v, s)) {
        if (it.record.stratum !== "hit" || !it.answer.n6 || it.correct == null) continue
        const p = P.get(it.record.questionKey)
        if (p) {
            parentN++
            if (p.answer.answer.trim() === it.answer.answer.trim()) parentSame++
            else if (p.correct != null && p.correct !== it.correct) parentDisc[p.correct > it.correct ? 1 : 0]++
        }
        items.push(it)
    }
}
console.log(`${v} over ${setsArg}: ${items.length} graded hits; greedy == parent text ${parentSame}/${parentN} (discordant verdicts where texts differ: greedy +${parentDisc[0]}/-${parentDisc[1]})`)
const greedyRight = items.reduce((s, i) => s + i.correct, 0)
const meanWall = (f) => Math.round(items.reduce((s, i) => s + f(i), 0) / items.length)
console.log(`greedy: ${greedyRight}/${items.length} = ${(100 * greedyRight / items.length).toFixed(1)}; est. wall greedy-only ${meanWall((i) => i.answer.n6.ctxMs + i.answer.n6.baseCost.ms)} ms, run wall ${meanWall((i) => i.answer.wallMs)} ms`)
const cfgNames = Object.keys(items[0]?.answer.n6.cfg ?? {})
for (const name of cfgNames) {
    for (const tau of TAUS) {
        const pairs = []
        let unknown = 0, fired = 0, wall = 0, calls = 0, e1gold = [0, 0], e1other = [0, 0]
        for (const i of items) {
            const c = i.answer.n6.cfg[name]
            const fire = tau === null || (i.answer.n6.greedy.mean ?? 0) < tau
            const text = fire ? c.answer : i.answer.answer
            const ok = fire ? verdictOf(c.answer, i.record, c.status) : i.correct
            if (ok == null) { unknown++; continue }
            if (fire) { fired++; wall += i.answer.n6.ctxMs + c.ms; calls += c.calls + c.resets } else { wall += i.answer.n6.ctxMs + i.answer.n6.baseCost.ms; calls += i.answer.n6.baseCost.calls + i.answer.n6.baseCost.resets }
            const d = ok - i.correct
            pairs.push({ user: i.record.user, d })
            const gold = i.answer.n6.e1 === i.record.path || (i.record.twins ?? []).includes(i.answer.n6.e1)
            const bucket = gold ? e1gold : e1other
            if (d > 0) bucket[0]++
            if (d < 0) bucket[1]++
            void text
        }
        const h = hitDelta(pairs)
        console.log(`${name.padEnd(7)} tau ${String(tau ?? "none").padEnd(5)} fired ${String(fired).padStart(4)}  Δ ${fmtD(h)}  E1=gold +${e1gold[0]}/-${e1gold[1]}, E1≠gold +${e1other[0]}/-${e1other[1]}  wall ~${Math.round(wall / pairs.length)} ms, calls ${(calls / pairs.length).toFixed(1)}${unknown ? `  UNGRADED ${unknown}` : ""}`)
    }
}
process.exit(0)
