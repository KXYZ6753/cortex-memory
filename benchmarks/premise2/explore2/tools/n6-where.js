// Worker n6: where could a document-contrastive read help gates on hits? (offline, no GPU)
// For each set: gates' hit answers (det gates where stored, else stored gates; gates is
// deterministic without det, i.md) joined with gold-only `oracles` and gold-only CAD
// `u-ocad5`; position of the gold (or a twin / answer-bearing email) in the context gates
// answered from, and verdict cross-tabs.
//   node benchmarks/premise2/explore2/tools/n6-where.js S300-1,S300-2,S300-3,FULL-0,FULL-1
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,FULL-0,FULL-1").split(",")
const tot = { n: 0, pos: {}, g: 0, o: 0, c: 0, tab: {} }
for (const s of sets) {
    let G = graded("i-det-gates@2+cold", s)
    if (!G.length) G = graded("gates@1+cold", s)
    const O = new Map(graded("oracles@1+cold", s).map((i) => [i.record.questionKey, i]))
    const C = new Map(graded("u-ocad5@1+cold", s).map((i) => [i.record.questionKey, i]))
    const row = { n: 0, pos: {}, g: 0, o: 0, c: 0, tab: {} }
    for (const g of G) {
        if (g.record.stratum !== "hit" || g.correct == null) continue
        const r = g.record
        // the context gates answered from = the last context read
        const read = g.answer.readPaths ?? g.answer.contextPaths ?? []
        const used = g.answer.used ?? 1
        const ctxPaths = used > 1 ? read.slice(5 * (used - 1)) : (g.answer.contextPaths ?? [])
        const isGold = (p) => p === r.path || (r.twins ?? []).includes(p)
        const ab = bearing(r)
        let pos = ctxPaths.findIndex(isGold)
        const kind = pos >= 0 ? `gold@${pos + 1}` : ctxPaths.findIndex(ab) >= 0 ? `AB@${ctxPaths.findIndex(ab) + 1}` : "none"
        const o = O.get(r.questionKey), c = C.get(r.questionKey)
        for (const t of [row, tot]) {
            t.n++; t.pos[kind] = (t.pos[kind] ?? 0) + 1; t.g += g.correct
            if (o?.correct != null) t.o += o.correct
            if (c?.correct != null) t.c += c.correct
            const key = `${kind.replace(/@[2-5]/, "@2-5")} g${g.correct} o${o?.correct ?? "-"} c${c?.correct ?? "-"}`
            t.tab[key] = (t.tab[key] ?? 0) + 1
        }
    }
    console.log(`${s}: ${row.n} hits; gates ${row.g}, oracles ${row.o}, ocad5 ${row.c}; context ${JSON.stringify(row.pos)}`)
}
console.log(`\nALL: ${tot.n} hits; gates ${tot.g} (${(100 * tot.g / tot.n).toFixed(1)}), oracles ${tot.o}, ocad5 ${tot.c}`)
console.log(`gold position in the answering context: ${JSON.stringify(tot.pos)}`)
for (const [k, v] of Object.entries(tot.tab).sort()) console.log(`  ${k.padEnd(26)} ${v}`)
process.exit(0)
