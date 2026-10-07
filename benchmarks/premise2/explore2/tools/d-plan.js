// Worker d: x1's explore plan search (the model's FROM / TO / ABOUT line -> filtered mailbox
// BM25, top 10 prepended to the pick list). AB in the logged results top 10, vs hybrids with
// nomic dense over the plan text (`${about} ${question}`, d-gemb vectors) and over the question.
//   node benchmarks/premise2/explore2/tools/d-plan.js
import { existsSync, readFileSync } from "node:fs"
import { denseSearch } from "../../dense.js"
import { openLab, storedRows, rrf, uniq } from "./d-lib.js"
import { fromB64, GEMB_FILE } from "../variants/d-dense.js"

const lab = await openLab()
const x1 = storedRows("x1", "1+cold")
const gemb = new Map()
if (existsSync(GEMB_FILE)) for (const line of readFileSync(GEMB_FILE, "utf8").split("\n")) if (line) { const r = JSON.parse(line); gemb.set(`${r.key}|${r.kind}|${r.i}`, fromB64(r.v)) }
const tab = {}
const bump = (g, name, v) => { const t = ((tab[g] ??= {})[name] ??= { n: 0, top10: 0, newAB: 0 }); t.n++; t.top10 += v.top10; t.newAB += v.newAB }
for (const record of lab.records) {
    const x = x1.get(record.questionKey)
    const s = (x?.log ?? []).find((l) => l.act === "search")
    if (!s) continue
    const ab = (p) => lab.answerBearing(record, p)
    const firstList = (x.log.find((l) => l.act === "pick")?.listed ?? [])
    const W0 = new Set(lab.gatesOf(record).W0)
    const logged = (s.results ?? []).slice(0, 10)
    const lists = { "plan search (logged)": logged }
    const v = gemb.get(`${record.questionKey}|plan|0`)
    if (v) {
        const dp = denseSearch(lab.index, v, 20, record.user).map((h) => h.path)
        lists["dense(plan text)"] = dp.slice(0, 10)
        lists["rrf(plan, dense plan)"] = rrf([logged, dp], 10).slice(0, 10)
    }
    const dq = lab.denseList(record.questionKey, record.user, { which: "q", k: 20 })?.map((h) => h.path)
    if (dq) lists["rrf(plan, dense question)"] = rrf([logged, dq], 10).slice(0, 10)
    const grp = `${record.stratum}`
    for (const [name, list] of Object.entries(lists)) {
        const l = list.filter((p) => !W0.has(p))
        bump(grp, name, { top10: l.some(ab), newAB: l.some(ab) && !firstList.some(ab) })
    }
}
console.log(`x1 explore plan searches; vectors for ${[...gemb.keys()].filter((k) => k.includes("|plan|")).length}`)
for (const [g, byName] of Object.entries(tab)) {
    console.log(`  [${g}] AB in top 10 (W0 excluded) / AB new vs the first pick list`)
    for (const [name, t] of Object.entries(byName)) console.log(`    ${name.padEnd(28)} n=${String(t.n).padStart(4)} ${String(t.top10).padStart(5)} ${String(t.newAB).padStart(5)}`)
}
process.exit(0)
