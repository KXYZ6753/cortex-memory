// Offline: calibration of e2b token logprobs (n-lp0 traces) and confidence-based
// selection among the four prompt candidates (gates / o4 / o5 / t2), verdicts by text.
// node benchmarks/premise2/explore2/tools/n-lpsel.js S300-2
import { pool, loadTable, verdictOf, weightedOf, same } from "./n-lib.js"
import { isAbstain } from "../../prompts.js"
const [setName = "S300-2", variant = "n-lp0"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, [variant, "gates", "o4", "o5", "pb"])
const lp = table.get(variant)
const C = ["gates", "o4", "t2"]
const feats = (t) => {
    const l = t.lps.length ? t.lps : [0]
    const content = t.lps.filter((_, i) => !/^\s*[.,;:'"()\-]*\s*$/.test(t.toks[i]))
    return {
        mean: l.reduce((a, b) => a + b, 0) / l.length,
        min: Math.min(...l),
        sum: l.reduce((a, b) => a + b, 0),
        first10: l.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, l.length),
        meanC: content.length ? content.reduce((a, b) => a + b, 0) / content.length : 0,
        low: l.filter((x) => x < Math.log(0.5)).length,
        n: l.length,
        p0: Math.exp(l[0]),
    }
}
const rows = []
let match = { gates: 0, o4: 0, o5: 0, t2: 0 }, miss = { gates: 0, o4: 0, o5: 0, t2: 0 }
for (const q of keys) {
    const a = lp.get(q); if (!a?.a?.lp) continue
    const r = pool.byKey.get(q)
    const row = { q, stratum: r.stratum, switched: a.a.switched, c: {} }
    for (const name of C) {
        const t = a.a.lp[name]
        let v = verdictOf(r, t.answer)
        const ref = { gates: "gates", o4: "o4", o5: "o5", t2: "pb" }[name]
        const stored = table.get(ref)?.get(q)
        if (stored && same(stored.answer, t.answer)) match[name]++; else miss[name]++
        row.c[name] = { v, abstain: isAbstain(t.answer), answer: t.answer, ...feats(t) }
    }
    rows.push(row)
}
console.log("rows", rows.length, "text matches stored", match, "mismatch", miss)
// Calibration: AUC of each feature for gates' correctness, by stratum.
const auc = (pos, neg) => { let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0; return pos.length && neg.length ? s / pos.length / neg.length : NaN }
for (const st of ["hit", "miss", "all"]) {
    const rs = rows.filter((r) => (st === "all" || r.stratum === st) && r.c.gates.v !== null && !r.c.gates.abstain)
    const out = {}
    for (const f of ["mean", "min", "sum", "first10", "meanC", "low", "n", "p0"]) out[f] = auc(rs.filter((r) => r.c.gates.v).map((r) => r.c.gates[f]), rs.filter((r) => !r.c.gates.v).map((r) => r.c.gates[f])).toFixed(3)
    console.log(`AUC gates correct (${st}, n=${rs.length}, wrong ${rs.filter((r) => !r.c.gates.v).length})`, out)
}
// Selection policies over candidates with known verdicts.
const pol = (name, choose) => {
    const items = []; let unknown = 0, changed = 0, good = 0, bad = 0
    for (const r of rows) {
        const pick = choose(r)
        const v = r.c[pick].v
        if (v === null) { unknown++; items.push({ stratum: r.stratum, v: r.c.gates.v ?? 0 }); continue }
        if (pick !== "gates" && !same(r.c[pick].answer, r.c.gates.answer)) { changed++; if (v > r.c.gates.v) good++; if (v < r.c.gates.v) bad++ }
        items.push({ stratum: r.stratum, v })
    }
    const w = weightedOf(items)
    console.log(`${name.padEnd(34)} ${w.w.toFixed(1)} miss ${w.miss.toFixed(0)} hit ${w.hit.toFixed(1)} changed ${changed} (+${good}/-${bad}) unknown ${unknown}`)
}
pol("gates", () => "gates")
for (const n of ["o4", "t2"]) pol(n, () => n)
for (const f of ["mean", "min", "sum", "first10", "meanC"]) {
    for (const set of [["gates", "o4"], ["gates", "t2"], C]) {
        for (const margin of [0, 0.05, 0.1, 0.2]) {
            const ok = (r, c) => !r.c[c].abstain || c === "gates"
            pol(`${f} ${set.join("+")} m${margin}`, (r) => set.filter((c) => ok(r, c)).reduce((best, c) => (r.c[c][f] > r.c[best][f] + (best === "gates" ? margin * (f === "sum" || f === "min" ? 10 : 1) : 0) ? c : best), "gates"))
        }
    }
}
