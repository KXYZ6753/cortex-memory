// Worker n6: what kind of token decisions does a logged configuration change, and which kinds
// carry its verdict flips? A change is "content" when the chosen or the replaced token holds a
// digit or starts with an uppercase letter (names, numbers, dates, codes), else "wording".
// Also: a crude content-only simulation (answers whose changes are all wording revert to greedy;
// exact only up to the first content branch). Offline, no GPU.
//   node benchmarks/premise2/explore2/tools/n6-sites.js <variant@ver> <set,set> <config> [tau]
import { openN6 } from "./n6-lib.js"
const [v, setsArg, cfgName, tauArg] = process.argv.slice(2)
const tau = tauArg ? Number(tauArg) : null
const { graded, verdictOf } = await openN6()
const isContent = (t) => /\d/.test(t) || /^\s*[A-Z]/.test(t)
const tab = {}
let simPlus = 0, simMinus = 0, nChanges = 0, nContent = 0
for (const s of setsArg.split(",")) for (const i of graded(v, s)) {
    if (i.record.stratum !== "hit" || !i.answer.n6 || i.correct == null) continue
    const c = i.answer.n6.cfg[cfgName]
    if (tau !== null && i.answer.n6.greedy.mean >= tau) continue
    const ok = verdictOf(c.answer, i.record, c.status)
    if (ok == null || c.answer === i.answer.answer) continue
    const ch = c.changes ?? []
    nChanges += ch.length
    const kinds = ch.map((x) => (isContent(x.from) || isContent(x.to) ? "content" : "wording"))
    nContent += kinds.filter((k) => k === "content").length
    const first = kinds[0] ?? "none"
    const any = kinds.includes("content") ? "anyContent" : "wordingOnly"
    const d = ok - i.correct
    for (const k of [`first ${first}`, any]) {
        const r = (tab[k] ??= { n: 0, plus: 0, minus: 0 })
        r.n++; if (d > 0) r.plus++; if (d < 0) r.minus++
    }
    if (any === "anyContent") { if (d > 0) simPlus++; if (d < 0) simMinus++ }
}
console.log(`${v} ${setsArg} ${cfgName} tau ${tau ?? "none"}: changed answers by change type (changes ${nChanges}, content ${nContent})`)
for (const [k, r] of Object.entries(tab).sort()) console.log(`  ${k.padEnd(14)} n ${String(r.n).padStart(4)}  +${r.plus}/-${r.minus}`)
console.log(`  content-only (crude): +${simPlus}/-${simMinus}`)
process.exit(0)
