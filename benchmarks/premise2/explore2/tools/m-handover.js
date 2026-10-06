// Worker m: committed x1 misses without AB in the final context: AB rank in recovery lists (W0 excluded).
import { join } from "node:path"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { byHeaderRank } from "../../explore/variants.js"
import { SCRATCH, readJsonIf } from "./r-common.js"
const { graded, bearing, emails } = await openAll()
const bm25 = openBm25(".data/premise2/corpus.sqlite")
const cs = readJsonIf(join(SCRATCH, "p-ce-std.json"), {}), cn = readJsonIf(join(SCRATCH, "p-ce-snip.json"), {})
for (const set of ["S300-2", "S300-1", "FULL-0"]) {
    const t = {}
    for (const it of graded("x1@1+cold", set)) {
        const a = it.answer, rec = it.record, ab = bearing(rec), q = rec.question
        if (rec.stratum !== "miss" || !a.step?.startsWith("commit")) continue
        if ((a.readPaths ?? a.contextPaths ?? []).some(ab)) continue
        const global = bm25.search(q, 20).map((h) => h.path).slice(0, 5)
        const mbox = bm25.search(q, 50, rec.user).map((h) => h.path)
        const hdr = byHeaderRank(q, mbox.slice(0, 20), emails.emailOf).slice(0, 5)
        const W0 = global[0]?.startsWith(`${rec.user}/`) ? global : hdr
        const c = cs[rec.questionKey] ?? {}, s = cn[rec.questionKey] ?? {}
        const L = mbox.filter((p) => !W0.includes(p) && c[p] !== undefined).sort((x, y) => Math.max(c[y], s[y] ?? -99) - Math.max(c[x], s[x] ?? -99))
        const bm = mbox.slice(0, 30).filter((p) => !W0.includes(p))
        const r = L.findIndex(ab), rb = bm.findIndex(ab)
        const k = `${a.step} ${it.correct ? "ok" : "bad"}`
        const e = (t[k] ??= { n: 0, s3: 0, s5: 0, s8: 0, s10: 0, bm30: 0 })
        e.n++; if (r >= 0 && r < 3) e.s3++; if (r >= 0 && r < 5) e.s5++; if (r >= 0 && r < 8) e.s8++; if (r >= 0 && r < 10) e.s10++; if (rb >= 0) e.bm30++
    }
    console.log(set, JSON.stringify(t))
}
process.exit(0)
