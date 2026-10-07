// Worker s: offline check of the deterministic candidate spans for the recognition forms
// (no GPU). For typed hit questions on dev sets: how often a top-6 / any candidate is
// contained in the gold answer (recall proxy), split by whether stored oracles was right.
//   node benchmarks/premise2/explore2/tools/s-cands.js [sets] [show]
import { mcType, candidates, cleanStem } from "../variants/s-cloze.js"
import { loadTable, pool, closeEmails, emails } from "./c-lib.js"
const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,FULL-1").split(",")
const show = Number(process.argv[3] ?? 0)
const store = await emails()
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9$%@./]+/g, " ").trim()} `
const tab = {}
let shown = 0
for (const s of sets) {
    const t = loadTable(s, ["oracles"]).table.get("oracles")
    for (const [key, row] of t ?? []) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const type = mcType(r.question)
        const k = `${type ?? "none"}|${row.correct === 1 ? "right" : "wrong"}`
        tab[k] ??= { n: 0, top: 0, any: 0, nc: 0, opts: 0 }
        tab[k].n++
        if (!type) continue
        const { all, top } = candidates(r.question, store.emailOf(r.path), type)
        const golds = [r.gold, ...(r.alternates ?? [])].map(norm)
        const inGold = (c) => golds.some((g) => g.includes(norm(c.text)))
        const q = norm(r.question)
        const useful = (c) => inGold(c) && !q.includes(norm(c.text))
        if (top.some(useful)) tab[k].top++
        if (all.some(useful)) tab[k].any++
        tab[k].nc += all.length
        tab[k].opts += top.length
        if (shown < show && row.correct === 0) { shown++; console.log(`\n[${type}] ${r.question}\n GOLD: ${r.gold}\n ORACLES: ${row.answer}\n TOP: ${top.map((c) => `${c.text} (${c.score})`).join(" | ")}\n n=${all.length}`) }
    }
}
for (const [k, v] of Object.entries(tab).sort()) console.log(`${k.padEnd(20)} n ${String(v.n).padStart(4)}  gold-in-top6 ${v.top}  gold-in-any ${v.any}  mean cands ${(v.nc / v.n).toFixed(1)}  mean opts ${(v.opts / v.n).toFixed(1)}`)
closeEmails()
