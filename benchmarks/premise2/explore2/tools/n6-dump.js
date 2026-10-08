// Worker n6: print the verdict flips of one logged configuration (or a single-config variant)
// against the greedy answer of the same run, with the question, the references and E1 = gold?
// Offline, no GPU.
//   node benchmarks/premise2/explore2/tools/n6-dump.js <variant@ver> <set,set> <config|-> [tau]
// config "-" = the variant's own answer vs its logged greedy text (single-config variants).
import { openN6 } from "./n6-lib.js"
const [v, setsArg, cfgName, tauArg] = process.argv.slice(2)
const tau = tauArg ? Number(tauArg) : null
const { graded, verdictOf } = await openN6()
let plus = 0, minus = 0
for (const s of setsArg.split(",")) {
    for (const i of graded(v, s)) {
        if (i.record.stratum !== "hit" || !i.answer.n6 || i.correct == null) continue
        let greedyText, greedyOk, text, ok, mean, e1
        if (cfgName === "-") {
            const inf = i.answer.n6.info.at(-1)
            greedyText = inf.greedy; greedyOk = verdictOf(greedyText, i.record); text = i.answer.answer; ok = i.correct; mean = inf.mean; e1 = inf.e1
        } else {
            const c = i.answer.n6.cfg[cfgName]
            mean = i.answer.n6.greedy.mean; e1 = i.answer.n6.e1
            greedyText = i.answer.answer; greedyOk = i.correct
            const fire = tau === null || mean < tau
            text = fire ? c.answer : greedyText; ok = fire ? verdictOf(c.answer, i.record, c.status) : greedyOk
        }
        if (ok == null || greedyOk == null || ok === greedyOk) continue
        ok > greedyOk ? plus++ : minus++
        const gold = e1 === i.record.path || (i.record.twins ?? []).includes(e1)
        console.log(`${ok > greedyOk ? "+FIXED" : "-BROKE"} ${s} ${i.record.questionKey} mean ${mean} E1=${gold ? "gold" : "other"}\n  Q: ${i.record.question}\n  REF: ${i.record.gold}\n  greedy: ${greedyText.slice(0, 260)}\n  dcd:    ${text.slice(0, 260)}`)
    }
}
console.log(`\n+${plus} / -${minus}`)
process.exit(0)
