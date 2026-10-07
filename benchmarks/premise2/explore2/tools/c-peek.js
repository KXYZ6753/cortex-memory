// Worker c: print pool records (question, gold, gold email) for inspection. Offline.
//   node benchmarks/premise2/explore2/tools/c-peek.js <questionKey|set:N> ...
import { join } from "node:path"
import { ensureEmailStore } from "../../agent-run.js"
import { loadSet } from "../../explore/sets.js"
import { pool, dataDir } from "./n-lib.js"
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const args = process.argv.slice(2)
for (const arg of args) {
    let keys = [arg]
    if (arg.includes(":")) { const [s, n] = arg.split(":"); keys = loadSet(dataDir, s, pool).questionKeys.slice(0, Number(n)) }
    for (const key of keys) {
        const r = pool.byKey.get(key)
        console.log(`=== ${key} [${r.stratum}] ${r.user} ${r.path}\nQ: ${r.question}\nGOLD: ${r.gold}\nALTS: ${JSON.stringify(r.alternates ?? [])}\n--- email (${emails.emailOf(r.path).length} chars)\n${emails.emailOf(r.path)}\n`)
    }
}
emails.close()
