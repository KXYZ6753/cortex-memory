// Offline: for stored answers whose source email is not answer-bearing, rank of the first
// AB email among the unseen candidates (mailbox top 30 ∪ global top 10) ordered by MiniLM
// vs by mailbox BM25/header order. Decides the probe depth N.
//   node benchmarks/premise2/explore2/tools/h-depth.js gates@1+cold:FULL-0 gates@1+cold:S300-1
import { openH } from "./h-common.js"
import { attribute } from "../variants/a-common.js"
const env = await openH()
const cum = { ce: {}, bm: {}, rrf: {} }
let n = 0
for (const spec of process.argv.slice(2)) {
    const [v, set] = spec.split(":")
    for (const item of env.graded(v, set)) {
        if (item.correct === null || item.correct) continue
        const { answer, record } = item
        const f = env.feats.get(record.questionKey), sc = env.ce[record.questionKey]?.s
        if (!f || !sc) continue
        const used = answer.used ?? 1
        const final = used > 1 ? answer.readPaths.slice(answer.contextPaths.length) : answer.contextPaths
        const ab = env.bearing(record)
        const src = item.abstain ? null : attribute(answer.answer, record.question, final, env.emails.emailOf)
        if (src && ab(src.path)) continue
        const cands = [...new Set([...f.mailbox.map((x) => x[0]), ...f.global.map((x) => x[0]).slice(0, 10)])].filter((p) => !final.includes(p))
        const byCe = [...cands].sort((a, b) => (sc[b] ?? -20) - (sc[a] ?? -20))
        n++
        const rr = (p) => 1 / (10 + byCe.indexOf(p)) + 1 / (10 + cands.indexOf(p)); const byRrf = [...cands].sort((a, b) => rr(b) - rr(a))
        for (const [k, list] of [["ce", byCe], ["bm", cands], ["rrf", byRrf]]) { const r = list.findIndex(ab); for (const N of [4, 8, 12, 16, 20, 30, 40]) cum[k][N] = (cum[k][N] ?? 0) + (r >= 0 && r < N ? 1 : 0) }
    }
}
console.log(`wrong answers with non-AB source: ${n}`)
for (const k of ["ce", "bm", "rrf"]) console.log(k, Object.entries(cum[k]).map(([N, c]) => `@${N} ${(100 * c / n).toFixed(1)}%`).join("  "))
