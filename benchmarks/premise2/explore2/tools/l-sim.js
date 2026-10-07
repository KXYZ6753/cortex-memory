// Worker l: offline simulation of deployable verifier selection from l-v1 scores (exact
// for the stored candidates: only mixed questions can change correctness, and l-v1 scored
// every mixed question). Candidates = x1's answer + deployable proxies present among the
// scored candidates: commit (x1's commit answer), single (j1/j2 single read, or oracles'
// gold-only read when x1's YES email is the gold), cad (u-ocad5 when YES = gold), labels
// (c-xT / c-fin1). Switch from x1 to the best alternative when its score exceeds x1's by
// more than the margin. Score keys: Y-after (deployable), lexY (lexical), G-after (oracle).
//   node benchmarks/premise2/explore2/tools/l-sim.js <variant@version> <sets>
import { loadCandidates, norm, bootstrapPairs, fmtCi } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"
const [vv, setArg] = process.argv.slice(2)
const sets = setArg.split(",")
const { env, Q } = await loadCandidates(sets)
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const lex = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? ws.filter((w) => es.has(w)).length / ws.length : 0
}
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : s === "found" ? "found" : "other")
const isAlt = {
    commit: (c, yg) => c.sources.includes("x1.commit"),
    single: (c, yg) => c.sources.some((s) => s === "j1.single" || s === "j2.single") || (yg && c.sources.includes("oracles")),
    cad: (c, yg) => yg && c.sources.includes("u-ocad5"),
    labels: (c, yg) => c.sources.some((s) => s === "c-xT" || s === "c-fin1"),
}
const POOLS = [["commit"], ["single"], ["commit", "single"], ["commit", "single", "cad"], ["commit", "single", "labels"], ["commit", "single", "cad", "labels"]]
const ON = { "unsure only": ["unsure"], "sure+unsure": ["sure", "unsure"], "sure+unsure+found": ["sure", "unsure", "found"] }
const keyName = process.argv[4] ?? "Y-after"
const margins = keyName === "lexY" ? [0, 0.1, 0.2, 0.3] : [0, 0.5, 1, 1.5, 2, 3]
const rows = []
for (const q of Q.values()) {
    const x1 = q.by["x1@1+cold"]
    if (!x1) continue
    const a = q.by[vv]
    const base = { stratum: q.record.stratum, route: route(x1.step) }
    if (!a || a.skipped || !a.verify) { rows.push({ ...base, cands: null }); continue }
    const find = (t) => [...q.cands.values()].find((x) => x.text.slice(0, 300) === t)
    const yg = a.yesPath === q.record.path
    const yesEmail = a.yesPath ? env.emails.emailOf(a.yesPath) : ""
    const cs = a.verify.map((c) => { const full = find(c.text); const text = full?.text ?? c.text; return { ...c, text, correct: full?.correct ?? null, lexY: { s: lex(q.record.question, text, yesEmail) } } })
    const x1c = cs.find((c) => c.text === norm(x1.answer))
    rows.push({ ...base, x1c, cs, yg, hasYes: !!x1.log?.some((l) => l.act === "check" && l.yes) || !!x1.foundPath })
}
console.log(`${vv} ${sets.join(",")} key ${keyName}: ${rows.length} questions, ${rows.filter((r) => r.cs).length} scored`)
for (const [onName, on] of Object.entries(ON)) for (const pool of POOLS) {
    const line = []
    for (const m of margins) {
        const pairs = [], flips = {}
        let avail = 0
        for (const r of rows) {
            let d = 0
            if (r.cs && r.x1c && on.includes(r.route) && r.hasYes) {
                const alts = r.cs.filter((c) => c !== r.x1c && !isAbstain(c.text) && c.correct !== null && pool.some((p) => isAlt[p](c, r.yg)))
                if (alts.length) avail++
                const sx = r.x1c[keyName]?.s ?? -Infinity
                let best = null
                for (const c of alts) { const s = c[keyName]?.s ?? -Infinity; if (s - sx > m && (!best || s > best[keyName].s)) best = c }
                if (best) d = (best.correct ?? 0) - (r.x1c.correct ?? 0)
                if (d) { const k = `${r.route}/${r.stratum}`; flips[k] ??= [0, 0]; flips[k][d > 0 ? 0 : 1] += 1 }
            }
            pairs.push({ stratum: r.stratum, d })
        }
        const ci = bootstrapPairs(pairs, env.missShare)
        line.push(`m${m}: ${fmtCi(ci)} ${Object.entries(flips).map(([k, [f, b]]) => `${k} +${f}/-${b}`).join(", ")}`)
    }
    console.log(`${onName.padEnd(18)} pool ${pool.join("+").padEnd(26)}\n    ${line.join("\n    ")}`)
}
