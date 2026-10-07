// Worker d: lexical candidate lists for the recall lab (pool records only; no GPU).
// Writes <scratch>/d-feat.jsonl, one row per development-set question:
//   bm     asker's mailbox BM25(question) top 200 (path, score)
//   strip  mailbox BM25 with the owner's name tokens removed, top 50
//   subj   mailbox BM25 with subject x3 / sender x2 column weights, top 50
//   ent    names in the question as sender/recipient filters (m-recall's entList), top 30
//   glob   global BM25 top 20
//   goldBm rank of the gold email (or a twin) in the mailbox BM25 list, depth 2000 (null beyond)
//   node benchmarks/premise2/explore2/tools/d-feat.js
import { join } from "node:path"
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { Bm25Pool, mapLimit } from "../../bm25.js"
import { toBm25Query } from "../../../../src/bm25.js"
import { openAll, SCRATCH } from "./r-common.js"
import { questionNames, ownerTokens } from "../variants/m-common.js"

export const DEV = ["S300-1", "S300-2", "S300-3", "FULL-0", "FULL-1", ...Array.from({ length: 10 }, (_, i) => `S100-${i}`)]
export const FEAT = join(SCRATCH, "d-feat.jsonl")

export function readFeat() {
    const out = new Map()
    if (!existsSync(FEAT)) return out
    for (const line of readFileSync(FEAT, "utf8").split("\n")) if (line) { const row = JSON.parse(line); out.set(row.key, row) }
    return out
}

if (process.argv[1]?.endsWith("d-feat.js")) {
    process.env.R_ALLOW_HELDOUT = "1" // S300-2/S300-3/FULL-1 are development sets in round 5
    const { records, setOf } = await openAll({ sets: DEV })
    const done = readFeat()
    const todo = records.filter((r) => !done.has(r.questionKey))
    console.log(`${records.length} questions, ${todo.length} to do`)
    const dbPath = ".data/premise2/corpus.sqlite"
    const pool = new Bm25Pool(dbPath, 4)
    const poolS = new Bm25Pool(dbPath, 2, { weights: [0, 0, 3, 2, 1, 1] })
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const filt = db.prepare("SELECT path FROM docs WHERE docs MATCH ? AND user = ? ORDER BY rank LIMIT ?")
    const entList = (question, user, k = 30) => {
        const names = questionNames(question, user)
        const terms = toBm25Query(question)
        if (!names.length || !terms) return []
        const filter = names.map((w) => `sender : "${w}" OR recipients : "${w}"`).join(" OR ")
        try { return filt.all(`(${filter}) AND (${terms})`, user, k).map((r) => r.path) } catch { return [] }
    }
    const stripQ = (question, user) => {
        const own = ownerTokens(question, user)
        return question.split(/\s+/).filter((w) => { const lw = w.toLowerCase().replace(/[^a-z]/g, ""); return !own.has(lw) && !own.has(lw.replace(/s$/, "")) }).join(" ")
    }
    const t0 = performance.now()
    await mapLimit(todo, 8, async (r) => {
        const q = r.question
        const [deep, strip, subj, glob] = await Promise.all([pool.search(q, 2000, r.user), pool.search(stripQ(q, r.user), 50, r.user), poolS.search(q, 50, r.user), pool.search(q, 20)])
        const twins = new Set([r.path, ...(r.twins ?? [])])
        const gi = deep.findIndex((h) => twins.has(h.path))
        const row = {
            key: r.questionKey, set: setOf.get(r.questionKey), stratum: r.stratum, user: r.user,
            bm: deep.slice(0, 200).map((h) => [h.path, +h.score.toFixed(4)]), mailboxHits: deep.length,
            strip: strip.map((h) => h.path), subj: subj.map((h) => h.path), ent: entList(q, r.user), glob: glob.map((h) => h.path),
            goldBm: gi >= 0 ? gi + 1 : null,
        }
        appendFileSync(FEAT, JSON.stringify(row) + "\n")
    }, (d, n) => { if (d % 250 === 0 || d === n) console.log(`${d}/${n} ${Math.round((performance.now() - t0) / 1000)} s`) })
    await pool.close(); await poolS.close()
    process.exit(0)
}
