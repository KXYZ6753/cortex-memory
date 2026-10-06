// e: exact evaluation of selection rules from one e1 GPU run (+ e1o replay for the other candidate's verdict).
//   node benchmarks/premise2/explore2/tools/e-eval.js S300-2
import { table, sim, W, fmt, bootDelta } from "./e-lib.js"
import { verdictOf } from "./n-lib.js"
const set = process.argv[2] ?? "S300-2"
const T = table(set, ["e1@1+cold", "e1o@1+cold", "x1@1+cold", "gates@1+cold", "k3@1+cold"])
const E = T.get("e1"), O = T.get("e1o"), X = T.get("x1"), G = T.get("gates")
const keys = [...E.keys()].filter((k) => O.has(k) && X.has(k) && G.has(k))
const rec = (k) => E.get(k).record
// verdict of a text: e1 or e1o if same text, else verdict index lookup
const v = (k, text) => { if (text === E.get(k).text) return E.get(k).correct; if (text === O.get(k).text) return O.get(k).correct; return verdictOf(rec(k), text) }
let missing = 0
const pick = (k, which) => { // which: "g5" | "gates"
    const a = E.get(k).a
    const t = which === "gates" ? a.gatesAnswer : a.g5Answer
    const c = v(k, t); if (c == null) { missing++; return 0 } return c
}
const isDis = (k) => E.get(k).a.eStep === "disagree"
const pol = (f) => (k) => (isDis(k) ? f(k) : E.get(k).correct)
const q = (k) => rec(k).question
const third = (name) => (k) => { const a = E.get(k).a, t = name === "o4" ? a.o4Answer : (a.r5Answer ?? a.gatesAnswer)
    return sim(a.gatesAnswer, t, q(k)) >= 0.5 && sim(a.g5Answer, t, q(k)) < 0.5 ? "gates" : "g5" }
const choose = (thr = 0) => (k) => (E.get(k).a.choose.g5Score > thr ? "g5" : E.get(k).a.choose.g5Score < -thr ? "gates" : null)
const pols = {
    "e1 (o4 third)": (k) => E.get(k).correct,
    "internal x1 (g5 always)": pol((k) => pick(k, "g5")),
    "gates always on disagreement": pol((k) => pick(k, "gates")),
    "r5 third": pol((k) => pick(k, third("r5")(k))),
    "o4 & r5 both side with gates": pol((k) => pick(k, third("o4")(k) === "gates" && third("r5")(k) === "gates" ? "gates" : "g5")),
    "o4 or r5 sides with gates": pol((k) => pick(k, third("o4")(k) === "gates" || third("r5")(k) === "gates" ? "gates" : "g5")),
    "e2b choose (both orders)": pol((k) => pick(k, choose()(k) ?? "g5")),
    "e2b choose, order 1 only": pol((k) => { const c = E.get(k).a.choose.o1; return pick(k, (c.A ?? -20) >= (c.B ?? -20) ? "g5" : "gates") }),
    "e2b choose, order 2 only": pol((k) => { const c = E.get(k).a.choose.o2; return pick(k, (c.A ?? -20) >= (c.B ?? -20) ? "gates" : "g5") }),
    "choose margin>2 else g5": pol((k) => pick(k, choose(2)(k) ?? "g5")),
    "choose + o4 agree (both gates)": pol((k) => pick(k, choose()(k) === "gates" && third("o4")(k) === "gates" ? "gates" : "g5")),
    "oracle(g5, gates)": pol((k) => Math.max(pick(k, "g5"), pick(k, "gates"))),
}
const rows = keys.map((k) => ({ k, record: rec(k) }))
const base = pols["internal x1 (g5 always)"]
console.log(`${set}: n=${keys.length}; disagreement questions ${keys.filter(isDis).length} (miss ${keys.filter((k) => isDis(k) && rec(k).stratum === "miss").length})`)
for (const [name, f] of Object.entries(pols)) {
    const s = W(rows.map((r) => ({ record: r.record, correct: f(r.k) })))
    const d = bootDelta(rows, (r) => f(r.k), (r) => base(r.k), 1000)
    const fl = rows.reduce((acc, r) => { const a = f(r.k), b = base(r.k); if (a !== b) acc[(r.record.stratum === "miss" ? 0 : 2) + (a > b ? 0 : 1)]++; return acc }, [0, 0, 0, 0])
    console.log(name.padEnd(34), fmt(s).padEnd(28), `Δ internal-x1 ${d.d.toFixed(2).padStart(5)} [${d.lo.toFixed(1)}, ${d.hi.toFixed(1)}]  miss +${fl[0]}/-${fl[1]} hit +${fl[2]}/-${fl[3]}`)
}
console.log("missing verdicts:", missing)
// vs stored runs
for (const [name, M] of [["stored x1", X], ["gates", G], ["k3", T.get("k3")]]) {
    const d = bootDelta(rows, (r) => E.get(r.k).correct, (r) => M.get(r.k).correct, 2000)
    console.log(`e1 vs ${name}: ${d.d.toFixed(2)} [${d.lo.toFixed(1)}, ${d.hi.toFixed(1)}]  (${name} ${fmt(W(rows.map((r) => ({ record: r.record, correct: M.get(r.k).correct }))))})`)
}
// reproduction of x1 inside e1
const same = keys.filter((k) => E.get(k).a.step === X.get(k).a.step).length
const txt = keys.filter((k) => E.get(k).a.eStep !== "disagree" || E.get(k).a.pick === "g5").filter((k) => E.get(k).text === X.get(k).text).length
const internalVsStored = bootDelta(rows, (r) => base(r.k), (r) => X.get(r.k).correct, 2000)
console.log(`x1 step reproduced ${same}/${keys.length}; final text = stored x1 on ${txt} of non-gates-picked; internal x1 vs stored x1 ${internalVsStored.d.toFixed(2)} [${internalVsStored.lo.toFixed(1)}, ${internalVsStored.hi.toFixed(1)}]`)
const mean = (f) => keys.reduce((s, k) => s + f(E.get(k).a), 0) / keys.length
console.log(`e1 wall ${mean((a) => a.wallMs).toFixed(0)} ms, calls ${mean((a) => a.calls).toFixed(2)}; stored x1 wall ${(keys.reduce((s, k) => s + X.get(k).a.wallMs, 0) / keys.length).toFixed(0)}`)
const steps = {}; for (const k of keys) { const s = E.get(k).a.eStep + (E.get(k).a.pick ? ":" + E.get(k).a.pick : ""); steps[s] = (steps[s] ?? 0) + 1 }
console.log(steps)
