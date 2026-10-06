// Worker h (round 4): offline simulation on x1's handover path from stored answers
// (h-handover.json): A = gates' unsure answer over W0, S = j1's single read of the YES
// email (with its mean logprob), B = x1's g5 answer, J2 = j2's final answer.
// Policies: j2; j2 + "A and S agree -> S" before g5; etc. Agreement = Jaccard of novel
// content words (not in the question) >= thr.
//   node benchmarks/premise2/explore2/tools/h-agree.js <h-handover.json>
import { readFileSync } from "node:fs"
import { novelAnswerWords } from "../../text.js"
import { VAGUE } from "../variants/h-spec.js"
import { HEDGE } from "../variants/n-conf.js"

const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
const jac = (a, b, q) => {
    const A = new Set(novelAnswerWords([a ?? ""], q)), B = new Set(novelAnswerWords([b ?? ""], q))
    if (!A.size || !B.size) return 0
    let i = 0; for (const w of A) if (B.has(w)) i++
    return i / (A.size + B.size - i)
}
const cover = (rows, f) => {
    const t = {}
    for (const r of rows) {
        const k = `${r.set} ${r.s}`
        t[k] ??= { n: 0, ok: 0, unk: 0, fired: 0 }
        const v = f(r)
        t[k].n++
        if (v.fired) t[k].fired++
        if (v.c == null) t[k].unk++; else t[k].ok += v.c
    }
    return Object.entries(t).sort().map(([k, x]) => `${k}: ${x.ok}/${x.n}${x.unk ? ` (unk ${x.unk})` : ""} fired ${x.fired}`).join(" | ")
}
console.log("x1      ", cover(rows, (r) => ({ c: r.x1 })))
console.log("j2      ", cover(rows, (r) => ({ c: r.j2 })))
for (const thr of [0.3, 0.4, 0.5, 0.6]) {
    console.log(`agree${thr} `, cover(rows, (r) => {
        if (r.j2step === "commit-single") return { c: r.j2 }
        const ok = r.single && !HEDGE.test(r.single) && !HEDGE.test(r.gatesA ?? "") && jac(r.gatesA, r.single, r.q) >= thr
        return ok ? { c: r.singleV, fired: 1 } : { c: r.j2 }
    }))
}
// diagnostics: among j2's g5-fallback questions, agreement vs correctness of S and of g5
const d = {}
for (const r of rows) {
    if (r.j2step !== "commit-g5" || !r.single) continue
    const j = jac(r.gatesA, r.single, r.q)
    const k = `${r.s} jac${j >= 0.5 ? ">=.5" : j >= 0.3 ? ".3-.5" : "<.3"}`
    d[k] ??= { n: 0, S: 0, Sunk: 0, A: 0, Aunk: 0, g5: 0 }
    d[k].n++; if (r.singleV == null) d[k].Sunk++; else d[k].S += r.singleV
    if (r.gatesV == null) d[k].Aunk++; else d[k].A += r.gatesV
    d[k].g5 += r.j2 ?? 0
}
console.log("j2 g5-fallback questions by A~S agreement: n | S right (unk) | A right (unk) | j2(g5) right")
for (const [k, x] of Object.entries(d).sort()) console.log(`  ${k}: ${x.n} | ${x.S} (${x.Sunk}) | ${x.A} (${x.Aunk}) | ${x.g5}`)
// vague detector on the final j2 answer / on S / on A
const v = {}
for (const r of rows) {
    const fin = r.j2step === "commit-single" ? r.single : null
    for (const [name, txt, c] of [["A", r.gatesA, r.gatesV], ["S", r.single, r.singleV], ["x1final", r.g5A, r.x1]]) {
        if (!txt) continue
        const k = `${r.s} ${name} vague=${VAGUE.test(txt) || HEDGE.test(txt) ? 1 : 0}`
        v[k] ??= { n: 0, ok: 0, unk: 0 }
        v[k].n++; if (c == null) v[k].unk++; else v[k].ok += c
    }
}
console.log("vague|hedge detector on handover answers: n ok (unk)")
for (const [k, x] of Object.entries(v).sort()) console.log(`  ${k}: ${x.n} ${x.ok} (${x.unk})`)
