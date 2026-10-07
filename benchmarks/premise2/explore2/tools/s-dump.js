// Worker s: dump the base-wrong hit answers of s-gold (for hand labels with j's taxonomy,
// stored in tools/s-labels.json as { key: { label, set } }), with every form's answer.
//   node benchmarks/premise2/explore2/tools/s-dump.js <sets> [variant=s-gold]
import { existsSync, readFileSync } from "node:fs"
import { latestAnswers } from "../../explore/grade.js"
import { pool, dataDir, verdictOf, verdictRow } from "./c-lib.js"
const [setsArg, variant = "s-gold"] = process.argv.slice(2)
const sets = setsArg.split(",")
const labels = existsSync(new URL("./s-labels.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./s-labels.json", import.meta.url), "utf8")) : {}
const VERSION = process.env.SVER ?? "3+cold" // only this version's answers (earlier versions had a broken rewrite)
for (const a of latestAnswers(dataDir)) {
    if (!sets.includes(a.set) || a.variant !== variant || !a.renders || a.version !== VERSION) continue
    const r = pool.byKey.get(a.questionKey)
    if (verdictOf(r, a.renders.base.answer) !== 0) continue
    const v = (n) => (a.renders[n] ? verdictOf(r, a.renders[n].answer) : null)
    console.log(`\n=== ${a.set} ${a.questionKey} ${labels[a.questionKey]?.label ?? ""}\nQ: ${r.question}\nGOLD: ${r.gold}\nBASE: ${a.renders.base.answer}\nJ1: ${verdictRow(r, a.renders.base.answer)?.reason ?? ""}`)
    for (const n of Object.keys(a.renders)) if (n !== "base") console.log(`${n.toUpperCase()} [${v(n)}]: ${a.renders[n].answer.slice(0, 300)}`)
}
