// z: x1's unsure-half misses whose final context lacks an AB email: is an AB email within
// mailbox BM25 top 30 / 50 / global 20, and was it ever probed by x1 (W0 checks, explore)?
import { join } from "node:path"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
const { graded, bearing } = await openAll()
const bm25 = openBm25(join(".data/premise2", "corpus.sqlite"))
for (const set of ["S300-2", "S300-1"]) {
    const c = { n: 0, m30: 0, m50: 0, g20: 0, probed: 0, listed: 0 }
    for (const i of graded("x1@1+cold", set)) {
        const a = i.answer, r = i.record, ab = bearing(r)
        if (r.stratum !== "miss" || a.step === "commit") continue
        const final = a.step === "commit-g5" ? a.readPaths : a.contextPaths
        if (final.some(ab)) continue
        c.n++
        const mb = bm25.search(r.question, 50, r.user).map((h) => h.path), gl = bm25.search(r.question, 20).map((h) => h.path)
        if (mb.slice(0, 30).some(ab)) c.m30++
        if (mb.some(ab)) c.m50++
        if (gl.some(ab)) c.g20++
        const log = [...(a.log ?? [])]
        if (log.some((l) => l.act === "check" && ab(l.path))) c.probed++
        if (log.some((l) => (l.listed ?? []).some(ab) || (l.results ?? []).some(ab)) || (a.g5?.readPaths ?? []).some(ab)) c.listed++
    }
    console.log(set, c)
}
process.exit(0)
