// Worker c: paired flips of a variant vs a base (x1 or gates) by path, on one or more
// sets ("S300-1+S300-2"). Path = the base's step (x1: commit / commit-g5 / found /
// nofound / nopick; gates: first context / retried) and the variant's own step; also
// whether the answer text changed and whether the gold email is a chain / the question
// is a who-question.
//   node benchmarks/premise2/explore2/tools/c-flips.js <sets> <variant@ver> <base@ver> [list]
import { openAll } from "./a-lib.js"
import { questionType } from "../../text.js"
import { segmentThread } from "../variants/c-render.js"
import { join } from "node:path"
import { ensureEmailStore } from "../../agent-run.js"

const { graded } = await openAll()
const [setsArg, V, B, list] = process.argv.slice(2)
const emails = await ensureEmailStore(".data/premise2", join(".data/premise2", "agent"), () => {})
const rows = []
for (const s of setsArg.split("+")) {
    const base = new Map(graded(B, s).map((i) => [i.record.questionKey, i]))
    for (const v of graded(V, s)) {
        const b = base.get(v.record.questionKey)
        if (!b || v.correct == null || b.correct == null) continue
        const step = (a) => a.step ?? (a.used > 1 ? "retry" : "first")
        rows.push({
            s, key: v.record.questionKey, stratum: v.record.stratum, bStep: step(b.answer), vStep: step(v.answer),
            d: v.correct - b.correct, same: v.answer.answer === b.answer.answer, who: questionType(v.record.question) === "who",
            chain: segmentThread(emails.emailOf(v.record.path)).blocks.length > 0, v, b,
        })
    }
}
emails.close()
const tally = (label, f) => {
    const by = new Map()
    for (const r of rows) { const k = f(r); if (k == null) continue; if (!by.has(k)) by.set(k, { n: 0, plus: 0, minus: 0, same: 0 }); const t = by.get(k); t.n++; if (r.d > 0) t.plus++; if (r.d < 0) t.minus++; if (r.same) t.same++ }
    console.log(`\n## ${label}`)
    for (const [k, t] of [...by].sort()) console.log(`${String(k).padEnd(34)} n=${String(t.n).padStart(4)}  +${t.plus}/−${t.minus}  text identical ${t.same}`)
}
console.log(`${V} vs ${B} on ${setsArg}: ${rows.length} paired questions`)
tally("stratum", (r) => r.stratum)
tally("stratum × base step", (r) => `${r.stratum} ${r.bStep}`)
tally("stratum × variant step (if moved)", (r) => (r.bStep !== r.vStep ? `${r.stratum} ${r.bStep}→${r.vStep}` : null))
tally("hits: who / chain gold", (r) => (r.stratum === "hit" ? `${r.who ? "who" : "other"} ${r.chain ? "chain" : "single"}` : null))
if (list) for (const r of rows.filter((x) => x.d !== 0)) console.log(`${r.d > 0 ? "+" : "-"} ${r.s} ${r.key} [${r.stratum} ${r.bStep}${r.bStep !== r.vStep ? `→${r.vStep}` : ""}${r.who ? " who" : ""}${r.chain ? " chain" : ""}]\n   Q: ${r.v.record.question}\n   GOLD: ${r.v.record.gold}\n   ${B}: ${r.b.answer.answer}\n   ${V}: ${r.v.answer.answer}`)
process.exit(0)
