// Worker x: offline simulation of k3 x g5 fusion policies from stored answers (no GPU).
// node benchmarks/premise2/explore2/tools/x-sim.js
import { openAll, weightedOf } from "./a-lib.js"
const { graded, missShare, bearing } = await openAll()

const pct = (x) => (100 * x).toFixed(1)
const sets = ["S300-2", "S300-1"]
const out = {}
for (const set of sets) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const G = load("gates@1+cold"), K = load("k3@1+cold"), A = load("g5@1+cold"), N = load("n-g5@1+cold"), K1 = load("k1@1+cold")
    const rows = []
    for (const [key, g] of G) {
        const k = K.get(key), a = A.get(key), n = N.get(key)
        if (!k || !a || !n) continue
        const rec = g.record
        const ab = bearing(rec)
        const log = k.answer.log ?? []
        const checks = log.filter((l) => l.act === "check")
        const W0 = k.answer.step === "commit" ? k.answer.contextPaths : null
        const yesIdx = k.answer.step === "commit" ? checks.findIndex((c) => c.yes) : -1
        const yesPath = yesIdx >= 0 ? checks[yesIdx].path : null
        rows.push({
            key, rec, stratum: rec.stratum, g: g.correct, k: k.correct, a: a.correct, k1: K1.get(key)?.correct,
            step: k.answer.step, yesIdx, yesAB: yesPath ? ab(yesPath) : null,
            unsure: n.answer.unsure, mean: n.answer.firstMean,
            gShownGold: a.answer.goldShown, aRead: a.answer.readPaths, aAB: (a.answer.readPaths ?? []).some(ab),
            kFinalAB: (k.answer.contextPaths ?? []).some(ab),
        })
    }
    out[set] = rows
}

const evalPolicy = (rows, pick) => {
    const items = rows.map((r) => ({ record: r.rec, correct: pick(r) }))
    return weightedOf(items, missShare)
}
const policies = {
    gates: (r) => r.g,
    k3: (r) => r.k,
    g5: (r) => r.a,
    "H1 commit→k3 else g5": (r) => (r.step === "commit" ? r.k : r.a),
    "H1b commit|found→k3 else g5": (r) => (r.step === "commit" || r.step === "found" ? r.k : r.a),
    "commit&sure→k3, else g5": (r) => (r.step === "commit" && !r.unsure ? r.k : r.a),
    "commit&sure→k3, commit&unsure→g5, else k3": (r) => (r.step === "commit" && r.unsure ? r.a : r.k),
    "commit&sure|found→k3 else g5": (r) => ((r.step === "commit" && !r.unsure) || r.step === "found" ? r.k : r.a),
    "commit@1→k3, else g5": (r) => (r.step === "commit" && r.yesIdx === 0 ? r.k : r.a),
    "commit@1|found→k3 else g5": (r) => ((r.step === "commit" && r.yesIdx === 0) || r.step === "found" ? r.k : r.a),
    "sure→gates else g5 (g10)": (r) => (!r.unsure ? r.g : r.a),
    "sure→gates else k3": (r) => (!r.unsure ? r.g : r.k),
    "oracle k3|g5": (r) => Math.max(r.k, r.a),
}
for (const set of sets) {
    const rows = out[set]
    const base = evalPolicy(rows, policies.gates)
    console.log(`\n== ${set} (n=${rows.length}) ==`)
    for (const [name, pick] of Object.entries(policies)) {
        const s = evalPolicy(rows, pick)
        console.log(`${name.padEnd(46)} ${pct(s.weighted)}  Δ ${(100 * (s.weighted - base.weighted)).toFixed(1).padStart(5)}  miss ${pct(s.miss)} hit ${pct(s.hit)}`)
    }
    // cells
    const cell = (f) => { const l = rows.filter(f); return `${l.length} (gates ${l.reduce((s, r) => s + r.g, 0)}, k3 ${l.reduce((s, r) => s + r.k, 0)}, g5 ${l.reduce((s, r) => s + r.a, 0)})` }
    for (const st of ["hit", "miss"]) {
        console.log(`-- ${st}`)
        for (const step of ["commit", "found", "nofound", "nopick"]) {
            console.log(`  ${step.padEnd(8)} all ${cell((r) => r.stratum === st && r.step === step)}`)
            if (step === "commit") {
                console.log(`    yes@1 sure   ${cell((r) => r.stratum === st && r.step === step && r.yesIdx === 0 && !r.unsure)}`)
                console.log(`    yes@1 unsure ${cell((r) => r.stratum === st && r.step === step && r.yesIdx === 0 && r.unsure)}`)
                console.log(`    yes@2+ sure  ${cell((r) => r.stratum === st && r.step === step && r.yesIdx > 0 && !r.unsure)}`)
                console.log(`    yes@2+ unsure ${cell((r) => r.stratum === st && r.step === step && r.yesIdx > 0 && r.unsure)}`)
                console.log(`    yesAB=false  ${cell((r) => r.stratum === st && r.step === step && r.yesAB === false)}`)
            }
        }
    }
}
process.exit(0)
