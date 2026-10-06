// Worker y: results table for y variants (J1): per set and pooled, weighted / miss / hit,
// Δ vs x1 and vs gates (paired stratified bootstrap), wall mean / p95, calls; verdict flips
// vs x1 by y's route; same-text rates vs the parents on each route (reproduction check).
//   node benchmarks/premise2/explore2/tools/y-table.js [S300-2,S300-1] [y1,y2]
import { openAll, weightedOf, bootstrap, fmtCi, byKey, pct, route } from "./y-lib.js"
const { graded, missShare } = await openAll()
const sets = (process.argv[2] ?? "S300-2,S300-1").split(",")
const ids = (process.argv[3] ?? "y1,y2").split(",")
const V = (id) => (id.includes("@") ? id : `${id}@1+cold`)
const groups = [...sets.map((s) => [s]), ...(sets.length > 1 ? [sets] : [])]
const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length

for (const g of groups) {
    const X = byKey(graded, V("x1"), g), GA = byKey(graded, V("gates"), g)
    console.log(`\n## ${g.join(" + ")}`)
    console.log("| id | n | weighted | miss | hit | Δ vs x1 [CI] | Δ vs gates [CI] | wall ms | p95 wall | calls | p95 calls |")
    console.log("|---|---|---|---|---|---|---|---|---|---|---|")
    for (const id of [...ids, "m2", "j2", "t-lx", "x1"]) {
        const Y = byKey(graded, V(id), g)
        const items = [...Y.values()]
        if (!items.length) { console.log(`| ${id} | 0 |`); continue }
        const ung = items.filter((i) => i.correct == null).length
        const gr = items.filter((i) => i.correct != null)
        const w = weightedOf(gr, missShare)
        const d = (R) => { const p = gr.filter((i) => R.get(i.record.questionKey)?.correct != null).map((i) => ({ stratum: i.record.stratum, d: i.correct - R.get(i.record.questionKey).correct })); return p.length ? fmtCi(bootstrap(p, missShare)) : "–" }
        const walls = items.map((i) => i.answer.wallMs ?? 0), calls = items.map((i) => i.answer.calls ?? 0)
        console.log(`| ${id} | ${items.length}${ung ? ` (ungraded ${ung})` : ""} | ${(100 * w.weighted).toFixed(1)} | ${(100 * w.miss).toFixed(1)} | ${(100 * w.hit).toFixed(1)} | ${id === "x1" ? "–" : d(X)} | ${d(GA)} | ${Math.round(mean(walls))} | ${pct(walls, 0.95)} | ${mean(calls).toFixed(2)} | ${pct(calls, 0.95)} |`)
    }
    // flips vs x1 by route
    const M = byKey(graded, V("m2"), g), J = byKey(graded, V("j2"), g), TL = byKey(graded, V("t-lx"), g)
    for (const id of ids) {
        const Y = byKey(graded, V(id), g)
        if (!Y.size) continue
        const base = id === "y2" ? TL : X
        const t = new Map()
        for (const [k, y] of Y) {
            const x = X.get(k)
            if (!x) continue
            const fired = y.answer.y?.m2Fired ? " [m2 probed]" : ""
            const r = route(y.answer) + (route(y.answer).startsWith("unsure") || route(y.answer) === "sure commit" ? fired : "")
            const c = t.get(r) ?? { n: 0, y: 0, x: 0, hp: 0, hm: 0, mp: 0, mm: 0, sameX: 0, sameJ: 0, sameM: 0, sameB: 0, ung: 0 }
            c.n++
            if (y.correct == null || x.correct == null) { c.ung++; t.set(r, c); continue }
            c.y += y.correct; c.x += x.correct
            const hit = y.record.stratum === "hit"
            if (y.correct > x.correct) hit ? c.hp++ : c.mp++
            if (y.correct < x.correct) hit ? c.hm++ : c.mm++
            if (y.answer.answer === x.answer.answer) c.sameX++
            if (J.get(k)?.answer.answer === y.answer.answer) c.sameJ++
            if (M.get(k)?.answer.answer === y.answer.answer) c.sameM++
            if (base.get(k)?.answer.answer === y.answer.answer) c.sameB++
            t.set(r, c)
        }
        console.log(`\n${id} vs x1 by route (${g.join("+")}): route | n | ${id} right | x1 right | hits +/- | misses +/- | same text as x1 / j2 / m2${id === "y2" ? " / t-lx" : ""}`)
        console.log(`|route|n|${id}|x1|hits|misses|same x1/j2/m2${id === "y2" ? "/t-lx" : ""}|\n|---|---|---|---|---|---|---|`)
        for (const [r, c] of [...t].sort()) console.log(`| ${r} | ${c.n}${c.ung ? ` (ung ${c.ung})` : ""} | ${c.y} | ${c.x} | +${c.hp}/-${c.hm} | +${c.mp}/-${c.mm} | ${c.sameX} / ${c.sameJ} / ${c.sameM}${id === "y2" ? ` / ${c.sameB}` : ""} |`)
        // by x1's own path -> y's handling
        const xp = (a) => (a.step === "commit" ? "x1 sure commit" : a.step === "commit-g5" ? "x1 unsure → g5" : "x1 explore")
        const yp = (a) => { const r = route(a); return r.startsWith("recovery") ? "recovery" : r }
        const u = new Map()
        for (const [k, y] of Y) {
            const x = X.get(k)
            if (!x || y.correct == null || x.correct == null) continue
            const key = `${xp(x.answer)} → ${yp(y.answer)}`
            const c = u.get(key) ?? { n: 0, hp: 0, hm: 0, mp: 0, mm: 0 }
            c.n++
            const hit = y.record.stratum === "hit"
            if (y.correct > x.correct) hit ? c.hp++ : c.mp++
            if (y.correct < x.correct) hit ? c.hm++ : c.mm++
            u.set(key, c)
        }
        console.log(`\n${id} flips vs x1 by x1 path → ${id} route (${g.join("+")})\n|path|n|hits +/-|misses +/-|\n|---|---|---|---|`)
        for (const [r, c] of [...u].sort()) console.log(`| ${r} | ${c.n} | +${c.hp}/-${c.hm} | +${c.mp}/-${c.mm} |`)
    }
}
process.exit(0)
