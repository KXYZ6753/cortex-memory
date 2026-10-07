// Worker d: shared offline helpers for the recall lab (pool records only; no GPU).
//   - lexical lists from d-feat.jsonl, gates' contexts W0/W1 (recomputed from them)
//   - thread index (same normalised subject in the asker's mailbox; Re:/Fw: chains)
//   - nomic dense: index (.data/premise2/dense.f32) + stored query vectors (d-qemb rows)
//   - CE score cache (<scratch>/d-ce-std.json, seeded from p-ce-std.json)
//   - x1's stored answers (path, explore lists) and AB (gold, twin, answer-bearing)
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { byHeaderRank } from "../../explore/variants.js"
import { readJson, loadDense, denseSearch } from "../../dense.js"
import { openAll as openR, SCRATCH, readJsonIf } from "./r-common.js"
import { readFeat, DEV } from "./d-feat.js"
import { denseLists } from "./p-common.js"
import { fromB64, QEMB_FILE } from "../variants/d-dense.js"

export { DEV, SCRATCH }
export const CE_FILE = join(SCRATCH, "d-ce-std.json")
export const SCREEN = new Set(["S300-4", "S300-5", "FULL-2", "DEMO-1", "DEMO-2"])

export const normSubject = (s) => {
    let t = String(s ?? "").toLowerCase().trim()
    for (let i = 0; i < 6; i++) t = t.replace(/^\s*((re|fw|fwd|aw|tr)\s*(\[\d+\])?\s*:|\[[^\]]*\])\s*/i, "")
    return t.replace(/\s+/g, " ").trim()
}

// question-time rows of the asker's answers file for one variant (latest per key)
export function storedRows(variant, version, { status = null } = {}) {
    const out = new Map()
    const file = ".data/premise2/explore/answers.jsonl"
    for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.includes(`"variant":"${variant}"`)) continue
        const row = JSON.parse(line)
        if (row.variant !== variant || row.version !== version) continue
        if (SCREEN.has(row.set)) continue
        if (status && row.status !== status) continue
        out.set(row.questionKey, row)
    }
    return out
}

export async function openLab({ dense = true } = {}) {
    process.env.R_ALLOW_HELDOUT = "1"
    const env = await openR({ sets: DEV })
    const feat = readFeat()
    // thread index for the tuning mailboxes
    const db = new DatabaseSync(".data/premise2/corpus.sqlite", { readOnly: true })
    const users = [...new Set(env.records.map((r) => r.user))]
    const meta = new Map()
    const threads = new Map()
    const stmt = db.prepare("SELECT c0 AS path, c2 AS subject, c3 AS sender, c4 AS recipients FROM docs_content WHERE c1 = ?")
    for (const user of users) for (const row of stmt.all(user)) {
        const ns = normSubject(row.subject)
        meta.set(row.path, { subject: row.subject, ns, sender: row.sender, recipients: row.recipients })
        if (ns.length < 4) continue
        const key = `${user}\u0000${ns}`
        if (!threads.has(key)) threads.set(key, [])
        threads.get(key).push(row.path)
    }
    db.close()
    const siblings = (path) => {
        const m = meta.get(path)
        if (!m || m.ns.length < 4) return []
        return (threads.get(`${path.split("/")[0]}\u0000${m.ns}`) ?? []).filter((p) => p !== path)
    }
    // dense
    let index = null, qvec = new Map()
    if (dense) {
        const docs = readJson(join(".data/premise2", "dense-docs.json"))
        index = loadDense(join(".data/premise2", "dense.f32"), docs.paths, docs.users)
        if (existsSync(QEMB_FILE)) for (const line of readFileSync(QEMB_FILE, "utf8").split("\n")) {
            if (!line) continue
            const row = JSON.parse(line)
            qvec.set(row.key, { q: fromB64(row.q), s: row.s ? fromB64(row.s) : null, qMs: row.qMs, sMs: row.sMs, stripped: row.stripped })
        }
    }
    const denseMemo = new Map()
    const pdense = dense ? denseLists() : new Map()
    const denseList = (key, user, { which = "q", k = 100, scope = "mailbox" } = {}) => {
        const memoKey = `${key}|${which}|${scope}|${k}`
        if (denseMemo.has(memoKey)) return denseMemo.get(memoKey)
        const v = qvec.get(key)?.[which]
        let out = v ? denseSearch(index, v, k, scope === "mailbox" ? user : null) : null
        // fallback: p's pdense diagnostic lists (same model and index; mailbox top 50, global top 20)
        if (!out && which === "q" && pdense.has(key)) { const d = pdense.get(key)[scope === "mailbox" ? "mailbox" : "global"]; out = d.slice(0, k).map(([path, score]) => ({ path, score })) }
        denseMemo.set(memoKey, out)
        return out
    }
    // CE scores: d's cache over p's (same model and text; p's holds pdense candidates for S300-2)
    const dce = readJsonIf(CE_FILE, {}), pce = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
    const ce = new Proxy({}, { get: (_, key) => (dce[key] || pce[key] ? { ...(pce[key] ?? {}), ...(dce[key] ?? {}) } : undefined) })
    // gates' contexts from the stored lexical lists (as gates / x1 build them)
    const gatesOf = (record) => {
        const f = feat.get(record.questionKey)
        const global = f.glob.slice(0, 5)
        const mbox = f.bm.map((x) => x[0])
        const hdr = byHeaderRank(record.question, mbox.slice(0, 20), env.emailOf)
        const mailbox = hdr.slice(0, 5)
        const switched = !global[0]?.startsWith(`${record.user}/`)
        const [W0, W1] = switched ? [mailbox, global] : [global, mailbox]
        return { W0, W1, switched, global, mailbox, hdr, mbox }
    }
    return { ...env, feat, meta, siblings, index, qvec, denseList, ce, gatesOf }
}

export const rrf = (lists, k = 60) => {
    const s = new Map()
    for (const l of lists) l.forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (k + i + 1)))
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
}
export const uniq = (xs) => [...new Set(xs)]
