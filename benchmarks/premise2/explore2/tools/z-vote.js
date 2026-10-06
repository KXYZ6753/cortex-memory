// z: three readings of the same final context (x1, thinking, extraction) on x1's unsure half:
// correctness patterns, union ceiling, and a token-F1 majority (medoid) selector.
import { loadTable, pool, missShare } from "./n-lib.js"
const set = process.argv[2] ?? "S300-2"
const { table, keys } = loadTable(set, ["x1", "z-think1", "z-ext1"])
const toks = (s) => (String(s).toLowerCase().match(/[a-z0-9$.%/-]+/g) ?? [])
const f1 = (a, b) => { const A = toks(a), B = toks(b); if (!A.length || !B.length) return 0; const m = new Map(); for (const t of B) m.set(t, (m.get(t) ?? 0) + 1); let c = 0; for (const t of A) if (m.get(t) > 0) { c++; m.set(t, m.get(t) - 1) } return c ? 2 * c / (A.length + B.length) : 0 }
const pat = {}, sel = { x1: [0, 0], medoid: [0, 0], union: [0, 0], agreeX1think: [0, 0], disagree: [0, 0] }
let n = { hit: 0, miss: 0 }, acc = { hit: { x1: 0, med: 0, uni: 0 }, miss: { x1: 0, med: 0, uni: 0 } }
for (const k of keys) {
    const x = table.get("x1").get(k), t = table.get("z-think1").get(k), e = table.get("z-ext1").get(k)
    if (!x || x.a.step === "commit" || x.correct == null || t?.correct == null || e?.correct == null) continue
    const s = pool.byKey.get(k).stratum
    pat[`${s} ${x.correct}${t.correct}${e.correct}`] = (pat[`${s} ${x.correct}${t.correct}${e.correct}`] ?? 0) + 1
    const c = [x, t, e]
    const score = c.map((a, i) => c.reduce((sum, b, j) => sum + (i === j ? 0 : f1(a.answer, b.answer)), 0))
    const best = score.indexOf(Math.max(...score))
    n[s]++; acc[s].x1 += x.correct; acc[s].med += c[best].correct; acc[s].uni += Math.max(x.correct, t.correct, e.correct)
    const agree = f1(x.answer, t.answer) >= 0.6 && f1(x.answer, e.answer) >= 0.6
    const key = agree ? "agree" : "disagree"; sel[key] ??= [0, 0]; sel[key][0] += x.correct; sel[key][1]++
}
console.log(set, Object.entries(pat).sort())
for (const s of ["hit", "miss"]) console.log(s, n[s], "x1", acc[s].x1, "medoid", acc[s].med, "union", acc[s].uni)
console.log("x1 correct when all three agree (F1>=.6) vs not:", sel.agree, sel.disagree)
