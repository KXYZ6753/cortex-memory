// z: evaluate z variants against x1 and gates on a set: weighted, paired bootstrap CI,
// flips by x1 step, wall (measured for real variants; estimated for replays).
// node tools/z-eval.js S300-2 z-think1 [z-ext1 ...]
import { loadTable, pool, missShare } from "./n-lib.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"
const [set, ...ids] = process.argv.slice(2)
const { table, keys } = loadTable(set, ["x1", "gates", ...ids])
const W = (k) => (pool.byKey.get(k).stratum === "miss" ? missShare / 100 : (1 - missShare) / 200)
const strat = (k) => pool.byKey.get(k).stratum
function summary(id) {
    const m = table.get(id); const ks = keys.filter((k) => m.get(k)?.correct != null)
    const acc = (s) => { const l = ks.filter((k) => strat(k) === s); return 100 * l.reduce((a, k) => a + m.get(k).correct, 0) / l.length }
    const a = [...m.values()].map((x) => x.a)
    return { id, graded: ks.length, w: missShare * acc("miss") + (1 - missShare) * acc("hit"), miss: acc("miss"), hit: acc("hit"), wall: a.reduce((s, x) => s + x.wallMs, 0) / a.length, calls: a.reduce((s, x) => s + (x.calls ?? 0), 0) / a.length }
}
function delta(id, base) {
    const A = table.get(id), B = table.get(base)
    const ks = keys.filter((k) => A.get(k)?.correct != null && B.get(k)?.correct != null)
    const nm = ks.filter((k) => strat(k) === "miss").length, nh = ks.length - nm
    const d = (sample) => { let mm = 0, hh = 0, cm = 0, ch = 0; for (const k of sample) { const v = A.get(k).correct - B.get(k).correct; if (strat(k) === "miss") { mm += v; cm++ } else { hh += v; ch++ } } return 100 * (missShare * mm / cm + (1 - missShare) * hh / ch) }
    const point = d(ks)
    const boots = []
    const mk = ks.filter((k) => strat(k) === "miss"), hk = ks.filter((k) => strat(k) === "hit")
    const rnd = mulberry32(7) // was a double-precision LCG with period 10,466 (ci-erratum.md)
    for (let b = 0; b < BOOT_B; b++) { const s = []; for (let i = 0; i < mk.length; i++) s.push(mk[Math.floor(rnd() * mk.length)]); for (let i = 0; i < hk.length; i++) s.push(hk[Math.floor(rnd() * hk.length)]); boots.push(d(s)) }
    boots.sort((a, b) => a - b)
    return `${point >= 0 ? "+" : ""}${point.toFixed(2)} [${pctSorted(boots, 0.025).toFixed(1)}, ${pctSorted(boots, 0.975).toFixed(1)}]`
}
const f1 = (x) => x.toFixed(1)
for (const id of ["gates", "x1", ...ids]) {
    if (!table.get(id)) { console.log(id, "missing"); continue }
    const s = summary(id)
    console.log(`${id.padEnd(10)} n=${s.graded} w=${f1(s.w)} miss=${f1(s.miss)} hit=${f1(s.hit)} wall=${s.wall.toFixed(0)} calls=${s.calls.toFixed(2)}  vs gates ${id === "gates" ? "-" : delta(id, "gates")}  vs x1 ${id === "x1" ? "-" : delta(id, "x1")}`)
}
for (const id of ids) {
    const m = table.get(id), x1 = table.get("x1"); if (!m) continue
    const cells = {}
    let estWall = 0, upper = 0, n = 0, extraMs = 0
    for (const k of keys) {
        const z = m.get(k), x = x1.get(k); if (!z || !x) continue
        const a = z.a
        const step = a.x1Step ?? a.step ?? "?"
        const c = (cells[`${strat(k)} ${step}`] ??= { n: 0, gain: 0, loss: 0, changed: 0, fb: 0 })
        c.n++; if (a.changed) c.changed++; if (a.fallback) c.fb++
        if (z.correct != null && x.correct != null) { if (z.correct > x.correct) c.gain++; if (z.correct < x.correct) c.loss++ }
        const ms = a.thinkMs ?? a.extMs ?? a.newMs ?? 0
        extraMs += ms
        if (a.replay) { n++; upper += a.x1Wall + ms; estWall += a.x1Wall + ms - (step === "commit-g5" ? 1480 : step === "commit" ? 0 : 700 * (ms > 0)) }
    }
    console.log(`\n${id} flips vs x1 by stratum/x1 step:`)
    for (const [name, c] of Object.entries(cells).sort()) console.log(`  ${name.padEnd(18)} n=${c.n} changed=${c.changed} fallback=${c.fb} +${c.gain}/-${c.loss}`)
    if (n) console.log(`  replay wall: x1+new (upper) ${(upper / n).toFixed(0)} ms; replacing g5/final call (est) ${(estWall / n).toFixed(0)} ms; new-call ms per question ${(extraMs / n).toFixed(0)}`)
}
