// Offline: how often a4's blend trigger fires on stored gates answers, and accuracy
// of fired vs not-fired answers per stratum.  node .../a-blend.js [variant@version] [set]
import { openAll } from "./a-lib.js"
import { BLEND } from "../variants/a-hybrid.js"
const [target = "gates@1+cold", setName = "FULL-0"] = process.argv.slice(2)
const { graded, emails } = await openAll()
const items = graded(target, setName).filter((i) => i.correct !== null && !i.abstain)
for (const st of ["hit", "miss"]) {
    const l = items.filter((i) => i.record.stratum === st)
    const f = l.filter((i) => BLEND.test(i.answer.answer))
    const acc = (a) => (a.filter((i) => i.correct).length / a.length).toFixed(3)
    console.log(`${target} ${setName} ${st}: fires ${f.length}/${l.length}, acc fired ${acc(f)}, rest ${acc(l.filter((i) => !f.includes(i)))}`)
}
emails.close()
