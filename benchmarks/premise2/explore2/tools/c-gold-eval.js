// Worker c: evaluate the renders of a diagnostic gold-only variant (c-gold*) on hits:
// accuracy per render, paired flips vs base, by chain / question type, paired bootstrap CI.
//   node benchmarks/premise2/explore2/tools/c-gold-eval.js <sets> [variant=c-gold] [base=base]
import { questionType } from "../../text.js"
import { segmentThread } from "../variants/c-render.js"
import { latestAnswers } from "../../explore/grade.js"
import { pool, dataDir, verdictOf, emails, closeEmails } from "./c-lib.js"
import { mulberry32, BOOT_B } from "./rng.js"

const [setsArg, variant = "c-gold", baseName = "base"] = process.argv.slice(2)
const sets = setsArg.split(",")
const store = await emails()
const rows = []
for (const a of latestAnswers(dataDir)) {
    if (!sets.includes(a.set) || a.variant !== variant || !a.renders) continue
    const r = pool.byKey.get(a.questionKey)
    const chain = segmentThread(store.emailOf(r.path)).blocks.length > 0
    const v = Object.fromEntries(Object.entries(a.renders).map(([k, x]) => [k, x.status === "ok" || x.status === "output_limit" ? verdictOf(r, x.answer) : 0]))
    rows.push({ key: a.questionKey, set: a.set, qt: questionType(r.question), chain, v, renders: a.renders })
}
closeEmails()
const names = Object.keys(rows[0]?.v ?? {})
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : "-")
function boot(diffs, B = BOOT_B) {
    const rnd = mulberry32(7) // was a double-precision LCG; from seed 7 its period is 419 (ci-erratum.md)
    const out = []
    for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)]; out.push(s / diffs.length) }
    out.sort((a, b) => a - b)
    return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]].map((x) => (100 * x).toFixed(1))
}
function table(label, sel) {
    const sub = rows.filter(sel)
    console.log(`\n## ${label} (n = ${sub.length})`)
    for (const name of names) {
        const g = sub.filter((x) => x.v[name] !== null && x.v[baseName] !== null)
        const ok = g.filter((x) => x.v[name] === 1).length
        const plus = g.filter((x) => x.v[name] === 1 && x.v[baseName] === 0).length
        const minus = g.filter((x) => x.v[name] === 0 && x.v[baseName] === 1).length
        const changed = g.filter((x) => !x.renders[name].copied || x.renders[name].answer !== x.renders[baseName].answer).length
        const unk = sub.length - g.length
        const ci = name === baseName ? "" : `Δ ${(100 * (plus - minus) / Math.max(1, g.length)).toFixed(1)} [${boot(g.map((x) => x.v[name] - x.v[baseName])).join(", ")}]`
        console.log(`${name.padEnd(10)} ${pct(ok, g.length).padStart(5)}  +${plus}/−${minus}  ${ci}${unk ? `  (ungraded ${unk})` : ""}`)
    }
}
table("all hits", () => true)
table("chain gold emails", (x) => x.chain)
table("single-message gold emails", (x) => !x.chain)
for (const qt of ["who", "when", "number", "url-contact", "other"]) table(`qtype ${qt}`, (x) => x.qt === qt)
for (const s of sets) table(`set ${s}`, (x) => x.set === s)
if (process.env.FLIPS) for (const name of process.env.FLIPS.split(",")) {
    console.log(`\n### flips ${name} vs ${baseName}`)
    for (const x of rows) if (x.v[name] !== null && x.v[baseName] !== null && x.v[name] !== x.v[baseName]) {
        const r = pool.byKey.get(x.key)
        console.log(`${x.v[name] ? "+" : "-"} ${x.key} [${x.qt}${x.chain ? ", chain" : ""}] Q: ${r.question}\n   GOLD: ${r.gold}\n   BASE: ${x.renders[baseName].answer}\n   ${name.toUpperCase()}: ${x.renders[name].answer}`)
    }
}
