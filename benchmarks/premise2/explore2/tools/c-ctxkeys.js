// Worker c: key-unit excerpt over gates' first context (5 emails, stored contextPaths):
// how often do the CE / lexical top-3 units come from the gold email and include its
// evidence unit; split by gates right / wrong on hits. Offline (CPU cross-encoder).
//   node benchmarks/premise2/explore2/tools/c-ctxkeys.js [sets]
import { join } from "node:path"
import { contentWords, novelAnswerWords } from "../../text.js"
import { keyLines, lexScores, units } from "../variants/c-render.js"
import { loadReranker } from "../../rerank.js"
import { pool, dataDir, loadTable, emails, closeEmails } from "./c-lib.js"
const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,FULL-1").split(",")
const store = await emails()
const ce = await loadReranker(join(dataDir, "..", "models"))
const ceScorer = (q, t) => ce.score(q, t)
const rows = []
for (const s of sets) {
    const { table, keys } = loadTable(s, ["gates", "x1"])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const g = table.get("gates")?.get(key)
        if (!g?.a?.contextPaths) continue
        const paths = g.a.contextPaths
        const gi = paths.findIndex((p) => p === r.path || (r.twins ?? []).includes(p))
        if (gi < 0) continue
        const emailsCtx = paths.map((p) => store.emailOf(p))
        const novel = new Set(novelAnswerWords([r.gold, ...(r.alternates ?? [])], r.question))
        const cov = (t) => { const w = contentWords(t); return novel.size ? w.filter((x) => novel.has(x)).length / novel.size : 0 }
        const gu = units(emailsCtx[gi]).filter((u) => !u.header && u.text.length >= 20)
        const best = Math.max(0, ...gu.map((u) => cov(u.text)))
        const isEv = (k) => k.email === gi && best > 0 && cov(k.text) >= best - 1e-9
        const kc = await keyLines(r.question, emailsCtx, { k: 3, scorer: ceScorer })
        const kl = await keyLines(r.question, emailsCtx, { k: 3, scorer: lexScores })
        rows.push({ s, gates: g.correct, x1: table.get("x1")?.get(key)?.correct ?? null, best, ceGold: kc.filter((k) => k.email === gi).length, ceEv: kc.some(isEv), lexGold: kl.filter((k) => k.email === gi).length, lexEv: kl.some(isEv) })
    }
}
closeEmails()
const rate = (l, f) => (100 * l.filter(f).length / Math.max(1, l.length)).toFixed(1)
const show = (label, l) => console.log(`${label.padEnd(16)} n=${String(l.length).padStart(4)}  CE: >=1 unit from gold ${rate(l, (x) => x.ceGold > 0)}, evidence ${rate(l, (x) => x.ceEv)}, no gold unit ${rate(l, (x) => x.ceGold === 0)} | lex: >=1 gold ${rate(l, (x) => x.lexGold > 0)}, evidence ${rate(l, (x) => x.lexEv)}`)
const ev = rows.filter((x) => x.best > 0)
show("all hits", ev)
show("gates right", ev.filter((x) => x.gates === 1))
show("gates wrong", ev.filter((x) => x.gates === 0))
process.exit(0)
