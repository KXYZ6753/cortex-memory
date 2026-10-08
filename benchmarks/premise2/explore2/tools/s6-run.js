// Worker s6: locked runner for the scale control (gemma4:e4b-it-qat, alias "mid").
//
//   node benchmarks/premise2/explore2/tools/s6-run.js <set> <variant,variant> [--alias mid] [--chunk 300] [--limit N] [--dry]
//
// Calls explore2/run2.js runExplore2 with alias "mid" in chunks of at most --chunk
// questions; every chunk is its own withLock() job (run2.js takes the GPU lock), so other
// workers interleave between chunks and no locked job runs much past ~15 min. Each chunk
// reloads the model (run2.js ensureResident), which the det() wrapper of the s6 variants
// makes irrelevant to the answers. --limit caps the total new answers per variant (smoke
// tests). --dry prints the pending counts only (no lock, no GPU).
//
// Safety: the answer store keys by sha256(digest | variant@version | questionKey) and
// records `alias`, so e4b answers can never overwrite e2b answers. preflight() checks the
// Ollama version and the e4b digest against the main run's provenance. 31b is refused.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { runExplore2 } from "../run2.js"
import { loadVariants } from "../registry.js"
import { ExploreStore, preflight, answerKey, COLD } from "../../explore/run.js"
import { exploreDirOf, loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const [setName, variantList] = args
const alias = opt("alias", "mid")
const chunk = Number(opt("chunk", "300"))
const limit = Number(opt("limit", "Infinity"))
const dry = args.includes("--dry")

if (!setName || !variantList) throw new Error("usage: s6-run.js <set> <variant,variant> [--alias mid] [--chunk 300] [--limit N] [--dry]")
if (alias === "large") throw new Error("31b (alias large) does not fit this GPU; refused")
if (/^H6-C$|^TEST|^DEMO/i.test(setName)) throw new Error(`set ${setName} is not a development set; refused`)
const variants = variantList.split(",").filter(Boolean)
const VARIANTS = await loadVariants()
for (const id of variants) if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)

const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)

// Pending count for one variant (reads the store; preflight only queries /api/version and /api/tags).
async function pendingOf(id) {
    const { digest } = await preflight({ dataDir, alias, ollamaUrl: "http://localhost:11434" })
    const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
    const version = `${VARIANTS[id].version}${COLD}`
    return set.questionKeys.filter((questionKey) => !store.done(answerKey({ digest, variant: id, version, questionKey }))).length
}

const stamp = () => new Date().toISOString()
for (const id of variants) {
    let left = await pendingOf(id)
    console.log(`[s6-run] ${stamp()} ${setName} ${id} alias ${alias}: ${left} pending of ${set.questionKeys.length}`)
    if (dry) continue
    let budget = limit
    while (left > 0 && budget > 0) {
        const n = Math.min(chunk, budget)
        const started = Date.now()
        await runExplore2({ dataDir, setName, variants: [id], alias, limit: n })
        const after = await pendingOf(id)
        const made = left - after
        console.log(`[s6-run] ${stamp()} ${setName} ${id}: chunk made ${made} answers in ${Math.round((Date.now() - started) / 1000)} s (incl. queue wait); ${after} pending`)
        if (made <= 0) { console.log(`[s6-run] no progress (technical failures at their retry cap?); stopping ${id}`); break }
        budget -= made
        left = after
    }
}
