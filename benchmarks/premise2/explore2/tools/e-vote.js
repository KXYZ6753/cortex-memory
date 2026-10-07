// e: offline voting / agreement-escalation policies over stored answers.
// node benchmarks/premise2/explore2/tools/e-vote.js S300-2 [theta]
import { table, sim, W, fmt, bootDelta } from "./e-lib.js"
const set = process.argv[2] ?? "S300-2"
const TH = Number(process.argv[3] ?? 0.5)
const IDS = ["gates@1+cold", "x1@1+cold", "k3@1+cold", "g5@1+cold", "n-g5@1+cold", "r5@1+cold", "r4@1+cold"]
const MORE = set === "FULL-0" ? [] : ["p3@1+cold", "h4@1+cold", "o4@1+cold", "o12@1+cold", "k1@1+cold", "g2@2+cold", "x2@1+cold"]
const T = table(set, [...IDS, ...MORE])
const names = [...T.keys()]
const keys = [...T.get("gates").keys()].filter((k) => names.every((n) => T.get(n).has(k)))
const rec = (k) => T.get("gates").get(k).record
const get = (n, k) => T.get(n).get(k)
console.log(`${set}: n=${keys.length}, theta=${TH}`)

// plurality vote over group; tie-break by priority order (first in `group` wins ties)
function vote(group, k, { soft = false, th = TH } = {}) {
    const q = rec(k).question
    const ans = group.map((n) => get(n, k))
    let best = -1, bestS = -1
    for (let i = 0; i < ans.length; i++) {
        let s = 0
        for (let j = 0; j < ans.length; j++) if (j !== i) { const x = sim(ans[i].text, ans[j].text, q); s += soft ? x : x >= th ? 1 : 0 }
        if (s > bestS + 1e-9) { bestS = s; best = i }
    }
    return ans[best].correct
}
// keep A if A~B, else C
const escalate = (A, B, C) => (k) => (sim(get(A, k).text, get(B, k).text, rec(k).question) >= TH ? get(A, k).correct : get(C, k).correct)
// keep A unless two others agree with each other and both disagree with A
const override = (A, B, C) => (k) => {
    const q = rec(k).question, a = get(A, k), b = get(B, k), c = get(C, k)
    if (sim(b.text, c.text, q) >= TH && sim(a.text, b.text, q) < TH && sim(a.text, c.text, q) < TH) return b.correct
    return a.correct
}
const rows = keys.map((k) => ({ k, record: rec(k) }))
const pols = {
    x1: (k) => get("x1", k).correct,
    gates: (k) => get("gates", k).correct,
    "vote x1,k3,g5": (k) => vote(["x1", "k3", "g5"], k),
    "vote x1,gates,g5": (k) => vote(["x1", "gates", "g5"], k),
    "vote x1,g5,r5": (k) => vote(["x1", "g5", "r5"], k),
    "vote x1,gates,k3,g5,r5": (k) => vote(["x1", "gates", "k3", "g5", "r5"], k),
    "vote x1,g5,r5,n-g5,k3,gates,r4": (k) => vote(["x1", "g5", "r5", "n-g5", "k3", "gates", "r4"], k),
    "softvote x1,gates,k3,g5,r5": (k) => vote(["x1", "gates", "k3", "g5", "r5"], k, { soft: true }),
    "vote gates,k3,g5 (no x1)": (k) => vote(["k3", "gates", "g5"], k),
    "vote k3,g5,r5": (k) => vote(["k3", "g5", "r5"], k),
    "esc gates~k3 keep gates else g5": escalate("gates", "k3", "g5"),
    "esc k3~gates keep k3 else g5": escalate("k3", "gates", "g5"),
    "esc k3~g5 keep k3 else x1": escalate("k3", "g5", "x1"),
    "esc gates~g5 keep gates else k3": escalate("gates", "g5", "k3"),
    "esc gates~g5 keep gates else x1": escalate("gates", "g5", "x1"),
    "esc r5~k3 keep k3 else g5": escalate("k3", "r5", "g5"),
    "override x1 by g5=r5": override("x1", "g5", "r5"),
    "override x1 by g5=gates": override("x1", "g5", "gates"),
    "override x1 by k3=g5": override("x1", "k3", "g5"),
    "override x1 by gates=r5": override("x1", "gates", "r5"),
}
if (MORE.length) Object.assign(pols, {
    "vote x1,p3,g5": (k) => vote(["x1", "p3", "g5"], k),
    "vote x1,h4,g5": (k) => vote(["x1", "h4", "g5"], k),
    "vote x1,o4,g5": (k) => vote(["x1", "o4", "g5"], k),
    "vote x1,g5,h4,p3,o4": (k) => vote(["x1", "g5", "h4", "p3", "o4"], k),
    "vote all": (k) => vote(["x1", ...names.filter((n) => n !== "x1")], k),
    "override x1 by g5=p3": override("x1", "g5", "p3"),
    "override x1 by g5=o4": override("x1", "g5", "o4"),
    "override x1 by h4=g5": override("x1", "h4", "g5"),
    "esc p3~k3 keep k3 else g5": escalate("k3", "p3", "g5"),
})
const base = pols.x1, g = pols.gates
for (const [name, f] of Object.entries(pols)) {
    const s = W(rows.map((r) => ({ record: r.record, correct: f(r.k) })))
    const dx = bootDelta(rows, (r) => f(r.k), (r) => base(r.k)), dg = bootDelta(rows, (r) => f(r.k), (r) => g(r.k))
    console.log(name.padEnd(36), fmt(s).padEnd(28), `Δx1 ${dx.d.toFixed(1).padStart(5)} [${dx.lo.toFixed(1)}, ${dx.hi.toFixed(1)}]  Δgates ${dg.d.toFixed(1).padStart(5)}`)
}
