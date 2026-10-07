// Worker d (round 5): retrieval. See docs/premise-study/explore2/d.md.
//
// d-qemb (diagnostic, no generation): nomic-embed-text query vectors on the CPU
//   (ctx.embedQuery, num_gpu 0) for the offline recall lab (tools/d-lab.js). Stores
//   two unit-norm Float32 vectors as base64: q = the raw question, s = the question
//   with the mailbox owner's name tokens and question boilerplate stripped (rule-based
//   rewrite), plus the CPU time of each embedding call. The dense index itself
//   (.data/premise2/dense.f32) is searched offline, so no list is stored here.
import { join } from "node:path"
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { ownerTokens } from "./m-common.js"
import { loadPool, loadGuard, assertExplorable } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { SCRATCH } from "../tools/r-common.js"

const BOILER = /\b(according to (the|this|that) (email|e-mail|message|memo|note)s?|(in|from|of) (the|this|that) (email|e-mail|message|memo)s?|(mentioned|stated|discussed|described|referenced|noted|specified|indicated) (in|by) (the|this|that) (email|e-mail|message)s?|as per (the|this) (email|message))\b/gi

export function strippedQuery(question, user) {
    const own = ownerTokens(question, user)
    const words = question.replace(BOILER, " ").split(/\s+/).filter(Boolean)
    const kept = words.filter((w) => {
        const lw = w.toLowerCase().replace(/[^a-z]/g, "")
        return !(own.has(lw) || own.has(lw.replace(/s$/, "")))
    })
    return kept.join(" ").replace(/\s+([?.,])/g, "$1").replace(/,+([?.])/g, "$1").trim() || question
}

export const b64 = (vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64")
export const fromB64 = (text) => { const buf = Buffer.from(text, "base64"); return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) }

async function queryEmbedDiag(ctx, record) {
    const stripped = strippedQuery(record.question, record.user)
    let t = performance.now()
    const q = await ctx.embedQuery(record.question)
    const qMs = Math.round(performance.now() - t)
    t = performance.now()
    const s = stripped === record.question ? q : await ctx.embedQuery(stripped)
    const sMs = stripped === record.question ? 0 : Math.round(performance.now() - t)
    return { status: "diagnostic", answer: "", qemb: { q: b64(q), s: stripped === record.question ? null : b64(s), stripped, qMs, sMs } }
}

// d-qemb-all (diagnostic, run with limit 1): one GPU-queue slot instead of 15. On its
// single record it embeds every development-set question (S300-1/2/3, FULL-0/1,
// S100-0..9; pool records, guard-checked) not yet embedded, ~30 ms each on the CPU,
// appending { key, set, q, s, stripped, qMs, sMs } rows to <scratch>/d-qemb.jsonl.
export const QEMB_FILE = join(SCRATCH, "d-qemb.jsonl")
const DEV = ["S300-1", "S300-2", "S300-3", "FULL-0", "FULL-1", ...Array.from({ length: 10 }, (_, i) => `S100-${i}`)]
async function queryEmbedAll(ctx, record) {
    const pool = loadPool(ctx.dataDir)
    const guard = loadGuard(ctx.dataDir)
    const done = new Set()
    if (existsSync(QEMB_FILE)) for (const line of readFileSync(QEMB_FILE, "utf8").split("\n")) if (line) done.add(JSON.parse(line).key)
    let n = 0
    for (const set of DEV) {
        for (const key of loadSet(ctx.dataDir, set, pool).questionKeys) {
            if (done.has(key)) continue
            const r = pool.byKey.get(key)
            assertExplorable(r, guard)
            const row = await queryEmbedDiag(ctx, r)
            appendFileSync(QEMB_FILE, JSON.stringify({ key, set, ...row.qemb }) + "\n")
            done.add(key)
            n++
        }
    }
    return { status: "diagnostic", answer: "", embedded: n, file: QEMB_FILE }
}

// d-gemb-all (diagnostic, run with limit 1): embeds the model-written search texts of
// stored x1 answers on the development sets, so hybrid versions of those searches can be
// simulated offline: g5 handover `search_mailbox` queries (kind "g5") and k3 explore
// plan searches (kind "plan": `${about} ${question}`, the text plannedSearch ranks with).
// Rows { key, kind, i, text, v } in <scratch>/d-gemb.jsonl.
export const GEMB_FILE = join(SCRATCH, "d-gemb.jsonl")
async function searchEmbedAll(ctx) {
    const pool = loadPool(ctx.dataDir)
    const guard = loadGuard(ctx.dataDir)
    const devKeys = new Set(DEV.flatMap((set) => loadSet(ctx.dataDir, set, pool).questionKeys))
    const done = new Set()
    if (existsSync(GEMB_FILE)) for (const line of readFileSync(GEMB_FILE, "utf8").split("\n")) if (line) { const r = JSON.parse(line); done.add(`${r.key}|${r.kind}|${r.i}`) }
    const rows = new Map()
    for (const line of readFileSync(join(ctx.dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
        if (!line.includes('"variant":"x1"')) continue
        const row = JSON.parse(line)
        if (row.variant === "x1" && row.version === "1+cold" && devKeys.has(row.questionKey)) rows.set(row.questionKey, row)
    }
    let n = 0
    for (const [key, row] of rows) {
        assertExplorable(pool.byKey.get(key), guard)
        const texts = []
        ;(row.g5?.actions ?? []).filter((a) => a.name === "search_mailbox" && !a.auto).forEach((a, i) => texts.push({ kind: "g5", i, text: String(a.args?.query ?? "").trim() || row.question }))
        ;(row.log ?? []).filter((l) => l.act === "search").forEach((l, i) => texts.push({ kind: "plan", i, text: `${l.plan?.about ?? ""} ${pool.byKey.get(key).question}`.trim() }))
        for (const t of texts) {
            if (done.has(`${key}|${t.kind}|${t.i}`)) continue
            const v = await ctx.embedQuery(t.text)
            appendFileSync(GEMB_FILE, JSON.stringify({ key, ...t, v: b64(v) }) + "\n")
            n++
        }
    }
    return { status: "diagnostic", answer: "", embedded: n, file: GEMB_FILE }
}

export const VARIANTS = {
    "d-gemb-all": { version: 1, describe: "diagnostic (limit 1): nomic embeddings of x1's stored model-written searches (g5 queries, k3 plan searches) on the dev sets, to <scratch>/d-gemb.jsonl (no generation)", run: searchEmbedAll },
    "d-qemb": { version: 1, describe: "diagnostic: nomic query embeddings (raw + owner/boilerplate-stripped) on CPU for the d recall lab (no generation)", run: queryEmbedDiag },
    "d-qemb-all": { version: 1, describe: "diagnostic (limit 1): d-qemb for every development-set question in one GPU-queue slot, written to <scratch>/d-qemb.jsonl (no generation)", run: queryEmbedAll },
}
