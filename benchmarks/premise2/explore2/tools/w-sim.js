// Offline (no GPU): simulate w1 / w3 on FULL-0 from stored gates + oracles answers.
// A single-email read of the gold email is taken to behave as the stored `oracles`
// answer (same prompt, gold only); a single read of a non-gold first email abstains
// with probability pAbst (measured by wprobe on S100-0) and is otherwise wrong.
// node benchmarks/premise2/explore2/tools/w-sim.js <failures.json gates,oracles> [pAbst]
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { lexicalSource } from "../variants/w-map.js"
const dataDir = ".data/premise2"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
const pAbst = Number(process.argv[3] ?? 0.38)
const missShare = loadPool(dataDir).manifest.strata.missShare
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const acc = { gates: { miss: [], hit: [] }, w1: { miss: [], hit: [] }, w3: { miss: [], hit: [] } }
const t = {}
const add = (k) => (t[k] = (t[k] ?? 0) + 1)
for (const r of rows) {
    const g = r.gates, o = r.oracles
    if (!g || !o || g.correct === null || o.correct === null) continue
    const gold = (p) => p === r.path || (r.twins ?? []).includes(p)
    const ctx0 = g.contextPaths
    const read = (g.readPaths ?? ctx0).slice(-5)
    const single = (path) => (gold(path) ? o.correct : (1 - pAbst) * 0 + pAbst * g.correct)
    acc.gates[r.stratum].push(g.correct)
    acc.w1[r.stratum].push(single(ctx0[0]))
    const src = g.abstain ? -1 : lexicalSource(g.answer, read, emails.emailOf)
    acc.w3[r.stratum].push(src === 0 ? single(read[0]) : g.correct)
    add(`${r.stratum} src=${src === 0 ? 0 : "other"} goldFirst=${gold(read[0])} gates=${g.correct} oracles=${o.correct}`)
}
const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
for (const [k, x] of Object.entries(acc)) console.log(`${k}: weighted ${(100 * (missShare * mean(x.miss) + (1 - missShare) * mean(x.hit))).toFixed(1)} miss ${(100 * mean(x.miss)).toFixed(1)} hit ${(100 * mean(x.hit)).toFixed(1)}`)
console.log(Object.entries(t).sort().map((e) => e.join(": ")).join("\n"))
emails.close()
