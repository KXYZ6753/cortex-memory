// Offline (p): paired flips of variants vs a reference on one set, split by whether the
// first prompt changed (first context differs) and stratum.
//   node benchmarks/premise2/explore2/tools/p-flips.js <set> <ref> <variant,variant>

import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { loadPool } from "../../explore/pool.js"

process.loadEnvFile(".env")
const [setName, ref, list] = process.argv.slice(2)
const dataDir = ".data/premise2"
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const latest = new Map()
for (const a of latestAnswers(dataDir)) {
    if (a.set !== setName || a.alias !== "small") continue
    const id = a.variant
    const prev = latest.get(`${id}|${a.questionKey}`)
    if (!prev || String(a.version) >= String(prev.version)) latest.set(`${id}|${a.questionKey}`, a)
}
const correct = (a) => {
    if (!a) return null
    const record = pool.byKey.get(a.questionKey)
    if (preGrade(a)) return 0
    const v = verdicts.get(answerVerdictKey(a, record, judge))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}
for (const id of list.split(",")) {
    const t = {}
    for (const [key, a] of latest) {
        if (!key.startsWith(`${id}|`)) continue
        const r = latest.get(`${ref}|${a.questionKey}`)
        const ca = correct(a), cr = correct(r)
        if (ca === null || cr === null) continue
        const changed = (a.contextPaths ?? []).join(",") !== (r.contextPaths ?? []).join(",") ? "changed" : "same"
        const k = `${a.stratum} ${changed}`
        t[k] ??= { n: 0, win: 0, loss: 0, textDiff: 0 }
        t[k].n++
        if (ca > cr) t[k].win++
        if (ca < cr) t[k].loss++
        if (a.answer !== r.answer) t[k].textDiff++
    }
    console.log(`${id} vs ${ref} on ${setName}:`)
    for (const [k, v] of Object.entries(t).sort()) console.log(`  ${k}: n ${v.n}, +${v.win}/-${v.loss}, answer text differs ${v.textDiff}`)
}
