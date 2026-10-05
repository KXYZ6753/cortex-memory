// Offline trigger calibration (no GPU): failure-detector features of stored answers,
// fire rates of candidate triggers on correct hits / wrong misses.
//   node benchmarks/premise2/explore2/tools/h-calib.js gates@1+cold:FULL-0 gates@1+cold:S300-1 r5@1+cold:S300-1
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { openH, SCRATCH } from "./h-common.js"

const specs = process.argv.slice(2)
const env = await openH()
const rows = []
for (const spec of specs) {
    const [v, set] = spec.split(":")
    for (const item of env.graded(v, set)) {
        if (item.correct === null) continue
        const f = env.featuresOf(item)
        if (f) rows.push({ spec, ...f })
    }
}
writeFileSync(join(SCRATCH, "h", "calib.json"), JSON.stringify(rows))
console.log(`rows ${rows.length}`)

const triggers = {
    "gap>0": (r) => r.ceUnseenMax - r.ceSrc > 0,
    "gap>1": (r) => r.ceUnseenMax - r.ceSrc > 1,
    "gap>2": (r) => r.ceUnseenMax - r.ceSrc > 2,
    "gap>3": (r) => r.ceUnseenMax - r.ceSrc > 3,
    "gapF>2": (r) => r.ceUnseenMax - r.ceFinalMax > 2,
    "ceSrc<0": (r) => r.ceSrc < 0,
    "ceSrc<-2": (r) => r.ceSrc < -2,
    "covSrc<.5": (r) => r.covSrc < 0.5,
    "covSrc<.4": (r) => r.covSrc < 0.4,
    "covGap>.15": (r) => r.covUnseenMax - r.covSrc >= 0.15,
    "covGap>.25": (r) => r.covUnseenMax - r.covSrc >= 0.25,
    "ceSrc<0&gap>1": (r) => r.ceSrc < 0 && r.ceUnseenMax - r.ceSrc > 1,
    "ceSrc<1&gap>2": (r) => r.ceSrc < 1 && r.ceUnseenMax - r.ceSrc > 2,
    "ceSrc<0&cov<.5": (r) => r.ceSrc < 0 && r.covSrc < 0.5,
    "gap>1&covGap>0": (r) => r.ceUnseenMax - r.ceSrc > 1 && r.covUnseenMax - r.covSrc > 0,
    "srcIdx>0": (r) => r.srcIdx > 0,
    "srcIdx>0&ceSrc<0": (r) => r.srcIdx > 0 && r.ceSrc < 0,
    "ceSrc<0|gap>3": (r) => r.ceSrc < 0 || r.ceUnseenMax - r.ceSrc > 3,
    "abstain": (r) => r.abstain === 1,
}
const by = (spec) => rows.filter((r) => !spec || r.spec === spec)
for (const spec of [null, ...specs]) {
    const R = by(spec)
    const okHit = R.filter((r) => r.stratum === "hit" && r.correct)
    const badHit = R.filter((r) => r.stratum === "hit" && !r.correct)
    const okMiss = R.filter((r) => r.stratum === "miss" && r.correct)
    const badMiss = R.filter((r) => r.stratum === "miss" && !r.correct)
    const fixMiss = badMiss.filter((r) => r.abUnseen30)
    console.log(`\n== ${spec ?? "all"}: okHit ${okHit.length} badHit ${badHit.length} okMiss ${okMiss.length} badMiss ${badMiss.length} (fixable: AB unseen in mailbox30 ${fixMiss.length})`)
    const table = {}
    for (const [name, t] of Object.entries(triggers)) {
        const pct = (L) => (L.length ? +(100 * L.filter(t).length / L.length).toFixed(1) : NaN)
        table[name] = { okHit: pct(okHit), badHit: pct(badHit), okMiss: pct(okMiss), badMiss: pct(badMiss), fixMiss: pct(fixMiss), fireAll: pct(R) }
    }
    console.table(table)
}
