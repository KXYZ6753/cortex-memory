// Worker u: x1-style handover threshold sweep from logged commit answers. For variants
// built on x1 (x1, u-xrep, ...), the commit answer over W0 (gatesAnswer, firstMean) is
// computed before the handover decision, so a lower tau (fewer handovers) can be simulated
// exactly: commit-g5 questions with firstMean >= tau' keep gatesAnswer. gatesAnswer of
// handed-over questions is J1-graded directly (verdict cache in scratch, not in verdicts.jsonl).
//   node benchmarks/premise2/explore2/tools/u-tau.js S300-2[+S300-1] x1@1+cold,u-xrep@1+cold <cache.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { judgeConfig, referenceVerdict, preGrade } from "../../judge.js"
import { referencesOf } from "../../explore/grade.js"
import { isAbstain } from "../../prompts.js"
import { HEDGE } from "../variants/n-conf.js"
import { openAll } from "./a-lib.js"
const [sets, list, cacheFile] = process.argv.slice(2)
const { graded, missShare } = await openAll()
const judge = judgeConfig("j1")
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {}
const out = []
for (const v of list.split(",")) {
    const items = sets.split("+").flatMap((s) => graded(v, s))
    const todo = items.filter((i) => i.answer.step?.startsWith("commit-") && i.answer.gatesAnswer != null && cache[`${i.record.questionKey}|${i.answer.gatesAnswer}`] === undefined)
    let k = 0
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (k < todo.length) {
            const i = todo[k++]
            const key = `${i.record.questionKey}|${i.answer.gatesAnswer}`
            if (preGrade({ answer: i.answer.gatesAnswer, status: "ok" })) { cache[key] = 0; continue }
            try { const r = await referenceVerdict(judge, { question: i.record.question, references: referencesOf(i.record), candidate: i.answer.gatesAnswer }); cache[key] = r.verdict === "CORRECT" ? 1 : r.verdict === "INCORRECT" ? 0 : null } catch (e) { console.error(String(e).slice(0, 200)) }
        }
    }))
    writeFileSync(cacheFile, JSON.stringify(cache))
    for (const tau of [-0.1, -0.11, -0.12, -0.13, -0.15, -0.2, -Infinity]) {
        let m = 0, nm = 0, h = 0, nh = 0, handed = 0
        for (const i of items) {
            let c = i.correct
            if (i.answer.step?.startsWith("commit-") && i.answer.gatesAnswer != null) {
                const g = i.answer.gatesAnswer
                const keep = i.answer.firstMean >= tau && !isAbstain(g) && !HEDGE.test(g)
                if (keep) c = cache[`${i.record.questionKey}|${g}`] ?? c
                else handed++
            }
            if (i.record.stratum === "miss") { m += c; nm++ } else { h += c; nh++ }
        }
        out.push(`${v.padEnd(16)} tau ${String(tau).padEnd(9)} W ${(100 * (missShare * m / nm + (1 - missShare) * h / nh)).toFixed(2)}  miss ${(100 * m / nm).toFixed(1)}  hit ${(100 * h / nh).toFixed(1)}  handed ${handed}`)
    }
}
console.log(out.join("\n"))
process.exit(0)
