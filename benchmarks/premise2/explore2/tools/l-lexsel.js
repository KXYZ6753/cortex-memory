// Worker l: offline lexical selection (share of the answer's novel words found in x1's YES
// email) among x1's answer and stored proxies of deployable candidates, by x1 path.
//   node benchmarks/premise2/explore2/tools/l-lexsel.js [sets] [margin]
import { loadCandidates, DEV, yesPathOf, norm, bootstrapPairs, fmtCi } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"
const sets = process.argv[2] ? process.argv[2].split(",") : DEV
const margin = Number(process.argv[3] ?? 0)
const { env, Q } = await loadCandidates(sets)
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const lex = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? ws.filter((w) => es.has(w)).length / ws.length : 0
}
const route = (s) => (s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : s === "found" ? "found" : "other")
for (const pool of [["commit"], ["single"], ["commit", "single"], ["commit", "single", "cad"]]) {
    const pairs = [], flips = {}
    for (const q of Q.values()) {
        const x1 = q.by["x1@1+cold"]
        if (!x1) continue
        const yes = yesPathOf(x1)
        const c = (t) => (t == null ? null : q.cands.get(norm(t))?.correct ?? null)
        const xc = c(x1.answer) ?? 0
        if (!yes) { pairs.push({ stratum: q.record.stratum, d: 0 }); continue }
        const get = (v) => Object.entries(q.by).find(([k]) => k.split("@")[0] === v)?.[1]
        const alts = {
            commit: x1.gatesAnswer,
            single: get("j1")?.j?.singleAnswer ?? get("j2")?.j?.singleAnswer ?? (yes === q.record.path ? get("oracles")?.answer : null),
            cad: yes === q.record.path ? get("u-ocad5")?.answer : null,
        }
        const email = env.emails.emailOf(yes)
        let best = { text: x1.answer, s: lex(q.record.question, x1.answer, email), c: xc }
        for (const k of pool) {
            const t = alts[k]
            if (!t || isAbstain(t) || c(t) === null) continue
            const s = lex(q.record.question, t, email)
            if (s > best.s + margin) best = { text: t, s, c: c(t) }
        }
        const d = best.c - xc
        pairs.push({ stratum: q.record.stratum, d })
        const r = `${route(x1.step)}/${q.record.stratum}`
        flips[r] ??= [0, 0]
        if (d > 0) flips[r][0]++
        if (d < 0) flips[r][1]--
    }
    console.log(`x1 + ${pool.join("+").padEnd(18)} Δ vs x1 ${fmtCi(bootstrapPairs(pairs, env.missShare))}  flips ${JSON.stringify(flips)}`)
}
