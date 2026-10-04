// Offline: J1 accuracy by position of the first answer-bearing email in the context
// that produced the final answer, for stored answers of given variants on dev sets.
//   node benchmarks/premise2/explore2/tools/r-position.js gates,pb,pbs FULL-0,S300-1
import { judgeConfig, preGrade } from "../../judge.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { openAll, DATA_DIR, HELD_OUT } from "./r-common.js"

if (process.env.R_NOENV !== "1") try { process.loadEnvFile(".env") } catch {}
const variants = (process.argv[2] ?? "gates").split(",")
const sets = (process.argv[3] ?? "FULL-0").split(",")
for (const s of sets) if (HELD_OUT.has(s) && !process.env.R_ALLOW_HELDOUT) throw new Error(`${s} held out`)
const env = await openAll({ sets })
const judge = judgeConfig("j1")
const verdicts = verdictIndex(DATA_DIR)
const keys = new Set(env.records.map((r) => r.questionKey))
for (const variant of variants) {
    const table = {}
    for (const answer of latestAnswers(DATA_DIR)) {
        if (answer.variant !== variant || !sets.includes(answer.set) || !keys.has(answer.questionKey) || answer.alias !== "small") continue
        const record = env.pool.byKey.get(answer.questionKey)
        let correct
        if (preGrade(answer)) correct = 0
        else {
            const v = verdicts.get(answerVerdictKey(answer, record, judge))
            if (!v) continue
            correct = v.verdict === "CORRECT" ? 1 : 0
        }
        const read = answer.readPaths ?? answer.contextPaths ?? []
        const used = answer.used ?? 1
        const last = read.slice((used - 1) * 5, used * 5)
        const ctxPaths = last.length ? last : answer.contextPaths ?? []
        const pos = ctxPaths.findIndex((p) => env.answerBearing(record, p)) + 1
        const key = `${record.stratum} pos${pos || "-"}`
        table[key] ??= { n: 0, c: 0 }
        table[key].n++
        table[key].c += correct
    }
    console.log(variant)
    for (const [k, v] of Object.entries(table).sort()) console.log(`  ${k}: n=${v.n} acc=${(100 * v.c / v.n).toFixed(1)}`)
}
