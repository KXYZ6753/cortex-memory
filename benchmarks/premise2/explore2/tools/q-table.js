// Worker q: results of the det-wrapped stacks vs the det-wrapped x1 baseline (and vs stored
// unwrapped x1 and gates, for reference), per set and pooled; flips by path; untouched-path
// identity; wall and calls (with and without det's reset calls). No GPU.
//   node benchmarks/premise2/explore2/tools/q-table.js <set,set,...> [q-det-q1,q-det-q2] [--ref i-det-x1@2+cold]
import { openAll, weightedOf } from "./a-lib.js"
import { pairedBootstrap } from "../../explore/analyze.js"

const args = process.argv.slice(2)
const sets = (args[0] ?? "S300-1").split(",")
const variants = (args[1] && !args[1].startsWith("--") ? args[1] : "q-det-q1,q-det-q2").split(",").map((v) => (v.includes("@") ? v : `${v}@1+cold`))
const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "i-det-x1@2+cold"
const OTHERS = ["x1@1+cold", "gates@1+cold"]
const { graded, missShare } = await openAll()

const pct = (x, d = 1) => (Number.isFinite(x) ? (100 * x).toFixed(d) : "–")
const sgn = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}` : "–")
const ci = (b) => `${sgn(b.weighted, 2)} [${sgn(b.low)}, ${sgn(b.high)}]`
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] }
const map = (vAt, set) => new Map(graded(vAt, set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))

const isExplore = (s) => ["found", "nofound", "nopick"].includes(s)
const xPath = (a) => (a.step === "commit" ? "commit" : String(a.step).startsWith("commit-") ? "handover" : isExplore(a.step) ? "explore" : String(a.step))
function qPath(a) {
    const s = String(a.step), q = a.q ?? {}
    if (s === "commit") return q.m2Fired ? "sure commit, m2 probed, no E" : "sure commit"
    if (s.startsWith("recover")) return `m2 recovery (${s.slice(8)})`
    if (s === "commit-g5") return q.m2Fired ? "handover after m2 probes (no E), seeded" : "handover, seeded"
    if (isExplore(s)) return "explore"
    return s
}
const firstList = (a) => JSON.stringify((a.log ?? []).find((l) => l.act === "pick")?.listed ?? null)
const detail = (a, r) => {
    const qp = qPath(a)
    if (qp === "explore" && xPath(r) === "explore") return firstList(a) === firstList(r) ? " · list same" : " · list changed"
    if (qp.startsWith("handover") && xPath(r) === "handover") return JSON.stringify(a.shownPaths ?? null) === JSON.stringify(r.shownPaths ?? null) ? " · g5 saw the same" : " · seed changed g5's results"
    return ""
}

const out = []
for (const v of variants) {
    const pooled = { pairs: [], pairsO: Object.fromEntries(OTHERS.map((o) => [o, []])), items: [], refItems: [], wall: [], wallRef: [], calls: [], callsRef: [], resets: [], resetMs: [], resetsRef: [], resetMsRef: [], flips: {} }
    out.push(`\n## ${v} vs ${ref}`)
    out.push(`| set | n | weighted | miss | hit | ref weighted | Δ vs ref [95% CI] | Δ vs x1 (stored) | Δ vs gates | wall ms (ref) | p95 wall | calls (ref) | real calls (ref) | reset ms/q |`)
    out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`)
    for (const set of [...sets, "pooled"]) {
        let P, PO, items, refItems, wall, wallRef, calls, callsRef, resets, resetMs, resetsRef
        if (set === "pooled") {
            if (sets.length < 2) continue
            ;({ pairs: P, items, refItems, wall, wallRef, calls, callsRef, resets, resetMs, resetsRef } = pooled)
            PO = pooled.pairsO
        } else {
            const A = map(v, set), R = map(ref, set)
            const O = Object.fromEntries(OTHERS.map((o) => [o, map(o, set)]))
            P = []; PO = Object.fromEntries(OTHERS.map((o) => [o, []])); items = []; refItems = []; wall = []; wallRef = []; calls = []; callsRef = []; resets = []; resetMs = []; resetsRef = []
            for (const [key, a] of A) {
                const r = R.get(key)
                if (!r) continue
                P.push({ user: a.record.user, stratum: a.record.stratum, a: a.correct, b: r.correct })
                for (const o of OTHERS) { const x = O[o].get(key); if (x) PO[o].push({ user: a.record.user, stratum: a.record.stratum, a: a.correct, b: x.correct }) }
                items.push(a); refItems.push(r)
                wall.push(a.answer.wallMs); wallRef.push(r.answer.wallMs); calls.push(a.answer.calls); callsRef.push(r.answer.calls)
                resets.push(a.answer.det?.resets ?? 0); resetMs.push(a.answer.det?.resetMs ?? 0); resetsRef.push(r.answer.det?.resets ?? 0)
                const k = `${a.record.stratum} | x1 ${xPath(r.answer)} → ${qPath(a.answer)}${detail(a.answer, r.answer)}`
                const f = (pooled.flips[k] ??= { n: 0, plus: 0, minus: 0, same: 0, sets: {} })
                f.n++; f.plus += a.correct > r.correct; f.minus += a.correct < r.correct; f.same += a.answer.answer === r.answer.answer
                const fs = (f.sets[set] ??= [0, 0]); fs[0] += a.correct > r.correct; fs[1] += a.correct < r.correct
            }
            pooled.pairs.push(...P); for (const o of OTHERS) pooled.pairsO[o].push(...PO[o])
            pooled.items.push(...items); pooled.refItems.push(...refItems); pooled.wall.push(...wall); pooled.wallRef.push(...wallRef)
            pooled.calls.push(...calls); pooled.callsRef.push(...callsRef); pooled.resets.push(...resets); pooled.resetMs.push(...resetMs); pooled.resetsRef.push(...resetsRef)
        }
        if (!P.length) { out.push(`| ${set} | 0 | | | | | | | | | | | | |`); continue }
        const w = weightedOf(items, missShare), wr = weightedOf(refItems, missShare)
        const b = pairedBootstrap(P, missShare)
        const bo = OTHERS.map((o) => (PO[o].length === P.length ? ci(pairedBootstrap(PO[o], missShare)) : PO[o].length ? `${ci(pairedBootstrap(PO[o], missShare))} (n ${PO[o].length})` : "–"))
        out.push(`| ${set} | ${P.length} | ${pct(w.weighted)} | ${pct(w.miss)} | ${pct(w.hit)} | ${pct(wr.weighted)} | **${ci(b)}** | ${bo[0]} | ${bo[1]} | ${Math.round(mean(wall))} (${Math.round(mean(wallRef))}) | ${p95(wall)} | ${mean(calls).toFixed(2)} (${mean(callsRef).toFixed(2)}) | ${(mean(calls) - mean(resets)).toFixed(2)} (${(mean(callsRef) - mean(resetsRef)).toFixed(2)}) | ${Math.round(mean(resetMs))} |`)
    }
    out.push(`\nFlips vs ${ref} by path (x1's path → the stack's route): n, +/−, same answer text; per set +/−`)
    out.push(`| stratum | path | n | + | − | same text | per set |`)
    out.push(`|---|---|---|---|---|---|---|`)
    for (const [k, f] of Object.entries(pooled.flips).sort()) {
        const [stratum, path] = k.split(" | x1 ")
        out.push(`| ${stratum} | x1 ${path} | ${f.n} | ${f.plus} | ${f.minus} | ${f.same} | ${Object.entries(f.sets).map(([s, [p, m]]) => `${s} +${p}/−${m}`).join(", ")} |`)
    }
}
console.log(out.join("\n"))
process.exit(0)
