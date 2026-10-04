// Offline: per dev question, the BM25 candidates (global top 20, mailbox top 30, with
// scores), header-match scores, body keys (for dedup) and answer-bearing flags.
// Writes <SCRATCH>/r-features.json. No GPU, no model.
//   node benchmarks/premise2/explore2/tools/r-features.js [sets...]

import { join } from "node:path"
import { headerScore } from "../../explore/variants.js"
import { splitFile, normalisedBodyKey } from "../../text.js"
import { openBm25 } from "../../bm25.js"
import { openAll, SCRATCH, writeJsonFile, DEV_SETS, DATA_DIR } from "./r-common.js"

const sets = process.argv.slice(2).length ? process.argv.slice(2) : DEV_SETS
const env = await openAll({ sets })
// R_WEIGHTS: bm25() column weights (path, user, subject, sender, recipients, body), e.g. [0,0,3,2,1,1]
if (process.env.R_WEIGHTS) env.bm25 = openBm25(join(DATA_DIR, "corpus.sqlite"), { weights: JSON.parse(process.env.R_WEIGHTS) })
const out = []
const started = performance.now()
for (const record of env.records) {
    const q = record.question
    const global = env.bm25.search(q, 20)
    const mailbox = env.bm25.search(q, 30, record.user)
    const paths = [...new Set([...global, ...mailbox].map((hit) => hit.path))]
    const info = {}
    for (const path of paths) {
        const email = env.emailOf(path)
        info[path] = { h: headerScore(q, email), ab: env.answerBearing(record, path) ? 1 : 0, bk: normalisedBodyKey(splitFile(email).body), len: email.length }
    }
    out.push({ key: record.questionKey, set: env.setOf.get(record.questionKey), user: record.user, stratum: record.stratum, question: q, gold: record.path,
        global: global.map((h) => [h.path, +h.score.toFixed(3)]), mailbox: mailbox.map((h) => [h.path, +h.score.toFixed(3)]), info })
    if (out.length % 200 === 0) console.log(`${out.length}/${env.records.length} ${Math.round((performance.now() - started) / 1000)} s`)
}
const file = join(SCRATCH, `r-features${process.env.R_TAG ?? ""}.json`)
writeJsonFile(file, out)
console.log(`wrote ${out.length} to ${file}`)
