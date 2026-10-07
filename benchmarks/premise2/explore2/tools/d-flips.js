// Worker d: paired comparison of a d variant with x1 (and gates) per set and pooled:
// weighted / miss / hit, Δ with the mailbox-cluster paired bootstrap CI (explore/analyze.js),
// wall ms and calls, and flips by path (x1's step; whether the explore list / g5 search changed).
//   node benchmarks/premise2/explore2/tools/d-flips.js <variant> <set,set,...> [--ref x1]
// Replay variants (d*r): wall/calls of replayed rows are x1's stored ones.
import { openAll } from "./a-lib.js"
import { pairedBootstrap, weighted } from "../../explore/analyze.js"
import { openBm25 } from "../../bm25.js"
import { byHeaderRank } from "../../explore/variants.js"

const [variant, setsArg, ...rest] = process.argv.slice(2)
const ref = rest.includes("--ref") ? rest[rest.indexOf("--ref") + 1] : "x1"
const sets = setsArg.split(",")
const { graded, bearing, missShare, emails } = await openAll()
const bm25 = openBm25(".data/premise2/corpus.sqlite")
// d8: did seeding the YES email change the top 3 g5 read in full? (replayed with d8's own query)
const seedChanged = (ans, record) => {
    const q = (ans.g5?.actions ?? []).find((x) => x.name === "search_mailbox" && !x.auto)?.args?.query
    if (!ans.dYesPath || !q) return null
    const base = bm25.search(String(q).trim() || record.question, 20, record.user).map((h) => h.path)
    const a = byHeaderRank(q, base, emails.emailOf).slice(0, 3), b = byHeaderRank(q, [...new Set([ans.dYesPath, ...base])].slice(0, 20), emails.emailOf).slice(0, 3)
    return a.join() !== b.join()
}
const at = (v) => `${v}@1+cold`
const fmt = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) : "–")
const pooled = { pairs: [], pairsG: [], wall: [], calls: [], wallRef: [], callsRef: [], flips: {} }
const rows = []
for (const set of sets) {
    const A = new Map(graded(at(variant), set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
    const R = new Map(graded(at(ref), set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
    const Gt = new Map(graded(at("gates"), set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
    const pairs = [], pairsG = []
    const wall = [], calls = [], wallRef = [], callsRef = []
    for (const [key, a] of A) {
        const r = R.get(key)
        if (!r) continue
        pairs.push({ user: a.record.user, stratum: a.record.stratum, a: a.correct, b: r.correct })
        const g = Gt.get(key)
        if (g) pairsG.push({ user: a.record.user, stratum: a.record.stratum, a: a.correct, b: g.correct })
        const replayed = a.answer.replay === true
        wall.push(replayed ? a.answer.x1Wall : a.answer.wallMs); calls.push(replayed ? a.answer.x1Calls : a.answer.calls)
        wallRef.push(r.answer.wallMs); callsRef.push(r.answer.calls)
        // path label: the reference's path, plus what the d change did on this question
        const step = String(r.answer.step ?? "?")
        const xPath = step === "commit" ? "commit" : step.startsWith("commit-") ? "handover" : "explore"
        const dStep = String(a.answer.step ?? "?")
        const firstList = (ans) => JSON.stringify((ans.log ?? []).find((l) => l.act === "pick")?.listed ?? null)
        let detail = ""
        if (replayed) detail = "replayed"
        else if (xPath === "explore" && dStep !== "commit" && !dStep.startsWith("commit-")) detail = firstList(a.answer) === firstList(r.answer) ? "list same" : "list changed"
        else if (xPath === "handover" && dStep.startsWith("commit-")) { const sc = seedChanged(a.answer, a.record); detail = a.answer.dG5Fused ? "g5 fused" : sc === null ? "g5" : sc ? "g5 seed changed top 3" : "g5 seed no-op" }
        else detail = `d took ${dStep}`
        const k = `${a.record.stratum} | x1 ${xPath} | ${detail}`
        const f = (pooled.flips[k] ??= { n: 0, plus: 0, minus: 0, sameText: 0 })
        f.n++
        f.plus += a.correct > r.correct
        f.minus += a.correct < r.correct
        f.sameText += a.answer.answer === r.answer.answer
    }
    const bs = pairedBootstrap(pairs, missShare)
    const bsG = pairsG.length ? pairedBootstrap(pairsG, missShare) : null
    const w = weighted(pairs.map((p) => ({ stratum: p.stratum, v: p.a })), missShare, (i) => i.v)
    const mean = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0) / Math.max(xs.length, 1)
    rows.push({ set, n: pairs.length, w, bs, bsG, wall: mean(wall), calls: mean(calls), wallRef: mean(wallRef), callsRef: mean(callsRef) })
    pooled.pairs.push(...pairs); pooled.pairsG.push(...pairsG)
    pooled.wall.push(...wall); pooled.calls.push(...calls); pooled.wallRef.push(...wallRef); pooled.callsRef.push(...callsRef)
}
const mean = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0) / Math.max(xs.length, 1)
console.log(`${variant} vs ${ref} (and gates), J1 weighted (miss share ${fmt(missShare, 1)}%)`)
console.log("set      n    weighted  miss   hit   Δ vs ref [95% CI]       Δ vs gates [95% CI]     wall ms (ref)   calls (ref)")
const line = (name, n, w, bs, bsG, wall, calls, wallRef, callsRef) => console.log(`${name.padEnd(8)} ${String(n).padStart(4)}  ${fmt(w.weighted).padStart(6)}  ${fmt(w.miss).padStart(5)} ${fmt(w.hit).padStart(5)}   ${(bs.weighted >= 0 ? "+" : "") + fmt(bs.weighted)} [${fmt(bs.low)}, ${fmt(bs.high)}]`.padEnd(70) + `${bsG ? (bsG.weighted >= 0 ? "+" : "") + fmt(bsG.weighted) + ` [${fmt(bsG.low)}, ${fmt(bsG.high)}]` : "–"}`.padEnd(24) + `${Math.round(wall)} (${Math.round(wallRef)})`.padEnd(16) + `${calls.toFixed(1)} (${callsRef.toFixed(1)})`)
for (const r of rows) line(r.set, r.n, r.w, r.bs, r.bsG, r.wall, r.calls, r.wallRef, r.callsRef)
if (rows.length > 1) {
    const w = weighted(pooled.pairs.map((p) => ({ stratum: p.stratum, v: p.a })), missShare, (i) => i.v)
    line("pooled", pooled.pairs.length, w, pairedBootstrap(pooled.pairs, missShare), pooled.pairsG.length ? pairedBootstrap(pooled.pairsG, missShare) : null, mean(pooled.wall), mean(pooled.calls), mean(pooled.wallRef), mean(pooled.callsRef))
}
console.log(`\nflips vs ${ref} by path (n, +, −, identical answer text)`)
for (const [k, f] of Object.entries(pooled.flips).sort()) console.log(`  ${k.padEnd(48)} n=${String(f.n).padStart(4)}  +${f.plus} −${f.minus}  same text ${f.sameText}`)
process.exit(0)
