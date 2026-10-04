// Offline (no GPU): runs o-variants with a stub generator to check that their first
// context equals gates' stored contextPaths on a set, and prints prompt sizes.
// node benchmarks/premise2/explore2/tools/o-check.js S300-2 o1 [showPromptIndex]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers } from "../../explore/grade.js"
import { VARIANTS } from "../variants/o-reading.js"

const dataDir = ".data/premise2"
const [setName, id, show] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const gates = new Map(latestAnswers(dataDir).filter((a) => a.set === setName && a.variant === "gates").map((a) => [a.questionKey, a]))
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
let same = 0, diff = 0, n = 0, chars = 0
for (const key of set.questionKeys) {
    const record = pool.byKey.get(key)
    let sent = null
    const ctx = { emailOf: emails.emailOf, emailMap: { get: emails.emailOf }, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path), generate: async (req) => { sent ??= req; return { status: "ok", answer: "stub" } } }
    const out = await VARIANTS[id].run(ctx, record)
    const g = gates.get(key)
    if (g) (JSON.stringify(g.contextPaths) === JSON.stringify(out.contextPaths) ? same++ : diff++)
    chars += JSON.stringify(sent.prompt ?? sent.messages).length
    if (show && n === Number(show)) console.log(sent.prompt ?? JSON.stringify(sent.messages, null, 1).slice(0, 4000))
    n++
}
console.log({ id, n, sameAsGates: same, diff, meanPromptChars: Math.round(chars / n) })
bm25.close(); emails.close()
