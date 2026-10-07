// Worker l: verifier pairwise accuracy on "hard" pairs, where both candidates are lexically
// grounded in the evidence email (share of novel answer words found there >= thr), i.e.
// where word overlap cannot separate them. From l-v1 logs.
//   node benchmarks/premise2/explore2/tools/l-hard.js <variant@version> <sets> [thr] [form]
import { loadCandidates } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"
const [vv, setArg, thrArg, form = "after"] = process.argv.slice(2)
const thr = Number(thrArg ?? 0.8)
const { env, Q } = await loadCandidates(setArg.split(","))
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const lex = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? ws.filter((w) => es.has(w)).length / ws.length : 0
}
const T = {}
for (const q of Q.values()) {
    const a = q.by[vv]
    if (!a || a.skipped || !a.verify) continue
    const find = (t) => [...q.cands.values()].find((x) => x.text.slice(0, 300) === t)
    const cs = a.verify.map((c) => { const f = find(c.text); return { ...c, text: f?.text ?? c.text, correct: f?.correct ?? null } }).filter((c) => c.correct !== null && !isAbstain(c.text))
    for (const [ev, path] of [["G", q.record.path], ["Y", a.yesPath]]) {
        if (!path) continue
        const email = env.emails.emailOf(path)
        const R = cs.filter((c) => c.correct === 1), W = cs.filter((c) => c.correct === 0)
        for (const x of R) for (const y of W) {
            const hard = lex(q.record.question, x.text, email) >= thr && lex(q.record.question, y.text, email) >= thr
            const k = `${ev}-${form} ${q.record.stratum} ${hard ? "hard" : "easy"}`
            const sx = x[`${ev}-${form}`]?.s, sy = y[`${ev}-${form}`]?.s
            if (sx == null || sy == null) continue
            T[k] ??= { n: 0, w: 0 }
            T[k].n++; T[k].w += sx > sy ? 1 : sx === sy ? 0.5 : 0
        }
    }
}
for (const k of Object.keys(T).sort()) console.log(k.padEnd(22), `${(100 * T[k].w / T[k].n).toFixed(1)}% of ${T[k].n}`)
