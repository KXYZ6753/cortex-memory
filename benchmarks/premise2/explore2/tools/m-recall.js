// Worker m: recall of the AB email into a recovery/explore list (W0 excluded) under several
// candidate generators, on x1's misses (pool records + stored x1 answers + cached CE scores).
//   node benchmarks/premise2/explore2/tools/m-recall.js [sets...]
// Lists (each excludes gates' first context W0):
//   x1     CE(std) over W1 ∪ mailbox BM25 top 30 (x1/k3's explore list)
//   ce50   CE(std) over mailbox top 50 ∪ global top 10 (p-ce-std cache)
//   snip50 max(CE std, CE snippet) over the same pool (p3's pick score)
//   ent    names in the question (not the mailbox owner) as sender/recipient filters, BM25(question) inside
//   strip  mailbox BM25 with the owner's name tokens removed from the query
//   subj   mailbox BM25 with subject x3, sender x2 weights
//   dense  nomic mailbox top 30 (pdense, S300-2 only)
//   fusions: rrf(ce50, ent), ent-first-then-ce50, rrf(ce50, strip, subj)
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { byHeaderRank } from "../../explore/variants.js"
import { SCRATCH, readJsonIf } from "./r-common.js"
import { denseLists } from "./p-common.js"
import { toBm25Query } from "../../../../src/bm25.js"
import { questionNames, ownerTokens } from "../variants/m-common.js"

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["S300-2", "S300-1", "FULL-0"]
const { graded, bearing, emails } = await openAll()
const emailOf = emails.emailOf
const bm25 = openBm25(".data/premise2/corpus.sqlite")
const bm25s = openBm25(".data/premise2/corpus.sqlite", { weights: [0, 0, 3, 2, 1, 1] })
const db = new DatabaseSync(".data/premise2/corpus.sqlite", { readOnly: true })
const filtStmt = db.prepare("SELECT path FROM docs WHERE docs MATCH ? AND user = ? ORDER BY rank LIMIT ?")
const ceStd = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
const ceSnip = readJsonIf(join(SCRATCH, "p-ce-snip.json"), {})
const dense = denseLists()

const rrf = (lists, k = 10) => {
    const s = new Map()
    for (const l of lists) l.forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (k + i + 1)))
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
}
export function entList(question, user, k = 30) {
    const names = questionNames(question, user)
    if (!names.length) return []
    const terms = toBm25Query(question)
    if (!terms) return []
    const filter = names.map((w) => `sender : "${w}" OR recipients : "${w}"`).join(" OR ")
    try { return filtStmt.all(`(${filter}) AND (${terms})`, user, k).map((r) => r.path) } catch { return [] }
}
const stripList = (question, user, k = 50) => {
    const own = ownerTokens(question, user)
    const q = question.split(/\s+/).filter((w) => !own.has(w.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "")) && !own.has(w.toLowerCase().replace(/[^a-z]/g, ""))).join(" ")
    return bm25.search(q, k, user).map((h) => h.path)
}

const KS = [5, 10, 15]
for (const set of sets) {
    const X = graded("x1@1+cold", set).filter((i) => i.record.stratum === "miss")
    const stats = {}
    let w0ok = 0
    for (const it of X) {
        const rec = it.record, a = it.answer, ab = bearing(rec), q = rec.question
        const global = bm25.search(q, 20).map((h) => h.path).slice(0, 5)
        const mbox = bm25.search(q, 50, rec.user).map((h) => h.path)
        const hdr = byHeaderRank(q, mbox.slice(0, 20), emailOf).slice(0, 5)
        const switched = !global[0]?.startsWith(`${rec.user}/`)
        const [W0, W1] = switched ? [hdr, global] : [global, hdr]
        const checks = (a.log ?? []).filter((l) => l.act === "check")
        if (checks[0]?.path === W0[0]) w0ok++
        const seen = new Set(W0)
        const cs = ceStd[rec.questionKey] ?? {}, cn = ceSnip[rec.questionKey] ?? {}
        const byScore = (paths, f) => [...new Set(paths)].filter((p) => !seen.has(p) && f(p) !== undefined).sort((x, y) => f(y) - f(x))
        const lists = {}
        lists.x1 = byScore([...W1, ...mbox.slice(0, 30)], (p) => cs[p])
        lists.ce50 = byScore([...mbox, ...bm25.search(q, 10).map((h) => h.path)], (p) => cs[p])
        lists.snip50 = byScore([...mbox, ...bm25.search(q, 10).map((h) => h.path)], (p) => (cs[p] === undefined ? undefined : Math.max(cs[p], cn[p] ?? -99)))
        lists.snip30 = byScore([...mbox.slice(0, 30), ...bm25.search(q, 10).map((h) => h.path)], (p) => (cs[p] === undefined ? undefined : Math.max(cs[p], cn[p] ?? -99)))
        lists.snip30m = byScore([...mbox.slice(0, 30)], (p) => (cs[p] === undefined ? undefined : Math.max(cs[p], cn[p] ?? -99)))
        lists.snip50m = byScore([...mbox], (p) => (cs[p] === undefined ? undefined : Math.max(cs[p], cn[p] ?? -99)))
        lists.ent = entList(q, rec.user).filter((p) => !seen.has(p))
        lists.strip = stripList(q, rec.user).filter((p) => !seen.has(p))
        lists.subj = bm25s.search(q, 50, rec.user).map((h) => h.path).filter((p) => !seen.has(p))
        const d = dense.get(rec.questionKey)
        if (d) lists.dense = d.mailbox.map((x) => x[0]).filter((p) => !seen.has(p))
        lists["rrf(ce50,ent)"] = rrf([lists.ce50, lists.ent])
        lists["ent3+ce50"] = [...new Set([...lists.ent.slice(0, 3), ...lists.ce50])]
        lists["rrf(ce50,strip,subj)"] = rrf([lists.ce50, lists.strip, lists.subj])
        if (d) lists["rrf(ce50,dense)"] = rrf([lists.ce50, lists.dense])
        const checksW0 = a.step?.startsWith("commit") ? checks : checks.slice(0, 5)
        const yes = checksW0.find((c) => c.yes)
        const grp = it.correct ? "ok" : yes && !ab(yes.path) ? "falseYES" : a.step === "found" || a.step === "nofound" || a.step === "nopick" ? "explore" : "other"
        for (const g of [grp, "all"]) {
            for (const [name, list] of Object.entries(lists)) {
                const r = list.findIndex(ab)
                const s = ((stats[g] ??= {})[name] ??= { n: 0, ...Object.fromEntries(KS.map((k) => [k, 0])) })
                s.n++
                for (const k of KS) if (r >= 0 && r < k) s[k]++
            }
        }
    }
    console.log(`\n== ${set} misses (W0 reproduced on ${w0ok}/${X.length})`)
    for (const [g, byList] of Object.entries(stats)) {
        console.log(`  [${g}] n=${Object.values(byList)[0].n}   AB in list top 5/10/15 (W0 excluded)`)
        for (const [name, s] of Object.entries(byList)) console.log(`    ${name.padEnd(22)} ${KS.map((k) => String(s[k]).padStart(4)).join(" ")}`)
    }
}
process.exit(0)
