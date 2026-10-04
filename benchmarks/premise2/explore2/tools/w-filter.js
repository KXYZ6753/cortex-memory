// Offline (no GPU): from wprobe single-email answers, would a pointwise abstention filter
// (non-abstaining emails first, rank order kept) put answer-bearing emails earlier / into
// the 5-email context more often than gates' first context?
// node benchmarks/premise2/explore2/tools/w-filter.js S100-0 wprobe
process.loadEnvFile(".env")
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { latestAnswers } from "../../explore/grade.js"
import { EvidenceCache } from "../../evidence.js"
import { ensureEmailStore } from "../../agent-run.js"
const dataDir = ".data/premise2"
const [setName = "S100-0", variant = "wprobe"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const evidence = new EvidenceCache({ get: emails.emailOf })
const t = {}
const add = (k) => (t[k] = (t[k] ?? 0) + 1)
const pos = (list, ab) => { const i = list.findIndex(ab); return i < 0 ? "out" : i === 0 ? "0" : "1-4" }
for (const a of latestAnswers(dataDir).filter((a) => a.set === setName && a.variant === variant && a.singles)) {
    const r = pool.byKey.get(a.questionKey)
    const ab = (p) => p === r.path || (r.twins ?? []).includes(p) || evidence.answerBearing(p, r) === true
    const ctx0 = a.contextPaths
    const yes = a.singles.filter((s) => !s.abstain).map((s) => s.path)
    const no = a.singles.filter((s) => s.abstain).map((s) => s.path)
    const filt = [...yes, ...no].slice(0, 5)
    const filt5 = [...a.singles.slice(0, 5).filter((s) => !s.abstain), ...a.singles.slice(0, 5).filter((s) => s.abstain)].map((s) => s.path)
    add(`${r.stratum} ctx0:${pos(ctx0, ab)} -> filt10:${pos(filt, ab)}`)
    add(`${r.stratum} ctx0:${pos(ctx0, ab)} -> filt5:${pos(filt5, ab)}`)
    add(`${r.stratum} nYes=${Math.min(yes.length, 3)}${yes.length >= 3 ? "+" : ""}`)
}
console.log(Object.entries(t).sort().map((e) => e.join(": ")).join("\n"))
emails.close()
