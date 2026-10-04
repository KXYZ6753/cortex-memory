// Offline (no GPU): gold position in the answering context of variants vs gates on a set.
// node benchmarks/premise2/explore2/tools/w-ctx.js S300-2 gates,w4,w2
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { latestAnswers } from "../../explore/grade.js"
import { EvidenceCache } from "../../evidence.js"
import { ensureEmailStore } from "../../agent-run.js"
const dataDir = ".data/premise2"
const [setName = "S300-2", list = "gates,w4"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const evidence = new EvidenceCache({ get: emails.emailOf })
const t = {}
const add = (k) => (t[k] = (t[k] ?? 0) + 1)
for (const a of latestAnswers(dataDir).filter((a) => a.set === setName && list.split(",").includes(a.variant))) {
    const r = pool.byKey.get(a.questionKey)
    const ab = (p) => p === r.path || (r.twins ?? []).includes(p) || evidence.answerBearing(p, r) === true
    const i = (a.contextPaths ?? []).findIndex(ab)
    add(`${a.variant} ${r.stratum} gold@${i < 0 ? "out" : i === 0 ? "0" : "1-4"}`)
    if (a.picked !== undefined) add(`${a.variant} ${r.stratum} picked=${a.picked > 0 ? (a.picked > 3 ? "4+" : a.picked) : "fallback"}`)
    if (a.yes) add(`${a.variant} ${r.stratum} yes=${Math.min(a.yes.length, 4)}`)
}
console.log(Object.entries(t).sort().map((e) => e.join(": ")).join("\n"))
emails.close()
