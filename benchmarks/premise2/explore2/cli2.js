// Phase-2 exploration CLI (GPU- and store-locked; safe to call from parallel workers).
//   node benchmarks/premise2/explore2/cli2.js run <set> <variant,variant> [limit]
//   node benchmarks/premise2/explore2/cli2.js grade <set> <variant,variant>
//   node benchmarks/premise2/explore2/cli2.js report <set> [baseline] [champion]
//   node benchmarks/premise2/explore2/cli2.js list
//   node benchmarks/premise2/explore2/cli2.js queue          (who holds / waits for the GPU)
// Typical: run S300-2 myvar && grade S300-2 myvar && report S300-2 pb gates

import { existsSync } from "node:fs"
import { join } from "node:path"
import { runExplore2 } from "./run2.js"
import { loadVariants } from "./registry.js"
import { withLock, lockHolder } from "./lock.js"
import { gradeExplore } from "../explore/grade.js"
import { analyzeSet } from "../explore/analyze.js"
import { ensureEmailStore } from "../agent-run.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const [command, ...args] = process.argv.slice(2)
const list = (value) => (value ? value.split(",").filter(Boolean) : null)

try {
    if (command === "run") await runExplore2({ dataDir, setName: args[0], variants: list(args[1]), limit: args[2] ? Number(args[2]) : Infinity })
    else if (command === "grade") await withLock(dataDir, `grade ${args[0]} ${args[1] ?? ""}`, () => gradeExplore({ dataDir, sets: list(args[0]), variants: list(args[1]), phase: "explore" }), { name: "grade" })
    else if (command === "report") {
        const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
        analyzeSet({ dataDir, setName: args[0], baseline: args[1] ?? "pb", champion: args[2] ?? "gates", alias: "small", emailOf: emails.emailOf })
        emails.close()
    } else if (command === "list") for (const [id, v] of Object.entries(await loadVariants())) console.log(`${id}\t${v.file ?? "explore"}\t${v.describe}`)
    else if (command === "queue") {
        const { readdirSync, readFileSync } = await import("node:fs")
        for (const name of ["gpu", "grade"]) {
            console.log(`${name}: ${lockHolder(dataDir, name) ?? "free"}`)
            try { for (const t of readdirSync(join(dataDir, "explore", `${name}.queue`)).sort()) console.log(`  waiting ${t}: ${readFileSync(join(dataDir, "explore", `${name}.queue`, t), "utf8")}`) } catch {}
        }
    } else throw new Error(`unknown command ${command}`)
} catch (error) {
    console.error(error)
    process.exitCode = 1
}
