// Worker m: simulate recovery rules on x1's commits (and extra explore probes) from the
// m-diag probe logs (YES/NO + logprobs on all of W0 and the recovery lists, extract answers,
// pairwise probes). Answer correctness of a changed context is not simulated exactly:
// we count, per rule, how many prompts change and how (AB recovered on an x1-wrong miss =
// candidate gain; any change on an x1-right question = risk), plus an expected Δ with
// P(correct | AB recovered into slot 5) = PREAD.
//   node benchmarks/premise2/explore2/tools/m-sim.js S300-1 [S300-2]
import { openAll } from "./a-lib.js"
import { diagRows } from "./m-lib.js"
const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["S300-1"]
const PREAD = Number(process.env.M_PREAD ?? 0.7) // reading prior for a miss whose AB enters the context (x1 found: 45/73 first; p prior slot 5: 0.82)
const { graded, bearing } = await openAll()

const rules = []
const triggers = {
    unsure: (q) => q.unsure,
    "unsure|lp<-0.1": (q) => q.unsure || q.yesLp1 < -0.1,
    "unsure|lp<-0.2": (q) => q.unsure || q.yesLp1 < -0.2,
    "lp<-0.1": (q) => q.yesLp1 < -0.1,
    "lp<-0.2": (q) => q.yesLp1 < -0.2,
    "unsure&lp<-0.05": (q) => q.unsure && q.yesLp1 < -0.05,
    all: () => true,
}
const accepts = {
    yes: () => true,
    "lp>=lp1": (e, q) => (e.yesLp ?? -9) >= q.yesLp1,
    "lp>=lp1+.1": (e, q) => (e.yesLp ?? -9) >= q.yesLp1 + 0.1,
    "lp>=-0.05": (e) => (e.yesLp ?? -9) >= -0.05,
    "lp>=max(lp1,-0.1)": (e, q) => (e.yesLp ?? -9) >= Math.max(q.yesLp1, -0.1),
    "pair2/2": (e, q) => q.pairPrefers(e.path) === 2,
    "pair>=1": (e, q) => q.pairPrefers(e.path) >= 1,
    "extractE": (e, q) => q.extractOk(e.path) === true,
    "extractE&!extract1": (e, q) => q.extractOk(e.path) === true && q.extractOk(q.yes1) === false,
}
for (const [tn] of Object.entries(triggers)) for (const list of ["snip50", "snip50m", "rrf3"]) for (const N of [3, 5, 8]) for (const [an] of Object.entries(accepts)) rules.push({ tn, list, N, an })

for (const set of sets) {
    const D = diagRows(set)
    const X = graded("x1@1+cold", set)
    const G = new Map(graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
    const qs = []
    let missingDiag = 0, w0mismatch = 0
    for (const it of X) {
        const d = D.get(it.record.questionKey)
        if (!d) { missingDiag++; continue }
        const a = it.answer, rec = it.record, ab = bearing(rec)
        if (!a.step?.startsWith("commit")) { qs.push({ it, d, committed: false }); continue }
        const checks = (a.log ?? []).filter((l) => l.act === "check")
        const yes1e = checks.find((c) => c.yes)
        const dw0 = (d.answer.log ?? []).filter((l) => l.act === "w0")
        if (dw0.findIndex((l) => l.yes) !== checks.indexOf(yes1e)) w0mismatch++
        const probe = new Map((d.answer.log ?? []).filter((l) => l.act === "rec").map((l) => [l.path, l]))
        const ex = new Map((d.answer.extracts ?? []).map((e) => [e.path, e]))
        const pair = d.answer.pair
        qs.push({
            it, d, committed: true, stratum: rec.stratum, x1ok: it.correct, gatesOk: G.get(rec.questionKey)?.correct,
            unsure: a.step === "commit-g5", yesLp1: yes1e.yesLp ?? -9, yes1: yes1e.path, yes1AB: ab(yes1e.path), ab,
            probe, own: (p) => p.startsWith(`${rec.user}/`),
            lists: { snip50: d.answer.snip50 ?? [], snip50m: (d.answer.snip50 ?? []).filter((p) => p.startsWith(`${rec.user}/`)), rrf3: d.answer.rrf3 ?? [] },
            extractOk: (p) => (ex.has(p) ? !ex.get(p).abstain : null),
            pairPrefers: (p) => (!pair || pair.b !== p ? -1 : (pair.ab.pick === 2 ? 1 : 0) + (pair.ba.pick === 1 ? 1 : 0)),
        })
    }
    const committed = qs.filter((q) => q.committed)
    console.log(`\n== ${set}: x1 ${X.length}, diag joined ${qs.length} (missing ${missingDiag}), committed ${committed.length}, W0 first-YES mismatch x1 vs diag ${w0mismatch}`)
    const results = []
    for (const r of rules) {
        let gain = 0, missChangedOk = 0, missChangedOther = 0, hitChanged = 0, hitChangedSure = 0, fired = 0, probes = 0, unknown = 0
        for (const q of committed) {
            if (!triggers[r.tn](q)) continue
            fired++
            let E = null
            for (const p of q.lists[r.list].slice(0, r.N)) {
                const e = q.probe.get(p)
                probes++
                if (!e) { unknown++; continue }
                if (e.yes && accepts[r.an](e, q)) { E = p; break }
            }
            if (!E) continue
            if (q.stratum === "hit") { hitChanged++; if (!q.unsure) hitChangedSure++ }
            else if (!q.x1ok && q.ab(E)) gain++
            else if (q.x1ok) missChangedOk++
            else missChangedOther++
        }
        const dMiss = gain * PREAD - missChangedOk * (1 - PREAD) * 0.5
        results.push({ ...r, fired, probes, unknown, gain, missChangedOk, missChangedOther, hitChanged, hitChangedSure, dMiss })
    }
    results.sort((a, b) => b.dMiss - a.dMiss)
    console.log("trigger            list     N accept               fired probes unk | missGain missOkChg missOther | hitChg (sure) | E[Δmiss]")
    for (const r of results.slice(0, Number(process.env.M_TOP ?? 45))) console.log(`${r.tn.padEnd(18)} ${r.list.padEnd(8)} ${String(r.N).padStart(1)} ${r.an.padEnd(20)} ${String(r.fired).padStart(5)} ${String(r.probes).padStart(6)} ${String(r.unknown).padStart(3)} | ${String(r.gain).padStart(8)} ${String(r.missChangedOk).padStart(9)} ${String(r.missChangedOther).padStart(9)} | ${String(r.hitChanged).padStart(6)} (${String(r.hitChangedSure).padStart(3)}) | ${r.dMiss.toFixed(1)}`)
    // explore extra probes: explored questions (no YES in W0) where x1 found nothing
    const ex = qs.filter((q) => !q.committed)
    for (const list of ["snip50", "snip50m"]) for (const k of [2, 3, 5]) {
        let fm = 0, fmAB = 0, fmGain = 0, fh = 0, n = 0
        for (const q of ex) {
            const a = q.it.answer, rec = q.it.record, ab = bearing(rec)
            if (a.step === "found") continue
            n++
            const seen = new Set([...(a.log ?? []).filter((l) => l.act === "check").map((l) => l.path)])
            const probe = new Map((q.d.answer.log ?? []).filter((l) => l.act === "rec").map((l) => [l.path, l]))
            const L = (list === "snip50m" ? (q.d.answer.snip50 ?? []).filter((p) => p.startsWith(`${rec.user}/`)) : q.d.answer.snip50 ?? []).filter((p) => !seen.has(p)).slice(0, k)
            const E = L.find((p) => probe.get(p)?.yes)
            if (!E) continue
            if (rec.stratum === "hit") fh++
            else { fm++; if (ab(E)) { fmAB++; if (!q.it.correct) fmGain++ } }
        }
        console.log(`explore extra probes ${list} k=${k}: unresolved explores ${n}; new YES on misses ${fm} (AB ${fmAB}, AB & x1 wrong ${fmGain}); on hits ${fh}`)
    }
}
process.exit(0)
