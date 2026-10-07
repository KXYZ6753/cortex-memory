// Worker b: build the demonstration bank from DEMO-1 + DEMO-2 (training data; never
// evaluated). No model calls: pool records, email store and BM25 only.
//   node benchmarks/premise2/explore2/tools/b-bank.js
// Writes .data/premise2/explore/b-bank.json: per demo question its key, mailbox, gold
// path (+ twins / near-duplicates, for exclusion), question, gold answer, type, gold
// email length, and gates' first context (gatesContexts in n-conf.js) with a flag
// whether that context holds the gold email or a twin.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { gatesContexts } from "../variants/n-conf.js"
import { BANK_PATH } from "../variants/b-common.js"
import { recordsOf, emails, dataDir, DEMO_SETS } from "./b-lib.js"

const store = await emails()
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const ctx = { emailOf: store.emailOf, search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path) }
const bank = []
for (const setName of DEMO_SETS) {
    for (const r of recordsOf(setName)) {
        const { contexts } = await gatesContexts(ctx, r)
        const ab = new Set([r.path, ...(r.twins ?? [])])
        bank.push({
            key: r.questionKey, set: setName, user: r.user, path: r.path, excl: [...new Set([r.path, ...(r.twins ?? []), ...(r.nearDups ?? [])])],
            question: r.question, gold: r.gold, type: r.type, stratum: r.stratum, chars: store.emailOf(r.path).length,
            ctx5: contexts[0], goldInCtx5: contexts[0].some((p) => ab.has(p)), ctx5Chars: contexts[0].reduce((s, p) => s + store.emailOf(p).length, 0),
        })
    }
}
writeFileSync(BANK_PATH(dataDir), JSON.stringify(bank))
const n = (f) => bank.filter(f).length
console.log(`bank ${bank.length}: hits ${n((d) => d.stratum === "hit")}, gold in ctx5 ${n((d) => d.goldInCtx5)}, chars<=2500 ${n((d) => d.chars <= 2500)}, users ${new Set(bank.map((d) => d.user)).size}`)
bm25.close()
