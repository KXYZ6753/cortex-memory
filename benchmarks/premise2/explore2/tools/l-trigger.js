// Worker l: is the verifier score of x1's own answer (against its YES email) a better
// between-question confidence signal than x1's commit-answer mean token logprob? AUC for
// "x1's answer is right", on questions an l-xs* run verified (>= 2 distinct candidates).
//   node benchmarks/premise2/explore2/tools/l-trigger.js <variant@version> <sets>
import { loadCandidates, norm, auc } from "./l-lib.js"
const [vv, setArg] = process.argv.slice(2)
const { Q, verdictOf } = await loadCandidates(setArg.split(","))
const items = { verifier: [], logprob: [], lex: [], yesLp: [] }
const by = {}
for (const q of Q.values()) {
    const a = q.by[vv]
    const L = a?.l
    if (!L?.scores?.length) continue
    const def = L.scores.find((s) => s.srcs.includes("x1"))
    if (def?.s == null) continue
    const y = verdictOf(q.record, norm(a.x1Answer ?? a.answer), "ok")
    if (y === null) continue
    const step = a.x1Step ?? a.step
    const k = `${q.record.stratum}/${step}`
    by[k] ??= { verifier: [], logprob: [] }
    items.verifier.push({ y, s: def.s }); by[k].verifier.push({ y, s: def.s })
    items.lex.push({ y, s: def.lex })
    const yl = (a.log ?? []).find((l) => l.act === "check" && l.yes)?.yesLp
    if (yl != null) items.yesLp.push({ y, s: yl })
    if (a.firstMean != null) { items.logprob.push({ y, s: a.firstMean }); by[k].logprob.push({ y, s: a.firstMean }) }
}
for (const [k, xs] of Object.entries(items)) console.log(`${k.padEnd(9)} n ${xs.length}  right ${xs.filter((x) => x.y).length}  AUC ${auc(xs).toFixed(3)}`)
for (const [k, v] of Object.entries(by).sort()) console.log(`  ${k.padEnd(18)} n ${v.verifier.length} AUC verifier ${auc(v.verifier).toFixed(3)}  logprob ${auc(v.logprob).toFixed(3)}`)
