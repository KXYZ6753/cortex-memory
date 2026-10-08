// v6 (aux): deployable selection policies on pool A (parent = gates; alternatives = same-context
// prompt variants), exact on stored candidates: questions whose candidates all share one verdict
// cannot change, so only mixed questions need encoder reads.
//   node v6-sim.js <alts: t2 | all | v1,v2,...> [gate: none | unsure] [score ef] [conf-only]
// Policy: answer = gates unless (gate allows) and max_alt score(alt) - score(gates) > m.
// Reports a margin grid (in-sample) and a leave-one-set-out estimate (m chosen on the other sets by
// hit Δ, applied to the held-out set), with question- and mailbox-cluster bootstrap intervals.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OUT, bootDelta, fmt } from "./v6-lib.js"
import { features } from "./v6-feat.js"

const [altArg = "t2", gate = "none", score = "ef", confOnly] = process.argv.slice(2)
const TAU = -0.1
const MS = score === "max" ? [0, 0.5, 1, 2, 3, 4] : [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5]
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const altList = altArg === "t2" || altArg === "all" ? null : altArg.split(",")
const rows = []
for (const q of pools.A) {
    if (confOnly && q.conf === null) continue
    const par = q.cands.find((c) => c.text === q.parent)
    let alts
    if (altArg === "t2") alts = q.t2 !== null && q.t2 !== q.parent ? q.cands.filter((c) => c.text === q.t2) : []
    else if (altArg === "all") alts = q.cands.filter((c) => c.text !== q.parent)
    else alts = q.cands.filter((c) => c.text !== q.parent && c.sources.some((s) => altList.includes(s)))
    if (altArg === "t2" && q.t2 === null) continue
    if (altList && !q.cands.some((c) => c.sources.some((s) => altList.includes(s)))) continue // alternative not stored here
    const open = gate === "none" || (q.conf !== null && q.conf < TAU)
    let f = null
    if (open && alts.length && alts.some((a) => a.correct !== par.correct)) {
        const ff = features(q, q.evidence, [par.text, ...alts.map((a) => a.text)])
        if (ff) f = ff
    }
    rows.push({ set: q.set, stratum: q.stratum, user: q.user, parC: par.correct, alts, f, open })
}
const run = (rs, m) => {
    const items = []
    const fl = { hit: [0, 0], miss: [0, 0] }
    for (const r of rs) {
        let d = 0
        if (r.f) {
            let bi = -1, bv = -Infinity
            r.alts.forEach((a, i) => { if (r.f[i + 1][score] > bv) { bv = r.f[i + 1][score]; bi = i } })
            if (bv - r.f[0][score] > m) {
                d = r.alts[bi].correct - r.parC
                if (d > 0) fl[r.stratum][0]++
                if (d < 0) fl[r.stratum][1]++
            }
        }
        items.push({ stratum: r.stratum, user: r.user, set: r.set, d })
    }
    return { items, fl }
}
const hits = rows.filter((r) => r.stratum === "hit")
const oracleHit = hits.filter((r) => !r.parC && r.alts.some((a) => a.correct) && r.open).length
console.log(`pool A, alternatives ${altArg}, gate ${gate}${confOnly ? " (conf known only)" : ""}, score ${score}: questions ${rows.length}, hits ${hits.length}; oracle (gated) +${oracleHit} hits = +${(100 * oracleHit / hits.length).toFixed(2)} hit points; sets ${[...new Set(rows.map((r) => r.set))].join(",")}`)
for (const m of MS) {
    const { items, fl } = run(rows, m)
    const h = items.filter((i) => i.stratum === "hit")
    console.log(`  m ${String(m).padEnd(4)} hits ${fmt(bootDelta(h, 0.068, { hitOnly: true }))} mailbox-cluster ${fmt(bootDelta(h, 0.068, { hitOnly: true, cluster: true }))} | weighted ${fmt(bootDelta(items, 0.068))} | hit +${fl.hit[0]}/-${fl.hit[1]} miss +${fl.miss[0]}/-${fl.miss[1]}`)
}
// leave-one-set-out margin choice
const sets = [...new Set(rows.map((r) => r.set))]
const loso = []
const flips = { hit: [0, 0], miss: [0, 0] }
const chosen = []
for (const s of sets) {
    const train = rows.filter((r) => r.set !== s), test = rows.filter((r) => r.set === s)
    let bm = MS[0], bv = -Infinity
    for (const m of MS) {
        const v = run(train, m).items.filter((i) => i.stratum === "hit").reduce((a, i) => a + i.d, 0)
        if (v > bv) { bv = v; bm = m }
    }
    chosen.push(`${s}:${bm}`)
    const r = run(test, bm)
    loso.push(...r.items)
    for (const st of ["hit", "miss"]) { flips[st][0] += r.fl[st][0]; flips[st][1] += r.fl[st][1] }
}
const h = loso.filter((i) => i.stratum === "hit")
console.log(`  leave-one-set-out (m: ${chosen.join(" ")}): hits ${fmt(bootDelta(h, 0.068, { hitOnly: true }))} mailbox-cluster ${fmt(bootDelta(h, 0.068, { hitOnly: true, cluster: true }))} | weighted ${fmt(bootDelta(loso, 0.068))} | hit +${flips.hit[0]}/-${flips.hit[1]} miss +${flips.miss[0]}/-${flips.miss[1]}`)
