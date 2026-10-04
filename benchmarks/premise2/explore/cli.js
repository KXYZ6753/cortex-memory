// Exploration CLI.
//   node benchmarks/premise2/explore/cli.js pool
//   node benchmarks/premise2/explore/cli.js draw <name> <S100|S300|FULL>
//   node benchmarks/premise2/explore/cli.js run <set> <variant,variant> [alias] [limit]
//   node benchmarks/premise2/explore/cli.js grade <set[,set]> [variant,variant]
//   node benchmarks/premise2/explore/cli.js report <set> [baseline] [champion] [alias]
//   node benchmarks/premise2/explore/cli.js spend

import { existsSync } from "node:fs"
import { join } from "node:path"
import { buildPool, loadPool } from "./pool.js"
import { drawSet } from "./sets.js"
import { runExplore } from "./run.js"
import { gradeExplore, spendSoFar, openRouterUsage } from "./grade.js"
import { analyzeSet } from "./analyze.js"
import { codeHash, runConfirm, gradeConfirm, analyzeConfirm } from "./confirm.js"
import { ensureEmailStore } from "../agent-run.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const [command, ...args] = process.argv.slice(2)
const list = (value) => (value ? value.split(",").filter(Boolean) : null)

try {
    if (command === "pool") await buildPool({ dataDir })
    else if (command === "draw") {
        const set = drawSet({ dataDir, name: args[0], kind: args[1], pool: loadPool(dataDir) })
        console.log(`[draw] ${set.name}: ${set.questionKeys.length} questions from ${set.counts.mailboxes} mailboxes (hash ${set.hash.slice(0, 12)})`)
    } else if (command === "run") await runExplore({ dataDir, setName: args[0], variants: list(args[1]), alias: args[2] ?? "small", limit: args[3] ? Number(args[3]) : Infinity })
    else if (command === "grade") await gradeExplore({ dataDir, sets: list(args[0]), variants: list(args[1]), phase: process.env.EXPLORE_PHASE ?? "explore" })
    else if (command === "report") {
        const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), console.log)
        analyzeSet({ dataDir, setName: args[0], baseline: args[1] ?? "pb", champion: args[2] ?? null, alias: args[3] ?? "small", emailOf: emails.emailOf })
        emails.close()
    } else if (command === "confirm-hash") console.log(codeHash())
    else if (command === "confirm-run") await runConfirm({ dataDir, n: args[0] ? Number(args[0]) : 600 })
    else if (command === "confirm-grade") await gradeConfirm({ dataDir, loadCorpus: async () => {
        const { loadRaw } = await import("../dataset.js")
        const { EvidenceCache } = await import("../evidence.js")
        const raw = await loadRaw(join(dataDir, "hf"))
        const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
        return { emailByPath, evidence: new EvidenceCache(emailByPath) }
    } })
    else if (command === "confirm-analyze") await analyzeConfirm({ dataDir })
    else if (command === "spend") console.log(`exploration $${spendSoFar(dataDir, "explore").toFixed(4)}, all $${spendSoFar(dataDir).toFixed(4)}; OpenRouter key usage now ${await openRouterUsage()}`)
    else throw new Error(`unknown command ${command}`)
} catch (error) {
    console.error(error)
    process.exitCode = 1
}
