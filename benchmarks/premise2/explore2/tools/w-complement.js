// Offline (no GPU): complementarity of stored variants on a set. Oracle-of-variants
// upper bound vs a reference (gates), pairwise "ref wrong, other right" counts, and
// what simple selection rules over stored answers would achieve. Pool records only.
// node benchmarks/premise2/explore2/tools/w-complement.js FULL-0 gates
process.loadEnvFile(".env")
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"

const dataDir = ".data/premise2"
const [setName = "FULL-0", ref = "gates", only = ""] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const missShare = pool.manifest.strata.missShare
const keys = new Set(set.questionKeys)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const table = new Map() // variant -> Map(questionKey -> {correct, abstain, answer})
for (const answer of latestAnswers(dataDir)) {
    if (answer.set !== setName || answer.alias !== "small" || !keys.has(answer.questionKey)) continue
    const record = pool.byKey.get(answer.questionKey)
    const pre = preGrade(answer)
    let correct = null
    if (pre) correct = 0
    else { const v = verdicts.get(answerVerdictKey(answer, record, judge)); if (v) correct = v.verdict === "CORRECT" ? 1 : 0 }
    if (correct === null) continue
    if (!table.has(answer.variant)) table.set(answer.variant, new Map())
    table.get(answer.variant).set(answer.questionKey, { correct, abstain: isAbstain(answer.answer), answer: answer.answer, a: answer })
}
const W = (items) => {
    const m = items.filter((i) => i.stratum === "miss"), h = items.filter((i) => i.stratum === "hit")
    const mean = (l) => l.reduce((s, i) => s + i.v, 0) / l.length
    return { w: missShare * mean(m) + (1 - missShare) * mean(h), miss: mean(m), hit: mean(h) }
}
const f = (x) => (x * 100).toFixed(1)
const refMap = table.get(ref)
const qs = [...refMap.keys()]
console.log(`set ${setName}, ref ${ref}, n=${qs.length}`)
const variants = [...table.keys()].filter((v) => v !== ref && !["oracle", "oracles", "pbrep"].includes(v) && (!only || only.split(",").includes(v)))
const rows = []
for (const v of variants) {
    const m = table.get(v)
    const common = qs.filter((q) => m.has(q))
    if (common.length < qs.length * 0.9) continue
    const items = common.map((q) => ({ stratum: pool.byKey.get(q).stratum, r: refMap.get(q).correct, o: m.get(q).correct }))
    const refW = W(items.map((i) => ({ ...i, v: i.r }))), oW = W(items.map((i) => ({ ...i, v: i.o })))
    const union = W(items.map((i) => ({ ...i, v: Math.max(i.r, i.o) })))
    const gain = items.filter((i) => !i.r && i.o)
    rows.push({ v, n: common.length, ref: f(refW.w), own: f(oW.w), union: f(union.w), dUnion: f(union.w - refW.w), refWrongOtherRight: `${gain.filter((i) => i.stratum === "miss").length}m/${gain.filter((i) => i.stratum === "hit").length}h`, otherWrongRefRight: items.filter((i) => i.r && !i.o).length })
}
rows.sort((a, b) => b.dUnion - a.dUnion)
console.table(rows)
// Oracle of all non-diagnostic variants.
const all = qs.map((q) => ({ stratum: pool.byKey.get(q).stratum, v: Math.max(refMap.get(q).correct, ...variants.map((v) => table.get(v)?.get(q)?.correct ?? 0)) }))
const best = W(all)
console.log(`oracle-of-all-variants: ${f(best.w)} (miss ${f(best.miss)}, hit ${f(best.hit)}) vs ${ref} ${f(W(qs.map((q) => ({ stratum: pool.byKey.get(q).stratum, v: refMap.get(q).correct }))).w)}`)
// Ref wrong but oracles (gold-only) right: reading-recoverable
const or = table.get("oracles")
if (or) {
    const it = qs.filter((q) => or.has(q)).map((q) => ({ stratum: pool.byKey.get(q).stratum, r: refMap.get(q).correct, o: or.get(q).correct, ab: or.get(q).abstain }))
    console.log(`ref wrong & oracles right: ${it.filter((i) => !i.r && i.o).length}; ref right & oracles wrong: ${it.filter((i) => i.r && !i.o).length}; oracles abstain: ${it.filter((i) => i.ab).length}`)
}
// Ref abstentions
console.log(`ref abstains: ${qs.filter((q) => refMap.get(q).abstain).length}, ref wrong non-abstain: ${qs.filter((q) => !refMap.get(q).correct && !refMap.get(q).abstain).length}, ref wrong total ${qs.filter((q) => !refMap.get(q).correct).length}`)
console.log("variants on set:", [...table.entries()].map(([v, m]) => `${v}:${m.size}`).join(" "))
