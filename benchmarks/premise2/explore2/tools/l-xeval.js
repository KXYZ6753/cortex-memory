// Worker l: evaluate a deployable l-xs* run. (1) The variant's own answers vs stored x1
// and gates (paired stratified bootstrap), flips by path, wall ms, calls. (2) Selection
// rules replayed exactly on the run's logged candidates (texts graded by l-grade.js),
// relative to the run's own x1 answer: margins, candidate pools, lexical grounding.
//   node benchmarks/premise2/explore2/tools/l-xeval.js <variant@version> <sets> [x1@ver] [gates@ver]
import { loadCandidates, norm, bootstrapPairs, fmtCi } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"
import { HEDGE } from "../variants/n-conf.js"

const [vv, setArg, x1v = "x1@1+cold", gv = "gates@1+cold"] = process.argv.slice(2)
const sets = setArg.split(",")
const { env, Q, verdictOf } = await loadCandidates(sets)
const ms = env.missShare
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : s === "found" ? "found" : "explore-other")
const rows = []
for (const q of Q.values()) {
    const a = q.by[vv]
    if (!a) continue
    const c = (t, st = "ok") => verdictOf(q.record, t ?? "", st)
    const own = c(a.answer, a.status)
    rows.push({ q, a, own, x1s: q.by[x1v] ? c(q.by[x1v].answer, q.by[x1v].status) : null, gs: q.by[gv] ? c(q.by[gv].answer, q.by[gv].status) : null })
}
const ok = rows.filter((r) => r.own !== null)
console.log(`${vv} on ${sets.join(",")}: ${rows.length} answers, ${ok.length} graded`)
const W = (xs, f) => { const m = xs.filter((r) => r.q.record.stratum === "miss"), h = xs.filter((r) => r.q.record.stratum === "hit"); const mean = (l) => l.reduce((s, r) => s + f(r), 0) / l.length; return { w: 100 * (ms * mean(m) + (1 - ms) * mean(h)), m: 100 * mean(m), h: 100 * mean(h) } }
const own = W(ok, (r) => r.own)
console.log(`  weighted ${own.w.toFixed(1)} (miss ${own.m.toFixed(1)} / hit ${own.h.toFixed(1)}); wall ${Math.round(ok.reduce((s, r) => s + r.a.wallMs, 0) / ok.length)} ms, calls ${(ok.reduce((s, r) => s + r.a.calls, 0) / ok.length).toFixed(2)}`)
for (const [name, key] of [["x1 (stored)", "x1s"], ["gates (stored)", "gs"]]) {
    const xs = ok.filter((r) => r[key] !== null)
    if (!xs.length) continue
    const ci = bootstrapPairs(xs.map((r) => ({ stratum: r.q.record.stratum, d: r.own - r[key] })), ms)
    const ref = W(xs, (r) => r[key])
    const flips = {}
    for (const r of xs) {
        const d = r.own - r[key]
        if (!d) continue
        const p = `${r.q.record.stratum}:${route(r.a.x1Step ?? r.a.step)}${r.a.x1Step ? `>${r.a.l?.kept}` : ""}`
        flips[p] ??= [0, 0]; flips[p][d > 0 ? 0 : 1]++
    }
    console.log(`  vs ${name} ${ref.w.toFixed(1)} (${ref.m.toFixed(1)} / ${ref.h.toFixed(1)}): Δ ${fmtCi(ci)}  flips ${Object.entries(flips).sort().map(([k, [f, b]]) => `${k} +${f}/-${b}`).join(", ")}`)
}
// replay of selection rules on the run's own candidates, relative to the run's own x1 answer
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const usable = (c) => (c.status === "ok" || c.status === "output_limit") && c.text && !isAbstain(c.text) && !HEDGE.test(c.text)
const RULES = []
for (const pool of [["commit"], ["single"], ["labels"], ["commit", "single"], ["commit", "labels"], ["single", "labels"], ["commit", "single", "labels"]])
    for (const m of [0, 0.5, 1, 1.5, 2, 3]) RULES.push({ name: `verify ${pool.join("+")} m${m}`, pool, m, key: "s" })
for (const pool of [["commit", "single"], ["commit", "single", "labels"]]) for (const m of [0, 0.1, 0.2]) RULES.push({ name: `lexical ${pool.join("+")} m${m}`, pool, m, key: "lex" })
for (const pool of [["single"], ["labels"]]) RULES.push({ name: `always ${pool[0]} (if usable)`, pool, always: true })
const out = []
for (const rule of RULES) {
    const pairs = [], flips = {}
    let missing = 0
    for (const r of ok) {
        const L = r.a.l
        let d = 0
        if (L?.scores?.length) {
            const x1text = norm(r.a.x1Answer ?? r.a.answer)
            const x1c = verdictOf(r.q.record, x1text, "ok")
            const def = L.scores.find((s) => s.srcs.includes("x1"))
            let best = null
            for (const c of L.cands) {
                const t = norm(c.text)
                if (c.src === "x1" || !rule.pool.includes(c.src) || !usable(c) || t === x1text) continue
                const s = L.scores.find((x) => x.srcs.includes(c.src))
                if (!s) continue
                if (rule.always) { best = { t, s }; break }
                const v = s[rule.key], v0 = def?.[rule.key]
                if (v == null || v0 == null) continue
                if (v - v0 > rule.m && (!best || v > best.s[rule.key])) best = { t, s }
            }
            if (best) {
                const bc = verdictOf(r.q.record, best.t, "ok")
                if (bc === null || x1c === null) missing++
                else d = bc - x1c
            }
            if (d) { const k = `${r.q.record.stratum}:${route(r.a.x1Step ?? r.a.step)}`; flips[k] ??= [0, 0]; flips[k][d > 0 ? 0 : 1]++ }
        }
        pairs.push({ stratum: r.q.record.stratum, d })
    }
    out.push(`  ${rule.name.padEnd(36)} ${fmtCi(bootstrapPairs(pairs, ms))}${missing ? ` (${missing} ungraded)` : ""}  ${Object.entries(flips).sort().map(([k, [f, b]]) => `${k} +${f}/-${b}`).join(", ")}`)
}
console.log("rules replayed on the run's candidates, Δ vs the run's own x1 answer:")
console.log(out.join("\n"))
