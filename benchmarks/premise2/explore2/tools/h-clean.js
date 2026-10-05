// Offline: "clean" estimate of an h variant = the reference's stored verdict wherever the
// h variant's answer came from the reference's own prompt (step != replaced), the h verdict
// where the escalation replaced it. Separates the escalation from engine nondeterminism.
//   node benchmarks/premise2/explore2/tools/h-clean.js S300-2 h4@1+cold r4@1+cold
import { openH } from "./h-common.js"
const [set, v, ref] = process.argv.slice(2)
const env = await openH()
const R = new Map(env.graded(ref, set).map((i) => [i.record.questionKey, i]))
const G = new Map(env.graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
const rows = []
for (const i of env.graded(v, set)) {
    const r = R.get(i.record.questionKey), g = G.get(i.record.questionKey)
    if (!r || !g || i.correct === null || r.correct === null) continue
    const replaced = i.answer.step === "replaced"
    rows.push({ record: i.record, raw: i.correct, clean: replaced ? i.correct : r.correct, ref: r.correct, gates: g.correct, replaced })
}
const w = (f) => env.weightedOf(rows, env.missShare, f)
const fmt = (x) => `${(100 * x.weighted).toFixed(2)} (miss ${(100 * x.miss).toFixed(0)}, hit ${(100 * x.hit).toFixed(1)})`
console.log(`${set} ${v} n ${rows.length}: raw ${fmt(w((r) => r.raw))}; clean ${fmt(w((r) => r.clean))}; ${ref} ${fmt(w((r) => r.ref))}; gates ${fmt(w((r) => r.gates))}`)
// paired bootstrap CI of clean − gates
const ms = env.missShare
const miss = rows.filter((r) => r.record.stratum === "miss"), hit = rows.filter((r) => r.record.stratum === "hit")
const d = (L) => L.map((r) => r.clean - r.gates)
const dm = d(miss), dh = d(hit)
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const boot = []
for (let b = 0; b < 4000; b++) {
    const s = (a) => { let t = 0; for (let k = 0; k < a.length; k++) t += a[Math.floor(rnd() * a.length)]; return t / a.length }
    boot.push(100 * (ms * s(dm) + (1 - ms) * s(dh)))
}
boot.sort((a, b) => a - b)
const mean = 100 * (ms * dm.reduce((a, b) => a + b, 0) / dm.length + (1 - ms) * dh.reduce((a, b) => a + b, 0) / dh.length)
console.log(`clean − gates ${mean.toFixed(2)} [${boot[100].toFixed(2)}, ${boot[3899].toFixed(2)}]`)
const fl = (L, a, b) => `${L.filter((r) => r[a] && !r[b]).length}/${L.filter((r) => !r[a] && r[b]).length}`
console.log(`replaced: miss ${miss.filter((r) => r.replaced).length} (vs ${ref} +/- ${fl(miss.filter((r) => r.replaced), "raw", "ref")}), hit ${hit.filter((r) => r.replaced).length} (+/- ${fl(hit.filter((r) => r.replaced), "raw", "ref")}); unreplaced raw vs ${ref} (same prompt): miss ${fl(miss.filter((r) => !r.replaced), "raw", "ref")}, hit ${fl(hit.filter((r) => !r.replaced), "raw", "ref")}`)
