// Offline composition (no GPU): base variant unless a trigger fires on the base answer's
// features, then a probe-based variant's stored answer (w7 = YES/NO probes over gates'
// 10 + header mailbox 15, YES first). Uses w7's stored YES/NO lists for the source email.
//   node benchmarks/premise2/explore2/tools/h-sim.js S300-2 s1@1+cold w7@1+cold
import { openH } from "./h-common.js"

const [set = "S300-2", baseV = "s1@1+cold", altV = "w7@1+cold"] = process.argv.slice(2)
const env = await openH()
const base = new Map(env.graded(baseV, set).map((i) => [i.record.questionKey, i]))
const alt = new Map(env.graded(altV, set).map((i) => [i.record.questionKey, i]))
const gates = new Map(env.graded("gates@1+cold", set).map((i) => [i.record.questionKey, i]))
const rows = []
for (const [key, b] of base) {
    const a = alt.get(key)
    if (!a || b.correct === null || a.correct === null) continue
    const f = env.featuresOf(b)
    if (!f) continue
    const yes = new Set(a.answer.yes ?? [])
    const probed = new Set(a.answer.candidates ?? [])
    // source path again (featuresOf only exposes index); recompute from final context
    const used = b.answer.used ?? 1
    const final = used > 1 ? (b.answer.readPaths ?? []).slice((b.answer.contextPaths ?? []).length) : b.answer.contextPaths ?? []
    const srcPath = f.srcIdx >= 0 ? final[f.srcIdx] : null
    const srcProbe = srcPath && probed.has(srcPath) ? (yes.has(srcPath) ? "Y" : "N") : "?"
    const unseenYes = [...yes].filter((p) => !final.includes(p)).length
    rows.push({ ...f, alt: a.correct, base: b.correct, gates: gates.get(key)?.correct ?? null, srcProbe, unseenYes, altFirstChanged: (a.answer.contextPaths?.[0] ?? "") !== (final[0] ?? "") })
}
const triggers = {
    never: () => false,
    always: () => true,
    "covGap>=.15": (r) => r.covUnseenMax - r.covSrc >= 0.15,
    "gap>1&covGap>0": (r) => r.ceUnseenMax - r.ceSrc > 1 && r.covUnseenMax - r.covSrc > 0,
    "T1=covGap.15|gap1&covGap0": (r) => r.covUnseenMax - r.covSrc >= 0.15 || (r.ceUnseenMax - r.ceSrc > 1 && r.covUnseenMax - r.covSrc > 0),
    "gap>0": (r) => r.ceUnseenMax - r.ceSrc > 0,
    "gap>1": (r) => r.ceUnseenMax - r.ceSrc > 1,
    "ceSrc<0&cov<.5": (r) => r.ceSrc < 0 && r.covSrc < 0.5,
    "srcIdx>0&ceSrc<0": (r) => r.srcIdx > 0 && r.ceSrc < 0,
}
const guards = {
    none: () => true,
    "srcNotYes": (r) => r.srcProbe !== "Y",
    "srcNotYes&unseenYes": (r) => r.srcProbe !== "Y" && r.unseenYes > 0,
}
const ms = env.missShare
const table = {}
for (const [tn, t] of Object.entries(triggers)) for (const [gn, g] of Object.entries(guards)) {
    if (tn === "never" && gn !== "none") continue
    const val = (r) => (t(r) && g(r) ? r.alt : r.base)
    const miss = rows.filter((r) => r.stratum === "miss"), hit = rows.filter((r) => r.stratum === "hit")
    const mean = (L, fn) => L.reduce((s, r) => s + fn(r), 0) / L.length
    const fired = rows.filter((r) => t(r) && g(r))
    const flips = (L) => `${L.filter((r) => t(r) && g(r) && r.alt && !r.base).length}/${L.filter((r) => t(r) && g(r) && !r.alt && r.base).length}`
    table[`${tn} | ${gn}`] = {
        weighted: +(100 * (ms * mean(miss, val) + (1 - ms) * mean(hit, val))).toFixed(2), miss: +(100 * mean(miss, val)).toFixed(1), hit: +(100 * mean(hit, val)).toFixed(1),
        fireMiss: fired.filter((r) => r.stratum === "miss").length, fireHit: fired.filter((r) => r.stratum === "hit").length, "miss +/-": flips(miss), "hit +/-": flips(hit),
    }
}
console.log(`${set}: base ${baseV}, alt ${altV}, n ${rows.length}; gates weighted ${(100 * (ms * rows.filter((r) => r.stratum === "miss").reduce((s, r) => s + r.gates, 0) / rows.filter((r) => r.stratum === "miss").length + (1 - ms) * rows.filter((r) => r.stratum === "hit").reduce((s, r) => s + r.gates, 0) / rows.filter((r) => r.stratum === "hit").length)).toFixed(2)}`)
console.table(table)
const src = {}
for (const r of rows) { const k = `${r.stratum} ${r.srcAB ? "srcAB" : "srcNonAB"} probe=${r.srcProbe}`; src[k] = (src[k] ?? 0) + 1 }
console.log(src)
// fire rates of the probe detector by stratum x base correctness
const fr = {}
for (const r of rows) {
    const k = `${r.stratum} ${r.base ? "correct" : "wrong"}`
    fr[k] ??= { n: 0, srcNo: 0, srcNoAndUnseenYes: 0 }
    fr[k].n++
    if (r.srcProbe !== "Y") fr[k].srcNo++
    if (r.srcProbe !== "Y" && r.unseenYes > 0) fr[k].srcNoAndUnseenYes++
}
console.table(fr)
