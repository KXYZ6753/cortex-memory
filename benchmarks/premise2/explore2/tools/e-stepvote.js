// e: step-restricted voting on top of x1 (offline). x1 answer kept on commit-sure; on commit-unsure the
// candidates are g5's answer (x1's), gates' answer (x1.gatesAnswer) and a third system; on explore k3's answer, g5, third.
import { table, sim, W, fmt, bootDelta } from "./e-lib.js"
import { verdictOf } from "./n-lib.js"
const set = process.argv[2] ?? "S300-2"
const TH = Number(process.argv[3] ?? 0.5)
const ids = ["gates@1+cold", "x1@1+cold", "k3@1+cold", "g5@1+cold", "r5@1+cold", "n-g5@1+cold", "r4@1+cold"]
if (set !== "FULL-0") ids.push("p3@1+cold", "o4@1+cold", "h4@1+cold", "o12@1+cold")
const T = table(set, ids)
const names = [...T.keys()]
const keys = [...T.get("gates").keys()].filter((k) => names.every((n) => T.get(n).has(k)))
const get = (n, k) => T.get(n).get(k)
const rec = (k) => get("x1", k).record
const step = (k) => { const s = get("x1", k).a.step; return s === "commit" ? "sure" : s === "commit-g5" ? "unsure" : "explore" }
// gates answer inside x1 (same run) with its verdict (lookup by text; fallback stored gates verdict)
let unk = 0
const gx = (k) => { const a = get("x1", k).a; let v = verdictOf(rec(k), a.gatesAnswer); if (v == null) { unk++; v = get("gates", k).correct } return { text: a.gatesAnswer, correct: v } }
const cand = (n, k) => (n === "gx" ? gx(k) : get(n, k))
function vote(list, k, th = TH) { // list of candidate names; ties -> earlier
    const q = rec(k).question, A = list.map((n) => cand(n, k))
    let best = 0, bs = -1
    A.forEach((a, i) => { let s = 0; A.forEach((b, j) => { if (i !== j && sim(a.text, b.text, q) >= th) s++ }); if (s > bs) { bs = s; best = i } })
    return A[best].correct
}
const pol = (onUnsure, onExplore) => (k) => { const s = step(k); if (s === "unsure" && onUnsure) return onUnsure(k); if (s === "explore" && onExplore) return onExplore(k); return get("x1", k).correct }
const thirds = names.filter((n) => !["x1", "k3", "gates", "g5"].includes(n))
const pols = { x1: pol() }
pols["unsure: gx instead of g5"] = pol((k) => gx(k).correct)
for (const t of thirds) {
    pols[`unsure vote g5,gx,${t}`] = pol((k) => vote(["x1", "gx", t], k))
    pols[`unsure vote gx,g5,${t} (tie gx)`] = pol((k) => vote(["gx", "x1", t], k))
}
pols["unsure vote g5,gx,r5,p3"] = set !== "FULL-0" ? pol((k) => vote(["x1", "gx", "r5", "p3"], k)) : null
for (const t of ["gates", "g5", ...thirds]) pols[`explore vote k3,g5|gates,${t}`] = pol(null, (k) => vote(["x1", t === "g5" ? "gates" : "g5", t], k))
pols["explore: g5"] = pol(null, (k) => get("g5", k).correct)
if (set !== "FULL-0") { pols["explore: h4"] = pol(null, (k) => get("h4", k).correct); pols["explore vote x1,h4,g5"] = pol(null, (k) => vote(["x1", "h4", "g5"], k)); pols["explore vote x1,p3,g5"] = pol(null, (k) => vote(["x1", "p3", "g5"], k)) }
if (process.env.MULTI) { for (const k of Object.keys(pols)) if (k !== "x1") delete pols[k]
    const combos = set === "FULL-0" ? [["r5"], ["r4"], ["n-g5"], ["r5", "r4"]] : [["r5"], ["o4"], ["p3"], ["r4"], ["r5", "o4"], ["r5", "o4", "p3"], ["r4", "o4"], ["r5", "o4", "h4"], ["o4", "o12"]]
    for (const c of combos) for (const th of [0.3, 0.5, 0.7]) pols[`unsure vote g5,gx,${c.join(",")} th${th}`] = pol((k) => vote(["x1", "gx", ...c], k, th))
}
if (process.env.GUARD) { for (const k of Object.keys(pols)) if (k !== "x1") delete pols[k]
    const W0 = (k) => JSON.parse(get("x1", k).a.log).filter((l) => l.act === "check").map((l) => l.path)
    const g5new = (k) => { const a = get("x1", k).a; const w = new Set(gates0(k)); return !w.has(a.contextPaths[0]) }
    const gates0 = (k) => get("gates", k).a.contextPaths
    let nn = 0; for (const k of keys) if (step(k) === "unsure" && g5new(k)) nn++
    console.log("unsure with g5 ctx[0] outside gates W0:", nn, "of", keys.filter((k) => step(k) === "unsure").length)
    const thirds2 = set === "FULL-0" ? [["r5"], ["r4"], ["n-g5"]] : [["r5"], ["o4"], ["r4"], ["p3"], ["r5", "o4"], ["r5", "o4", "p3"]]
    for (const c of thirds2) {
        pols[`unsure vote g5,gx,${c.join(",")}`] = pol((k) => vote(["x1", "gx", ...c], k))
        pols[`  + guard g5 new src`] = pol((k) => (g5new(k) ? get("x1", k).correct : vote(["x1", "gx", ...c], k)))
        pols[`  + guard only hits?`] = null
    }
    for (const [name, f] of Object.entries(pols)) if (f) {
        const rows = keys.map((k) => ({ k, record: rec(k) }))
        const fl = rows.reduce((acc, r) => { const a = f(r.k), b = pols.x1(r.k); if (a !== b) acc[(r.record.stratum === "miss" ? 0 : 2) + (a > b ? 0 : 1)]++; return acc }, [0, 0, 0, 0])
        console.log(name.padEnd(30), fmt(W(rows.map((r) => ({ record: r.record, correct: f(r.k) })))), ` miss +${fl[0]}/-${fl[1]} hit +${fl[2]}/-${fl[3]}`)
    }
    process.exit(0)
}
if (process.env.SIMPLE) {
    for (const k of Object.keys(pols)) if (k !== "x1") delete pols[k]
    const rule = (ts) => (k) => { const q = rec(k).question, a = get("x1", k), g = gx(k)
        if (sim(a.text, g.text, q) >= TH) return a.correct
        let sc = 0; for (const t of ts) { const x = get(t, k).text, sg = sim(g.text, x, q) >= TH, sa = sim(a.text, x, q) >= TH; sc += (sg && !sa) - (sa && !sg) }
        return sc > 0 ? g.correct : a.correct }
    const combos = set === "FULL-0" ? [["r5"], ["r4"]] : [["r5"], ["o4"], ["r4"], ["p3"], ["r5", "o4"], ["o4", "r4"]]
    for (const c of combos) pols[`simple ${c.join(",")}`] = pol(rule(c))
}
if (process.env.OR2) {
    const u = keys.filter((k) => step(k) === "unsure")
    const c = { dis: 0, disMiss: 0, g5: [0, 0], gx: [0, 0], or: [0, 0] }
    for (const k of u) { const a = get("x1", k), g = gx(k), q = rec(k).question; if (sim(a.text, g.text, q) >= TH) continue
        const m = rec(k).stratum === "miss" ? 0 : 1; c.dis++; if (!m) c.disMiss++
        c.g5[m] += a.correct; c.gx[m] += g.correct; c.or[m] += a.correct || g.correct ? 1 : 0 }
    console.log(set, "unsure", u.length, "disagree", c.dis, "(miss", c.disMiss + ")", "right [miss,hit]: g5", c.g5, "gx", c.gx, "oracle", c.or)
    process.exit(0)
}
if (process.env.DUMP) {
    const t = process.env.DUMP
    for (const k of keys) if (step(k) === "unsure") {
        const v = vote(["x1", "gx", t], k), x = get("x1", k).correct
        if (v === x) continue
        const r = rec(k), c = (s) => (s ?? "").replace(/\s+/g, " ").slice(0, 160)
        console.log(`
[${r.stratum} ${v > x ? "GAIN" : "LOSS"}] ${r.question}
  gold: ${c(r.gold)}
  g5 (${x}): ${c(get("x1", k).text)}
  gx (${gx(k).correct}): ${c(gx(k).text)}
  ${t} (${get(t, k).correct}): ${c(get(t, k).text)}  sims g5~gx ${sim(get("x1", k).text, gx(k).text, r.question).toFixed(2)} g5~t ${sim(get("x1", k).text, get(t, k).text, r.question).toFixed(2)} gx~t ${sim(gx(k).text, get(t, k).text, r.question).toFixed(2)}`)
    }
    process.exit(0)
}
const rows = keys.map((k) => ({ k, record: rec(k) }))
console.log(`${set} theta ${TH}`)
for (const [name, f] of Object.entries(pols)) {
    if (!f) continue
    const s = W(rows.map((r) => ({ record: r.record, correct: f(r.k) })))
    const d = bootDelta(rows, (r) => f(r.k), (r) => pols.x1(r.k), 1000)
    const fl = rows.reduce((acc, r) => { const a = f(r.k), b = pols.x1(r.k); if (a !== b) acc[(r.record.stratum === "miss" ? 0 : 2) + (a > b ? 0 : 1)]++; return acc }, [0, 0, 0, 0])
    console.log(name.padEnd(38), fmt(s).padEnd(28), `Δx1 ${d.d.toFixed(2).padStart(5)} [${d.lo.toFixed(1)}, ${d.hi.toFixed(1)}]  miss +${fl[0]}/-${fl[1]} hit +${fl[2]}/-${fl[3]}`)
}
console.log("unknown gx verdicts (fell back to stored gates):", unk)
