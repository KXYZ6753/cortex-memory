// Worker l: verifier accuracy on the pair types a deployable selector faces (from l-v1 logs):
// x1's answer vs one alternative of a given source, both scored on the same question.
// Reports, per score key: decisive pairs (one right, one wrong), share where the right one
// scores higher, and the fixes/breaks of "switch from x1 when alt - x1 > margin".
//   node benchmarks/premise2/explore2/tools/l-pairs.js <variant@version> <sets>
import { loadCandidates, norm } from "./l-lib.js"
const [vv, setArg] = process.argv.slice(2)
const sets = setArg.split(",")
const { env, Q } = await loadCandidates(sets)
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const lex = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? ws.filter((w) => es.has(w)).length / ws.length : 0
}
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : "explore")
const ALTS = { "x1.commit": ["x1.commit"], "single (oracles/j)": ["oracles", "j1.single", "j2.single"], "cad (u-ocad5)": ["u-ocad5"], "labels (c-*)": ["c-xT", "c-fin1"], "g5": ["g5"], "gates": ["gates"] }
const T = {}
for (const q of Q.values()) {
    const a = q.by[vv]
    if (!a || a.skipped || !a.verify) continue
    const x1 = q.by["x1@1+cold"]
    const x1t = norm(x1.answer)
    const find = (t) => [...q.cands.values()].find((x) => x.text.slice(0, 300) === t)
    const cs = a.verify.map((c) => { const full = find(c.text); return { ...c, text: full?.text ?? c.text, correct: full?.correct ?? null } })
    const xc = cs.find((c) => c.text === x1t)
    if (!xc) continue
    const yesGold = a.yesPath === q.record.path
    const yesEmail = a.yesPath ? env.emails.emailOf(a.yesPath) : ""
    const lexOf = (c) => lex(q.record.question, c.text, yesEmail)
    for (const [alt, srcs] of Object.entries(ALTS)) {
        const c = cs.find((c) => c !== xc && c.sources.some((s) => srcs.includes(s)))
        if (!c || c.correct === null || xc.correct === null || c.correct === xc.correct) continue
        const group = `${route(x1.step)}/${q.record.stratum}${q.record.stratum === "hit" ? (yesGold ? " yes=gold" : " yes!=gold") : ""}`
        for (const k of ["Y-after", "G-after", "O-after", "lexY"]) {
            const sx = k === "lexY" ? lexOf(xc) : xc[k]?.s, sa = k === "lexY" ? lexOf(c) : c[k]?.s
            if (sx == null || sa == null) continue
            const key = `${alt}|${group}|${k}`
            T[key] ??= { n: 0, right: 0, sw: {} }
            T[key].n++
            if ((sa > sx) === (c.correct === 1)) T[key].right += 1
            for (const m of k === "lexY" ? [0, 0.1, 0.2] : [0, 1, 2, 3]) {
                T[key].sw[m] ??= [0, 0]
                if (sa - sx > m) { if (c.correct === 1) T[key].sw[m][0]++; else T[key].sw[m][1]++ }
            }
        }
    }
}
let last = ""
for (const key of Object.keys(T).sort()) {
    const [alt, group, k] = key.split("|")
    if (`${alt}|${group}` !== last) { console.log(`${alt} — ${group}`); last = `${alt}|${group}` }
    const t = T[key]
    console.log(`   ${k.padEnd(8)} decisive ${String(t.n).padStart(3)}  right-higher ${(100 * t.right / t.n).toFixed(0)}%  switch fix/break by margin ${Object.entries(t.sw).map(([m, [f, b]]) => `${m}: +${f}/-${b}`).join("  ")}`)
}
