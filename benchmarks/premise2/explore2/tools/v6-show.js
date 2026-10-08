// v6 (aux): show pool-A discordant hit pairs (gates vs a same-context alternative) where the QA encoder's
// margin is largest, in the right and in the wrong direction: question, both answers, top QA spans.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OUT } from "./v6-lib.js"
import { features, readOf } from "./v6-feat.js"
const [n = "6"] = process.argv.slice(2)
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const rows = []
for (const q of pools.A) {
    if (q.stratum !== "hit") continue
    const par = q.cands.find((c) => c.text === q.parent)
    for (const a of q.cands) {
        if (a.text === q.parent || a.correct === par.correct) continue
        const f = features(q, q.evidence, [par.text, a.text])
        if (!f) continue
        const right = a.correct ? a.text : par.text, wrong = a.correct ? par.text : a.text
        const d = a.correct ? f[1].ef - f[0].ef : f[0].ef - f[1].ef // > 0: encoder prefers the right one
        rows.push({ q, right, wrong, d, spans: readOf(q, q.evidence).spans.slice(0, 4).map((s) => `${s.text.slice(0, 60)} (${s.score.toFixed(1)})`) })
        break
    }
}
rows.sort((a, b) => a.d - b.d)
const show = (r) => console.log(`Q: ${r.q.question}\n  RIGHT: ${r.right.slice(0, 220)}\n  WRONG: ${r.wrong.slice(0, 220)}\n  margin toward right ${r.d.toFixed(3)}; top spans: ${r.spans.join(" | ")}\n`)
console.log(`== encoder most wrong (${n})`); rows.slice(0, Number(n)).forEach(show)
console.log(`== encoder most right (${n})`); rows.slice(-Number(n)).forEach(show)
const buckets = { "wrong (< -0.1)": 0, "unsure (|d| <= 0.1)": 0, "right (> 0.1)": 0 }
for (const r of rows) buckets[r.d < -0.1 ? "wrong (< -0.1)" : r.d > 0.1 ? "right (> 0.1)" : "unsure (|d| <= 0.1)"]++
console.log(buckets, rows.length)
