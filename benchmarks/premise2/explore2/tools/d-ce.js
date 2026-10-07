// Worker d: MiniLM cross-encoder scores (std text = rerank.js rerankText) for the recall
// lab's candidate pools, cached in <scratch>/d-ce-std.json (resumable; seeded from
// p-ce-std.json, same model and text). CPU only, 4 onnx threads (other workers' GPU runs
// time their own CE calls; do not starve them).
//   node benchmarks/premise2/explore2/tools/d-ce.js [--threads 4]
// Pool per question (W0 excluded nowhere; the lab filters):
//   W0 ∪ W1, mailbox BM25 top 50 (top 100 for misses and x1-explore questions), global
//   top 10, owner-stripped / subject-weighted top 20, name-filtered top 10, thread
//   siblings of (BM25 top 10 ∪ W0 ∪ W1) (<= 15), dense mailbox top 30 (raw query) and
//   top 20 (stripped query), dense global top 10.
import { join } from "node:path"
import { writeFileSync, renameSync } from "node:fs"
import { env as hfEnv, AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers"
import { RERANK_MODEL, RERANK_MAX_TOKENS, rerankText } from "../../rerank.js"
import { openLab, CE_FILE, SCRATCH, storedRows, uniq } from "./d-lib.js"
import { readJsonIf } from "./r-common.js"

const EXPLORE = new Set(["found", "nofound", "nopick"])

export function poolFor(lab, record, x1row) {
    const f = lab.feat.get(record.questionKey)
    const g = lab.gatesOf(record)
    const deep = record.stratum === "miss" || EXPLORE.has(x1row?.step)
    const bm = f.bm.map((x) => x[0]).slice(0, deep ? 100 : 50)
    const thr = uniq([...bm.slice(0, 10), ...g.W0, ...g.W1].flatMap((p) => lab.siblings(p))).slice(0, 15)
    const dq = lab.denseList(record.questionKey, record.user, { which: "q", k: 30 })?.map((h) => h.path) ?? []
    const ds = lab.denseList(record.questionKey, record.user, { which: "s", k: 20 })?.map((h) => h.path) ?? []
    const dg = lab.denseList(record.questionKey, record.user, { which: "q", k: 10, scope: "global" })?.map((h) => h.path) ?? []
    return uniq([...g.W0, ...g.W1, ...bm, ...f.glob.slice(0, 10), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20), ...f.ent.slice(0, 10), ...thr, ...dq, ...ds, ...dg])
}

if (process.argv[1]?.endsWith("d-ce.js")) {
    const threads = Number(process.argv[process.argv.indexOf("--threads") + 1]) || 4
    const lab = await openLab()
    const x1 = storedRows("x1", "1+cold")
    hfEnv.cacheDir = join(".data", "models")
    const tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL)
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: "q8", session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } })
    const score = async (query, docs, batch = 16) => {
        const out = []
        for (let i = 0; i < docs.length; i += batch) {
            const b = docs.slice(i, i + batch)
            const o = await model(tokenizer(Array(b.length).fill(query), { text_pair: b, padding: true, truncation: true, max_length: RERANK_MAX_TOKENS }))
            out.push(...Array.from(o.logits.data))
            o.logits.dispose?.()
        }
        return out
    }
    const cache = readJsonIf(CE_FILE, {})
    const seed = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
    const save = () => { const tmp = `${CE_FILE}.tmp`; writeFileSync(tmp, JSON.stringify(cache)); renameSync(tmp, CE_FILE) }
    // misses first, then explore-path hits, then the rest
    const needed = (r) => r.stratum === "miss" || EXPLORE.has(x1.get(r.questionKey)?.step)
    const order = [...lab.records].filter((r) => !process.argv.includes("--needed") || needed(r)).sort((a, b) => (a.stratum === "miss" ? 0 : EXPLORE.has(x1.get(a.questionKey)?.step) ? 1 : 2) - (b.stratum === "miss" ? 0 : EXPLORE.has(x1.get(b.questionKey)?.step) ? 1 : 2))
    let done = 0, pairs = 0
    const t0 = performance.now()
    for (const record of order) {
        const have = (cache[record.questionKey] ??= {})
        const known = seed[record.questionKey] ?? {}
        const todo = []
        for (const p of poolFor(lab, record, x1.get(record.questionKey))) {
            if (have[p] !== undefined) continue
            if (known[p] !== undefined) { have[p] = known[p]; continue }
            todo.push(p)
        }
        if (todo.length) {
            const s = await score(record.question, todo.map((p) => rerankText(lab.emailOf(p))))
            todo.forEach((p, i) => { have[p] = +s[i].toFixed(3) })
            pairs += todo.length
        }
        if (++done % 100 === 0) { save(); console.log(`${done}/${order.length} ${pairs} pairs ${Math.round((performance.now() - t0) / 1000)} s`) }
    }
    save()
    console.log(`finished ${done}, ${pairs} pairs, ${Math.round((performance.now() - t0) / 1000)} s`)
    process.exit(0)
}
