// Worker lite: results of the det-wrapped lite stacks vs the det baselines (i-det-x1 v2,
// q-det-q1, i-det-tlk v2, i-det-gates v2), per set and pooled; flips by path; byte-identity
// with the parent on paths where only one parent's calls are issued; wall (mean, p95), calls
// (all and real = without det's resets). No GPU.
//   node benchmarks/premise2/explore2/tools/lite-table.js <set,set,...> [lite-det-ub,lite-det-u,lite-det-a]
import { openAll, weightedOf } from "./a-lib.js"
import { pairedBootstrap } from "../../explore/analyze.js"

const args = process.argv.slice(2)
const sets = (args[0] ?? "S300-1").split(",")
const variants = (args[1] ?? "lite-det-ub,lite-det-u,lite-det-a").split(",").map((v) => (v.includes("@") ? v : `${v}@1+cold`))
const REFS = { "det x1": "i-det-x1@2+cold", "det q1": "q-det-q1@1+cold", "det t-lk": "i-det-tlk@2+cold", "det gates": "i-det-gates@2+cold" }
const { graded, missShare } = await openAll()
const pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) : "–")
const sg = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}` : "–")
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] }
// gates behind det is byte-identical to stored gates (i.md §7), so stored gates stands in where i-det-gates was not run
const FALLBACK = { "i-det-gates@2+cold": "gates@1+cold" }
const map0 = (vAt, set) => new Map(graded(vAt, set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
const map = (vAt, set) => { const m = map0(vAt, set); return m.size || !FALLBACK[vAt] ? m : map0(FALLBACK[vAt], set) }
const isExplore = (s) => ["found", "nofound", "nopick"].includes(s)

function litePath(a) {
    const s = String(a.step), l = a.lite ?? {}
    if (s === "commit") return l.m2Fired ? "sure commit, m2 probed, no E" : "sure commit"
    if (s === "commit-unsure") return l.m2Fired ? "unsure commit, m2 probed, no E (A kept)" : "unsure commit (A kept)"
    if (s.startsWith("recover")) return `m2 recovery (${s.slice(8)})`
    if (s === "commit-g5") return "doubted unsure, no E: seeded g5"
    if (isExplore(s)) return "explore (lean, d6 list)"
    return s
}
const refPath = (a) => (a.step === "commit" ? "commit" : a.step === "commit-unsure" ? "unsure commit (A)" : String(a.step).startsWith("commit-") ? "handover" : String(a.step).startsWith("recover") ? "recover" : isExplore(a.step) ? "explore" : String(a.step))

const out = []
for (const v of variants) {
    out.push(`\n## ${v}`)
    out.push(`| set | n | weighted | miss | hit | ${Object.keys(REFS).map((r) => `Δ vs ${r} [95% CI] (disc. miss · hit)`).join(" | ")} | wall ms (p95) | calls (real) | reset ms/q |`)
    out.push(`|---|---|---|---|---|${Object.keys(REFS).map(() => "---|").join("")}---|---|---|`)
    const pool = { items: [], pairs: Object.fromEntries(Object.keys(REFS).map((r) => [r, []])), wall: [], calls: [], resets: [], resetMs: [] }
    const flips = {}
    for (const set of [...sets, "pooled"]) {
        let items, pairs, wall, calls, resets, resetMs
        if (set === "pooled") {
            if (sets.length < 2) continue
            ;({ items, pairs, wall, calls, resets, resetMs } = pool)
        } else {
            const A = map(v, set)
            if (!A.size) { out.push(`| ${set} | 0 |`); continue }
            const R = Object.fromEntries(Object.entries(REFS).map(([r, id]) => [r, map(id, set)]))
            items = [...A.values()]; pairs = Object.fromEntries(Object.keys(REFS).map((r) => [r, []]))
            wall = items.map((i) => i.answer.wallMs); calls = items.map((i) => i.answer.calls); resets = items.map((i) => i.answer.det?.resets ?? 0); resetMs = items.map((i) => i.answer.det?.resetMs ?? 0)
            for (const a of items) {
                for (const r of Object.keys(REFS)) {
                    const b = R[r].get(a.record.questionKey)
                    if (b) pairs[r].push({ user: a.record.user, stratum: a.record.stratum, a: a.correct, b: b.correct })
                }
                for (const r of ["det x1", "det t-lk", "det q1"]) {
                    const b = R[r].get(a.record.questionKey)
                    if (!b) continue
                    const k = `vs ${r} | ${a.record.stratum} | ${refPath(b.answer)} → ${litePath(a.answer)}`
                    const f = (flips[k] ??= { n: 0, plus: 0, minus: 0, same: 0, sets: {} })
                    f.n++; f.plus += a.correct > b.correct; f.minus += a.correct < b.correct; f.same += a.answer.answer === b.answer.answer
                    const fs = (f.sets[set] ??= [0, 0]); fs[0] += a.correct > b.correct; fs[1] += a.correct < b.correct
                }
            }
            pool.items.push(...items); for (const r of Object.keys(REFS)) pool.pairs[r].push(...pairs[r])
            pool.wall.push(...wall); pool.calls.push(...calls); pool.resets.push(...resets); pool.resetMs.push(...resetMs)
        }
        const w = weightedOf(items, missShare)
        const cell = (r) => {
            const P = pairs[r]
            if (!P.length) return "–"
            const b = pairedBootstrap(P, missShare)
            const d = (st) => { const l = P.filter((p) => p.stratum === st); return `+${l.filter((p) => p.a > p.b).length}/−${l.filter((p) => p.a < p.b).length}` }
            return `${sg(b.weighted, 2)} [${sg(b.low)}, ${sg(b.high)}] (${d("miss")} · ${d("hit")})${P.length !== items.length ? ` n ${P.length}` : ""}`
        }
        out.push(`| ${set} | ${items.length} | ${pct(w.weighted)} | ${pct(w.miss)} | ${pct(w.hit)} | ${Object.keys(REFS).map(cell).join(" | ")} | ${Math.round(mean(wall))} (${p95(wall)}) | ${mean(calls).toFixed(2)} (${(mean(calls) - mean(resets)).toFixed(2)}) | ${Math.round(mean(resetMs))} |`)
    }
    out.push(`\nFlips by path (reference path → lite route): n, +/−, same answer text; per set +/−`)
    out.push(`| reference | stratum | path | n | + | − | same text | per set |`)
    out.push(`|---|---|---|---|---|---|---|---|`)
    for (const [k, f] of Object.entries(flips).sort()) {
        const [ref, st, path] = k.split(" | ")
        out.push(`| ${ref.slice(3)} | ${st} | ${path} | ${f.n} | ${f.plus} | ${f.minus} | ${f.same} | ${Object.entries(f.sets).map(([s, [p, m]]) => `${s} +${p}/−${m}`).join(", ")} |`)
    }
    // reference walls on the same questions
    const refWalls = Object.entries(REFS).map(([r, id]) => {
        const ws = [], cs = [], rs = []
        for (const set of sets) { const M = map(id, set), A = map(v, set); for (const k of A.keys()) { const b = M.get(k); if (b) { ws.push(b.answer.wallMs); cs.push(b.answer.calls); rs.push(b.answer.det?.resets ?? 0) } } }
        return ws.length ? `${r} ${Math.round(mean(ws))} ms (p95 ${p95(ws)}), calls ${mean(cs).toFixed(2)} (real ${(mean(cs) - mean(rs)).toFixed(2)}), n ${ws.length}` : `${r} –`
    })
    out.push(`\nReferences on the same questions: ${refWalls.join("; ")}`)
}
console.log(out.join("\n"))
process.exit(0)
