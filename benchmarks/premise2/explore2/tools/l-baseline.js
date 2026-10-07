// Worker l: trivial selectors on the same candidate pools (l-cands.json, mixed questions):
// pairwise accuracy of answer length and of lexical grounding (share of the answer's novel
// words found in the gold / YES email). The verifier has to beat these.
//   node benchmarks/premise2/explore2/tools/l-baseline.js [sets]
import { readFileSync } from "node:fs"
import { loadCandidates, DEV, norm } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"
const sets = process.argv[2] ? process.argv[2].split(",") : DEV
const file = JSON.parse(readFileSync(".data/premise2/explore/l-cands.json", "utf8"))
const { env, Q } = await loadCandidates(sets)
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const lex = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? ws.filter((w) => es.has(w)).length / ws.length : 0
}
for (const noAbs of [false, true]) {
    const acc = {}
    for (const [key, f] of Object.entries(file)) {
        if (!sets.includes(f.set) || !f.mixed) continue
        const q = Q.get(key)
        const yes = f.x1.yesPath ?? f.x1.W0?.[0]
        const cs = f.cands.map((c) => ({ ...c, correct: q.cands.get(norm(c.text))?.correct })).filter((c) => c.correct !== undefined && (!noAbs || !isAbstain(c.text)))
        const feats = {
            len: (c) => c.text.length,
            lexGold: (c) => lex(q.record.question, c.text, env.emails.emailOf(q.record.path)),
            lexYes: (c) => lex(q.record.question, c.text, env.emails.emailOf(yes)),
            support: (c) => c.sources.length,
        }
        for (const [name, fn] of Object.entries(feats)) {
            for (const st of ["all", q.record.stratum]) {
                const k = `${name}|${st}`
                acc[k] ??= { pairs: 0, wins: 0 }
                const R = cs.filter((c) => c.correct === 1), W = cs.filter((c) => c.correct === 0)
                for (const x of R) for (const y of W) { acc[k].pairs++; acc[k].wins += fn(x) > fn(y) ? 1 : fn(x) === fn(y) ? 0.5 : 0 }
            }
        }
    }
    console.log(noAbs ? "abstentions removed:" : "all candidates:")
    for (const [k, v] of Object.entries(acc)) console.log(`  ${k.padEnd(14)} pairwise ${(100 * v.wins / v.pairs).toFixed(1)}% of ${v.pairs}`)
}
