// Round 6, lead: run explore2 variants under a given model alias, in locked chunks (as
// tools/s6-run.js, which refuses H6-C). Used for the scale contrast on H6-C (journal, Thu 07:45 ET).
//   node benchmarks/premise2/explore2/tools/lead-run-alias.js <set> <variant,variant> <alias> [--chunk 300]
// Refuses TEST, DEMO and alias "large" (31b does not fit this GPU). Each chunk is its own
// runExplore2 call and GPU lock turn; the answer store keys by digest, so aliases never collide.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { runExplore2 } from "../run2.js"
import { loadVariants } from "../registry.js"
import { ExploreStore, preflight, answerKey, COLD } from "../../explore/run.js"
import { exploreDirOf, loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const args = process.argv.slice(2)
const [setName, variantList, alias] = args
const chunk = args.includes("--chunk") ? Number(args[args.indexOf("--chunk") + 1]) : 300
if (!setName || !variantList || !alias) throw new Error("usage: lead-run-alias.js <set> <variant,variant> <alias> [--chunk 300]")
if (/^(TEST|DEMO)/i.test(setName)) throw new Error(`set ${setName} refused`)
if (alias === "large") throw new Error("31b (alias large) does not fit this GPU; refused")
const variants = variantList.split(",").filter(Boolean)
const VARIANTS = await loadVariants()
for (const id of variants) if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)
const set = loadSet(dataDir, setName, loadPool(dataDir))

async function pendingOf(id) {
    const { digest } = await preflight({ dataDir, alias, ollamaUrl: "http://localhost:11434" })
    const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
    const version = `${VARIANTS[id].version}${COLD}`
    return set.questionKeys.filter((questionKey) => !store.done(answerKey({ digest, variant: id, version, questionKey }))).length
}
for (const id of variants) {
    let left = await pendingOf(id)
    console.log(`[lead-run-alias] ${setName} ${id} ${alias}: ${left} pending of ${set.questionKeys.length}`)
    while (left > 0) {
        await runExplore2({ dataDir, setName, variants: [id], alias, limit: chunk })
        const after = await pendingOf(id)
        console.log(`[lead-run-alias] ${setName} ${id} ${alias}: ${left - after} made, ${after} pending`)
        if (after >= left) { console.log(`[lead-run-alias] no progress; stopping ${id}`); break }
        left = after
    }
}
