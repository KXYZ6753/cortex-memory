// Worker g: where does the first answer-bearing email sit in g2's gates-start
// observation (first context in full = slots 1-5, previews = slots 6-15)? No GPU.
//   node benchmarks/premise2/explore2/tools/g-recall.js S300-2
import { join } from "node:path"
import { openAll, dataDir } from "./a-lib.js"
import { loadSet } from "../../explore/sets.js"
import { openBm25 } from "../../bm25.js"
import { byHeaderRank } from "../../explore/variants.js"

const setName = process.argv[2] ?? "S300-2"
const { pool, emails, bearing } = await openAll()
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const set = loadSet(dataDir, setName, pool)
const hist = { miss: {}, hit: {} }
for (const key of set.questionKeys) {
    const record = pool.byKey.get(key)
    const q = record.question
    const global = bm25.search(q, 20).map((h) => h.path).slice(0, 5)
    const mbr = bm25.search(q, 20, record.user).map((h) => h.path)
    const mbo = byHeaderRank(q, mbr, emails.emailOf)
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const first = switched ? mbo.slice(0, 5) : global
    const second = switched ? global : mbo.slice(0, 5)
    const cands = [...new Set([...first, ...second, ...mbo])].slice(0, 15)
    const isB = bearing(record)
    const pos = cands.findIndex(isB)
    const bucket = pos < 0 ? "none" : pos < 5 ? "full1-5" : pos < 10 ? "prev6-10" : "prev11-15"
    hist[record.stratum][bucket] = (hist[record.stratum][bucket] ?? 0) + 1
}
console.log(JSON.stringify(hist, null, 1))
bm25.close(); emails.close()
