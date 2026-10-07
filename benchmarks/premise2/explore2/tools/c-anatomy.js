// Worker c: hit accuracy of x1 / gates / oracles by gold-email anatomy (chain, evidence
// location, length). Offline; dev sets only.
//   node benchmarks/premise2/explore2/tools/c-anatomy.js [sets] > scratch.jsonl
import { pool, loadTable, emails, closeEmails, anatomy, DEV_SETS } from "./c-lib.js"
const sets = process.argv[2] ? process.argv[2].split(",") : DEV_SETS
const store = await emails()
const rows = []
for (const s of sets) {
    const { table, keys } = loadTable(s, ["x1", "gates", "oracles"])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const an = anatomy(store.emailOf(r.path), r)
        const c = (v) => table.get(v)?.get(key)?.correct ?? null
        rows.push({ set: s, key, q: r.question, ...an, x1: c("x1"), gates: c("gates"), oracles: c("oracles") })
    }
}
closeEmails()
const groups = {
    nMsgs: (r) => (r.nMsgs === 1 ? "1" : r.nMsgs === 2 ? "2" : "3+"),
    evRegion: (r) => r.evRegion,
    evCovBin: (r) => (r.evCov >= 0.8 ? ">=.8" : r.evCov >= 0.5 ? ".5-.8" : "<.5"),
    charsBin: (r) => (r.chars < 1500 ? "<1.5k" : r.chars < 4000 ? "1.5-4k" : r.chars < 10000 ? "4-10k" : ">=10k"),
    evOffBin: (r) => (r.evOffset < 1000 ? "<1k" : r.evOffset < 3000 ? "1-3k" : r.evOffset < 6000 ? "3-6k" : ">=6k"),
    rawHdr: (r) => (r.rawHdrLines > 0 ? "yes" : "no"),
    quoted: (r) => (r.quotedLines > 0 ? "yes" : "no"),
    disclaimer: (r) => String(r.disclaimer),
    recip: (r) => (r.nRecip <= 1 ? "<=1" : r.nRecip <= 5 ? "2-5" : ">5"),
}
const acc = (l, v) => { const g = l.filter((r) => r[v] !== null); return g.length ? `${(100 * g.filter((r) => r[v] === 1).length / g.length).toFixed(1)} (${g.filter((r) => r[v] === 0).length}w/${g.length})` : "-" }
console.log(`hits: ${rows.length}; x1 ${acc(rows, "x1")}; gates ${acc(rows, "gates")}; oracles ${acc(rows, "oracles")}`)
for (const [name, f] of Object.entries(groups)) {
    console.log(`\n## ${name}`)
    const by = new Map()
    for (const r of rows) { const k = f(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
    for (const [k, l] of [...by].sort()) console.log(`${String(k).padEnd(12)} n=${String(l.length).padStart(4)}  x1 ${acc(l, "x1").padEnd(16)} gates ${acc(l, "gates").padEnd(16)} oracles ${acc(l, "oracles")}`)
}
import { writeFileSync } from "node:fs"
if (process.env.OUT) writeFileSync(process.env.OUT, rows.map((r) => JSON.stringify(r)).join("\n"))
