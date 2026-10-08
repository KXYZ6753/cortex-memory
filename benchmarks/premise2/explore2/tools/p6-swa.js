// Worker p6: sliding-window exposure of the answer-bearing email (no GPU).
//   node benchmarks/premise2/explore2/tools/p6-swa.js <set,set>
// 1. Calibrates characters per token from det-recorded prompt_eval_count of p6-g0 answers
//    (gold-only sandwich prompts). 2. For gates' first context (stored i-det-gates contextPaths)
//    estimates, per hit, how many tokens of the gold email lie beyond the 512-token sliding window
//    of the leading question in the sandwich (question ... rules ... emails) and in qadj / o4
//    (question right before the emails), i.e. the tokens whose local-layer encoding the shape
//    change can affect.
import { join } from "node:path"
import { ensureEmailStore } from "../../agent-run.js"
import { sandwichPrompt } from "../../explore/variants.js"
import { loadAnswers, grading, setKeys } from "./p6-lib.js"
import { SHAPES } from "../variants/p6-shape.js"

const sets = process.argv[2].split(",")
const A = await loadAnswers(["p6-g0@1", "i-det-gates@2"])
const { pool, dataDir } = { ...grading(), dataDir: ".data/premise2" }
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
// 1. calibration
let ch = 0, tk = 0
for (const a of A.get("p6-g0@1").values()) {
    const rec = pool.byKey.get(a.questionKey)
    const t = a.det?.evaluated?.[0]
    if (!t) continue
    ch += sandwichPrompt(rec.question, [emails.emailOf(rec.path)]).length; tk += t
}
const cpt = ch / tk
console.log(`chars per token (gold-only sandwich prompts): ${cpt.toFixed(2)} over ${tk} tokens`)
// 2. exposure in gates' first context
const W = 512
const rows = []
for (const set of sets) for (const qk of setKeys(set)) {
    const g = A.get("i-det-gates@2").get(`${set}|${qk}`)
    const rec = pool.byKey.get(qk)
    if (!g || rec.stratum !== "hit") continue
    const gold = new Set([rec.path, ...(rec.twins ?? [])])
    const ctxEmails = g.contextPaths.map((p) => emails.emailOf(p))
    const pos = g.contextPaths.findIndex((p) => gold.has(p))
    const out = { pos }
    for (const shape of ["sandwich", "qadj"]) {
        const prompt = SHAPES[shape](rec.question, ctxEmails)
        const q = prompt.indexOf(`Question: ${rec.question}`) + `Question: ${rec.question}`.length
        if (pos < 0) { out[shape] = null; continue }
        const start = prompt.indexOf(`[${pos + 1}]\n${ctxEmails[pos]}`)
        const end = start + ctxEmails[pos].length
        // tokens of the gold email farther than W tokens from the end of the leading question
        const beyond = Math.max(0, (end - q) / cpt - W) - Math.max(0, (start - q) / cpt - W)
        out[shape] = { beyond, len: ctxEmails[pos].length / cpt, startTok: (start - q) / cpt }
    }
    rows.push(out)
}
const n = rows.length
const at = rows.filter((r) => r.pos >= 0)
console.log(`hits ${n}; gold in first context ${at.length}; at position 0: ${at.filter((r) => r.pos === 0).length}`)
const share = (f) => `${(100 * at.filter(f).length / at.length).toFixed(1)}%`
console.log(`gold email entirely inside the leading question's window: sandwich ${share((r) => r.sandwich.beyond < 1)}, qadj ${share((r) => r.qadj.beyond < 1)}`)
console.log(`gold email entirely outside it: sandwich ${share((r) => r.sandwich.startTok > W)}, qadj ${share((r) => r.qadj.startTok > W)}`)
const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
console.log(`mean gold tokens beyond the window: sandwich ${mean(at.map((r) => r.sandwich.beyond)).toFixed(0)}, qadj ${mean(at.map((r) => r.qadj.beyond)).toFixed(0)} (mean gold length ${mean(at.map((r) => r.sandwich.len)).toFixed(0)} tokens)`)
console.log(`hits where qadj brings >= 25 more gold tokens inside the window: ${share((r) => r.sandwich.beyond - r.qadj.beyond >= 25)}`)
emails.close()
process.exit(0)
