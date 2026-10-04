// Offline (no GPU): self-consistency across stored variants. For each question, pick
// one answer among a pool of variants' answers by agreement (token-F1 medoid), with
// the reference variant winning ties / no-agreement. Pool records only.
// node benchmarks/premise2/explore2/tools/w-vote.js FULL-0 gates pbs,hdru,gatea
process.loadEnvFile(".env")
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"

const dataDir = ".data/premise2"
const [setName = "FULL-0", ref = "gates", others = "pbs,hdru,gatea"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const missShare = pool.manifest.strata.missShare
const keys = new Set(set.questionKeys)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const table = new Map()
for (const answer of latestAnswers(dataDir)) {
    if (answer.set !== setName || answer.alias !== "small" || !keys.has(answer.questionKey)) continue
    const record = pool.byKey.get(answer.questionKey)
    const pre = preGrade(answer)
    let correct = null
    if (pre) correct = 0
    else { const v = verdicts.get(answerVerdictKey(answer, record, judge)); if (v) correct = v.verdict === "CORRECT" ? 1 : 0 }
    if (correct === null) continue
    if (!table.has(answer.variant)) table.set(answer.variant, new Map())
    table.get(answer.variant).set(answer.questionKey, { correct, abstain: isAbstain(answer.answer), answer: answer.answer })
}
export const toks = (s) => (String(s).toLowerCase().match(/[a-z0-9$.%/-]+/g) ?? []).map((t) => t.replace(/[.]+$/, "")).filter((t) => t && !STOP.has(t))
const STOP = new Set("the a an of to and in on for is was were be by with as at that this it from or are has have had".split(" "))
export function f1(a, b) {
    const A = toks(a), B = toks(b)
    if (!A.length || !B.length) return 0
    const count = new Map(); for (const t of B) count.set(t, (count.get(t) ?? 0) + 1)
    let same = 0; for (const t of A) if (count.get(t) > 0) { same++; count.set(t, count.get(t) - 1) }
    if (!same) return 0
    const p = same / A.length, r = same / B.length
    return (2 * p * r) / (p + r)
}
const pool2 = [ref, ...others.split(",")]
const W = (items) => {
    const m = items.filter((i) => i.stratum === "miss"), h = items.filter((i) => i.stratum === "hit")
    const mean = (l) => l.reduce((s, i) => s + i.v, 0) / l.length
    return `${(100 * (missShare * mean(m) + (1 - missShare) * mean(h))).toFixed(1)} (miss ${(100 * mean(m)).toFixed(1)}, hit ${(100 * mean(h)).toFixed(1)})`
}
const qs = [...table.get(ref).keys()].filter((q) => pool2.every((v) => table.get(v)?.has(q)))
const res = { ref: [], medoid: [], union: [] }
let changed = 0, changedGood = 0, changedBad = 0
for (const q of qs) {
    const stratum = pool.byKey.get(q).stratum
    const cands = pool2.map((v) => ({ v, ...table.get(v).get(q) })).filter((c) => !c.abstain)
    const r = table.get(ref).get(q)
    let pick = r
    if (cands.length) {
        const score = cands.map((c, i) => cands.reduce((s, d, j) => s + (i === j ? 0 : f1(c.answer, d.answer)), 0))
        // ref keeps it unless another candidate has strictly higher agreement by a margin
        const refIdx = cands.findIndex((c) => c.v === ref)
        let best = refIdx >= 0 ? refIdx : 0
        score.forEach((s, i) => { if (s > score[best] + 0.25) best = i })
        pick = cands[best]
    }
    if (pick !== r && pick.answer !== r.answer) { changed++; if (pick.correct > r.correct) changedGood++; if (pick.correct < r.correct) changedBad++ }
    res.ref.push({ stratum, v: r.correct }); res.medoid.push({ stratum, v: pick.correct })
    res.union.push({ stratum, v: Math.max(...pool2.map((v) => table.get(v).get(q).correct)) })
}
console.log(`pool ${pool2.join(",")} n=${qs.length}`)
console.log(`ref ${W(res.ref)}\nmedoid ${W(res.medoid)}\nunion ${W(res.union)}\nchanged ${changed} (+${changedGood} / -${changedBad})`)
