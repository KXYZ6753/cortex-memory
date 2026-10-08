// Worker a6: answer-shape patterns with a mechanical cause, counted on stored graded hit
// answers of det gates / x1 / q1 / lite (+ stored gates / oracles where present), dev sets.
// For each pattern: answers matching, accuracy, and how often the same question is right
// under the gold-only oracle. No GPU.
//   node benchmarks/premise2/explore2/tools/a6-patterns.js [sets] [show-pattern]
import { loadRuns, setKeys, pool } from "./a6-lib.js"
import { questionType } from "../../text.js"

const sets = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3").split(",")
const show = process.argv[3] ?? null
const SYS = { gates: "i-det-gates@2+cold", sgates: "gates@1+cold", x1: "i-det-x1@2+cold", q1: "q-det-q1@1+cold", lite: "lite-det-ub@1+cold", oracle: "a6-det-oracle@1+cold", oracles: "oracles@1+cold" }
const runs = loadRuns(sets, Object.values(SYS))
const unquote = (t) => t.replace(/"[^"]*"/g, " ").replace(/“[^”]*”/g, " ")
export const PAT = {
    you: (t) => /\b(you|your|yours|yourself)\b/i.test(unquote(t)),
    firstPerson: (t) => /\b(I|me|my|mine|myself)\b/.test(unquote(t)),
    weOur: (t) => /\b(we|our|us)\b/i.test(unquote(t)),
    addrInWho: (t, q) => questionType(q) === "who" && /\b[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(t),
    lotus: (t) => /\/[A-Z]{2,4}\/[A-Z]{2,5}(@[A-Z]+)?\b/.test(t),
    trunc: (t, q, a) => a.status === "output_limit",
    hedge: (t) => /\b(do(es)?n['’]?t|do(es)? not|is not|are not|isn['’]t|aren['’]t|was not|were not)\s+(specif|mention|provide|state|say|include|give|indicate|explicitly|contain|identify|detail)|\bnot (specified|mentioned|stated|provided)\b|\bno (specific|explicit) /i.test(t),
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) : "–")
for (const [name, vAt] of Object.entries(SYS)) {
    const m = runs.get(vAt)
    const hits = [...m].filter(([k, x]) => pool.byKey.get(k).stratum === "hit" && x.correct != null)
    if (!hits.length) continue
    const line = [`${name.padEnd(7)} hits ${hits.length} acc ${pct(hits.filter(([, x]) => x.correct).length, hits.length)}`]
    for (const [p, f] of Object.entries(PAT)) {
        const l = hits.filter(([k, x]) => f(x.a.answer, pool.byKey.get(k).question, x.a))
        const orc = l.map(([k]) => runs.get(SYS.oracle).get(k) ?? runs.get(SYS.oracles).get(k)).filter((o) => o?.correct != null)
        line.push(`${p} ${l.length} @${pct(l.filter(([, x]) => x.correct).length, l.length)}% (or ${orc.filter((o) => o.correct).length}/${orc.length})`)
        if (show === p && (name === "gates" || name === "oracles")) for (const [k, x] of l) console.log(`  [${name} ${x.correct}] Q: ${pool.byKey.get(k).question}\n     G: ${pool.byKey.get(k).gold}\n     A: ${x.a.answer.slice(0, 260)}`)
    }
    console.log(line.join(" | "))
}
