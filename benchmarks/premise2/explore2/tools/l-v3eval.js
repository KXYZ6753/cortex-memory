// Worker l: replay selection rules on l-xs1's own candidates with the scores of another
// verification form (l-v3 = "before"), next to the run's own "after" scores. Δ relative to
// the l-xs1 run's own x1 answer (exact: candidate texts graded by l-grade.js).
//   node benchmarks/premise2/explore2/tools/l-v3eval.js <sets> [rescore variant@version]
import { loadCandidates, norm, bootstrapPairs, fmtCi } from "./l-lib.js"
const [setArg, rv = "l-v3@1+cold"] = process.argv.slice(2)
const { env, Q, verdictOf } = await loadCandidates(setArg.split(","))
const rows = []
for (const q of Q.values()) {
    const a = q.by["l-xs1@1+cold"], r = q.by[rv]
    if (!a) continue
    rows.push({ q, a, r })
}
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : s === "found" ? "found" : "other")
for (const [name, scoresOf] of [["after (l-xs1's own)", (row) => row.a.l?.scores], ["before (l-v3)", (row) => row.r?.rescored]]) {
    for (const pool of [["single"], ["commit", "labels"], ["commit", "single", "labels"]]) {
        const line = []
        for (const m of [0, 1, 2, 3]) {
            const pairs = [], flips = {}
            for (const row of rows) {
                let d = 0
                const S = scoresOf(row)
                if (S?.length) {
                    const def = S.find((s) => s.srcs.includes("x1"))
                    const x1text = norm(row.a.x1Answer ?? row.a.answer)
                    let best = null
                    for (const s of S) {
                        if (s === def || !s.srcs.some((x) => pool.includes(x)) || s.s == null || def?.s == null) continue
                        if (s.s - def.s > m && (!best || s.s > best.s)) best = s
                    }
                    if (best) {
                        const text = norm(row.a.l.cands.find((c) => best.srcs.includes(c.src))?.text)
                        d = (verdictOf(row.q.record, text, "ok") ?? 0) - (verdictOf(row.q.record, x1text, "ok") ?? 0)
                        if (d) { const k = `${row.q.record.stratum}:${route(row.a.x1Step ?? row.a.step)}`; flips[k] ??= [0, 0]; flips[k][d > 0 ? 0 : 1]++ }
                    }
                }
                pairs.push({ stratum: row.q.record.stratum, d })
            }
            line.push(`m${m} ${fmtCi(bootstrapPairs(pairs, env.missShare))} ${Object.entries(flips).sort().map(([k, [f, b]]) => `${k} +${f}/-${b}`).join(", ")}`)
        }
        console.log(`${name} pool ${pool.join("+")}\n   ${line.join("\n   ")}`)
    }
}
