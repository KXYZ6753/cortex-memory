// Worker d: recall of x1's g5 handover search (the model's own mailbox query; g5 shows the
// top 3 of byHeaderRank(BM25(query) top 20) in full + 7 previews, the agent reads, the final
// answer reads what it read). Offline replay of each handover's search + alternatives:
//   g5         BM25(model query) mailbox top 20, header-reranked (what g5 showed)
//   question   gates' mailbox order for the original question (hdr top 20, then BM25)
//   rrf(g5,q)  RRF(k=10) of the two
//   hyb        RRF(k=10) of BM25(model query) and nomic dense(model query) (d-gemb vectors)
//   ce(q|g5+q) CE(original question) over g5 top 20 ∪ question top 20
//   ce(q|g5+q+dq) the same pool + dense(question) top 10
// AB in top 3 (shown in full) / top 10 (full + previews) / AB read in x1's final context.
//   node benchmarks/premise2/explore2/tools/d-g5.js [--ce]
import { join } from "node:path"
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { env as hfEnv, AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers"
import { RERANK_MODEL, RERANK_MAX_TOKENS, rerankText } from "../../rerank.js"
import { byHeaderRank } from "../../explore/variants.js"
import { denseSearch } from "../../dense.js"
import { openBm25 } from "../../bm25.js"
import { openLab, storedRows, rrf, uniq, SCRATCH } from "./d-lib.js"
import { fromB64, GEMB_FILE } from "../variants/d-dense.js"
import { openAll as openA } from "./a-lib.js"
import { readJsonIf } from "./r-common.js"

const useCe = process.argv.includes("--ce")
const lab = await openLab()
const { graded } = await openA()
const x1 = storedRows("x1", "1+cold")
const correct = new Map()
for (const set of ["S300-1", "S300-2", "S300-3", "FULL-0", "FULL-1", "S100-4", "S100-5"]) for (const it of graded("x1@1+cold", set)) correct.set(it.record.questionKey, it.correct)
const bm25 = openBm25(".data/premise2/corpus.sqlite")
const gemb = new Map()
if (existsSync(GEMB_FILE)) for (const line of readFileSync(GEMB_FILE, "utf8").split("\n")) if (line) { const r = JSON.parse(line); gemb.set(`${r.key}|${r.kind}|${r.i}`, fromB64(r.v)) }
const CE_G = join(SCRATCH, "d-ce-g5.json")
const ceCache = readJsonIf(CE_G, {})
let model = null, tokenizer = null
if (useCe) {
    hfEnv.cacheDir = join(".data", "models")
    tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL)
    model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: "q8", session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } })
}
const ceScores = async (key, question, paths) => {
    const have = (ceCache[key] ??= { ...(lab.ce[key] ?? {}) })
    const todo = paths.filter((p) => have[p] === undefined)
    if (todo.length && model) {
        for (let i = 0; i < todo.length; i += 16) {
            const b = todo.slice(i, i + 16)
            const o = await model(tokenizer(Array(b.length).fill(question), { text_pair: b.map((p) => rerankText(lab.emailOf(p))), padding: true, truncation: true, max_length: RERANK_MAX_TOKENS }))
            Array.from(o.logits.data).forEach((s, j) => { have[b[j]] = +s.toFixed(3) })
        }
    }
    return have
}

const tab = {}
const bump = (grp, name, v) => { const t = ((tab[grp] ??= {})[name] ??= { n: 0, top3: 0, top10: 0, chg: 0 }); t.n++; t.top3 += v.top3; t.top10 += v.top10; t.chg += v.chg }
let n = 0, reproduced = 0
for (const record of lab.records) {
    const row = x1.get(record.questionKey)
    if (!row || row.step !== "commit-g5") continue
    const search = (row.g5?.actions ?? []).find((a) => a.name === "search_mailbox" && !a.auto)
    if (!search) continue
    const q = String(search.args?.query ?? "").trim() || record.question
    const ab = (p) => lab.answerBearing(record, p)
    const g = lab.gatesOf(record)
    const g5list = byHeaderRank(q, bm25.search(q, 20, record.user).map((h) => h.path), lab.emailOf)
    // reproduction check: every path g5 finally read must be among the replayed top 10
    if ((row.g5?.readPaths ?? row.readPaths ?? []).every((p) => g5list.slice(0, 10).includes(p))) reproduced++
    const qlist = uniq([...g.hdr, ...g.mbox])
    const qbm = lab.feat.get(record.questionKey).bm.map((x) => x[0])
    const viaSearch = (top20) => byHeaderRank(q, top20.slice(0, 20), lab.emailOf) // what g5 shows if ctx.search(query, 20) returned top20
    const lists = { g5: g5list, question: qlist, "rrf(g5,q)": rrf([g5list, qlist], 10),
        "hdr(rrf(bm q,bm Q))": viaSearch(rrf([bm25.search(q, 20, record.user).map((h) => h.path), qbm.slice(0, 20)], 10)) }
    const v = gemb.get(`${record.questionKey}|g5|0`)
    if (v) {
        const dqm = denseSearch(lab.index, v, 20, record.user).map((h) => h.path)
        lists["hyb(g5 bm,dense)"] = rrf([g5list, dqm], 10)
        lists["hyb60(g5 bm,dense)"] = rrf([g5list, dqm], 60)
        lists["hdr(rrf(bm q,dense q))"] = viaSearch(rrf([bm25.search(q, 20, record.user).map((h) => h.path), dqm], 10))
    }
    const yesPath = (row.log ?? []).find((l) => l.act === "check" && l.yes)?.path
    if (yesPath) {
        lists["pin YES + g5"] = uniq([yesPath, ...g5list])
        lists["pin YES + hdr(rrf)"] = uniq([yesPath, ...lists["hdr(rrf(bm q,bm Q))"]])
        // what g5 would show if its search returned [YES, ...BM25(q)] (g5 header-reranks it)
        lists["hdr(YES + bm q)"] = viaSearch(uniq([yesPath, ...bm25.search(q, 20, record.user).map((h) => h.path)]))
    }
    const dq = lab.denseList(record.questionKey, record.user, { which: "q", k: 20 })?.map((h) => h.path)
    if (dq) lists["rrf(g5,q,dq)"] = rrf([g5list, qlist, dq], 10)
    if (useCe) {
        const pool = uniq([...g5list.slice(0, 20), ...qlist.slice(0, 20)])
        const s = await ceScores(record.questionKey, record.question, pool)
        lists["ce(q|g5+q)"] = [...pool].sort((a, b) => s[b] - s[a])
        if (dq) { const pool2 = uniq([...pool, ...dq.slice(0, 10)]); const s2 = await ceScores(record.questionKey, record.question, pool2); lists["ce(q|g5+q+dq)"] = [...pool2].sort((a, b) => s2[b] - s2[a]) }
    }
    const ok = correct.get(record.questionKey)
    const finalAB = (row.readPaths ?? []).some(ab)
    const grps = [`${record.stratum}/${!ok && !finalAB ? "wrong & AB not read" : "other"}`, `${record.stratum}`, `${record.stratum}/${ok ? "x1 right" : "x1 wrong"}`, `${record.stratum}/${finalAB ? "AB read" : "AB not read"}`, `${record.stratum}/yesAt${row.yesAt > 0 ? ">0" : "=0"}`]
    for (const [name, list] of Object.entries(lists)) for (const grp of grps) bump(grp, name, { top3: list.slice(0, 3).some(ab), top10: list.slice(0, 10).some(ab), chg: list.slice(0, 3).join() !== g5list.slice(0, 3).join() })
    n++
}
if (useCe) { writeFileSync(`${CE_G}.tmp`, JSON.stringify(ceCache)); renameSync(`${CE_G}.tmp`, CE_G) }
console.log(`g5 handovers: ${n} (replayed list holds every final read in ${reproduced}); dense vectors for ${gemb.size} searches`)
for (const [grp, byName] of Object.entries(tab).sort()) {
    console.log(`  [${grp}]  AB in top 3 / top 10 / top-3 differs from g5's`)
    for (const [name, t] of Object.entries(byName)) console.log(`    ${name.padEnd(20)} n=${String(t.n).padStart(4)} ${String(t.top3).padStart(5)} ${String(t.top10).padStart(5)} ${String(t.chg).padStart(5)}`)
}
process.exit(0)
