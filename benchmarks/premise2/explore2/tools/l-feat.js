// Worker l: features of the would-be switches in an l-xs* run (best alternative by verifier
// score vs x1's answer): x1's own score, the margin, x1's YES-probe logprob, x1 path, and
// whether the YES email is the gold; outcome = alt correct - x1 correct.
//   node benchmarks/premise2/explore2/tools/l-feat.js <variant@version> <sets> [pool=single,commit,labels]
import { loadCandidates, norm } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"
import { HEDGE } from "../variants/n-conf.js"
const [vv, setArg, poolArg = "single,commit,labels"] = process.argv.slice(2)
const pool = poolArg.split(",")
const { Q, verdictOf } = await loadCandidates(setArg.split(","))
const usable = (c) => (c.status === "ok" || c.status === "output_limit") && c.text && !isAbstain(c.text) && !HEDGE.test(c.text)
const rows = []
for (const q of Q.values()) {
    const a = q.by[vv]
    const L = a?.l
    if (!L?.scores?.length) continue
    const def = L.scores.find((s) => s.srcs.includes("x1"))
    const x1text = norm(a.x1Answer ?? a.answer)
    let best = null
    for (const c of L.cands) {
        if (c.src === "x1" || !pool.includes(c.src) || !usable(c) || norm(c.text) === x1text) continue
        const s = L.scores.find((x) => x.srcs.includes(c.src))
        if (s?.s == null) continue
        if (!best || s.s > best.s.s) best = { c, s }
    }
    if (!best || def?.s == null) continue
    const yesLp = (a.log ?? []).find((l) => l.act === "check" && l.yes)?.yesLp ?? null
    const d = (verdictOf(q.record, best.c.text, "ok") ?? 0) - (verdictOf(q.record, x1text, "ok") ?? 0)
    rows.push({ st: q.record.stratum, step: a.x1Step ?? a.step, yg: L.yesPath === q.record.path, x1s: def.s, alt: best.c.src, as: best.s.s, gap: best.s.s - def.s, yesLp, x1lex: def.lex, altlex: best.s.lex, d })
}
const show = (name, f) => {
    const xs = rows.filter(f)
    const fix = xs.filter((r) => r.d > 0).length, brk = xs.filter((r) => r.d < 0).length
    const hf = xs.filter((r) => r.d > 0 && r.st === "hit").length, hb = xs.filter((r) => r.d < 0 && r.st === "hit").length
    console.log(`${name.padEnd(48)} n ${String(xs.length).padStart(3)}  fix ${fix} break ${brk}  (hits +${hf}/-${hb}, misses +${fix - hf}/-${brk - hb})`)
}
console.log(`${vv} ${setArg}: ${rows.length} questions with an alternative`)
show("gap > 1", (r) => r.gap > 1)
show("gap > 1, yes = gold", (r) => r.gap > 1 && r.yg)
show("gap > 1, yes != gold", (r) => r.gap > 1 && !r.yg)
for (const t of [-6, -4, -2, 0, 2]) show(`gap > 1, x1 score >= ${t}`, (r) => r.gap > 1 && r.x1s >= t)
for (const t of [-6, -4, -2, 0]) show(`gap > 1, x1 score < ${t}`, (r) => r.gap > 1 && r.x1s < t)
for (const t of [-0.01, -0.05, -0.2]) show(`gap > 1, YES-probe lp >= ${t}`, (r) => r.gap > 1 && r.yesLp != null && r.yesLp >= t)
for (const s of ["commit", "commit-g5", "found"]) show(`gap > 1, path ${s}`, (r) => r.gap > 1 && r.step === s)
for (const s of ["single", "commit", "labels"]) show(`gap > 1, alt ${s}`, (r) => r.gap > 1 && r.alt === s)
show("gap > 1, x1 lex >= 0.6", (r) => r.gap > 1 && r.x1lex >= 0.6)
show("gap > 1, x1 lex < 0.6", (r) => r.gap > 1 && r.x1lex < 0.6)
