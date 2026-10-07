// Worker c: does a key-line excerpt point at the answer evidence? For dev-set hits, the
// gold email's units (c-render.js) are scored by the lexical scorer and by the MiniLM
// cross-encoder (CPU); "evidence unit" = the unit with the highest novel-answer-word
// coverage. Reports top-k recall of the evidence unit, split by x1 / gates right/wrong.
//   node benchmarks/premise2/explore2/tools/c-keys.js [sets] [k=3]
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { contentWords, novelAnswerWords } from "../../text.js"
import { units, lexScores } from "../variants/c-render.js"
import { loadReranker } from "../../rerank.js"
import { pool, dataDir, loadTable, emails, closeEmails, DEV_SETS } from "./c-lib.js"

const sets = process.argv[2] ? process.argv[2].split(",") : DEV_SETS
const K = Number(process.argv[3] ?? 3)
const store = await emails()
const ce = await loadReranker(join(dataDir, "..", "models"))
const rows = []
const started = performance.now()
let pairs = 0
for (const s of sets) {
    const { table, keys } = loadTable(s, ["x1", "gates", "oracles"])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const us = units(store.emailOf(r.path)).filter((u) => !u.header && u.text.length >= 20)
        if (!us.length) continue
        const novel = new Set(novelAnswerWords([r.gold, ...(r.alternates ?? [])], r.question))
        const cov = us.map((u) => { const w = contentWords(u.text); return novel.size ? w.filter((x) => novel.has(x)).length / novel.size : 0 })
        const best = Math.max(...cov)
        const evid = new Set(cov.map((c, i) => (c > 0 && c >= best - 1e-9 ? i : -1)).filter((i) => i >= 0))
        const lex = lexScores(r.question, us.map((u) => u.text))
        const cs = await ce.score(r.question, us.map((u) => u.text))
        pairs += us.length
        const topk = (sc) => sc.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, K).map(([, i]) => i)
        const c = (v) => table.get(v)?.get(key)?.correct ?? null
        rows.push({ set: s, key, n: us.length, best, lexHit: topk(lex).some((i) => evid.has(i)), ceHit: topk(cs).some((i) => evid.has(i)), lex1: evid.has(topk(lex)[0]), ce1: evid.has(topk(cs)[0]), x1: c("x1"), gates: c("gates"), oracles: c("oracles") })
    }
}
closeEmails()
const ms = performance.now() - started
console.log(`${rows.length} hits, ${pairs} unit pairs, CE ${(ms / pairs).toFixed(1)} ms/pair`)
const rate = (l, f) => `${(100 * l.filter(f).length / Math.max(1, l.length)).toFixed(1)}`
const show = (label, l) => console.log(`${label.padEnd(26)} n=${String(l.length).padStart(4)}  lex@${K} ${rate(l, (x) => x.lexHit)}  ce@${K} ${rate(l, (x) => x.ceHit)}  lex@1 ${rate(l, (x) => x.lex1)}  ce@1 ${rate(l, (x) => x.ce1)}  units ${(l.reduce((s, x) => s + x.n, 0) / Math.max(1, l.length)).toFixed(1)}`)
const has = rows.filter((x) => x.best > 0)
show("all (evidence found)", has)
show("x1 right", has.filter((x) => x.x1 === 1))
show("x1 wrong", has.filter((x) => x.x1 === 0))
show("gates wrong", has.filter((x) => x.gates === 0))
show("oracles wrong (FULL-0)", has.filter((x) => x.oracles === 0))
show("evidence coverage >= .5", has.filter((x) => x.best >= 0.5))
writeFileSync(process.env.OUT ?? "c-keys.json", JSON.stringify(rows))
process.exit(0)
