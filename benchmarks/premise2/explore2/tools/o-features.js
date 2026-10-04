// Offline (no GPU): per-question features of gates' hit-stratum answers on a set
// (gold position, context chars, gold chars, sentences, quoted/forwarded markers).
// Reads the o-failures.js dump (argv[2]) and the email store. Pool records only.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ensureEmailStore } from "../../agent-run.js"

const dataDir = ".data/premise2"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
const variant = process.argv[3] ?? "gates"
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const sentences = (text) => String(text).split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.trim()).length
const out = []
for (const row of rows) {
    const a = row[variant]
    if (!a || a.correct === null) continue
    const ctxPaths = a.contextPaths ?? []
    const ctx = ctxPaths.map((p) => emails.emailOf(p))
    const gold = emails.emailOf(row.path)
    out.push({
        key: row.questionKey, stratum: row.stratum, correct: a.correct, oracle: row.oracles?.correct,
        pos: ctxPaths.indexOf(row.path), twinsIn: ctxPaths.filter((p) => (row.twins ?? []).includes(p)).length,
        ctxChars: ctx.reduce((s, e) => s + e.length, 0), goldChars: gold.length, maxChars: Math.max(...ctx.map((e) => e.length)),
        sent: sentences(a.answer), words: a.answer.split(/\s+/).length,
        goldOrig: /-----Original Message-----|Forwarded by|^>/m.test(gold),
        sameSubject: (() => { const subj = (e) => (e.match(/^Subject:(.*)$/m)?.[1] ?? "").replace(/^\s*((re|fw|fwd):\s*)*/i, "").trim().toLowerCase(); const g = subj(gold); return ctx.filter((e, i) => ctxPaths[i] !== row.path && subj(e) === g && g).length })(),
    })
}
emails.close()
console.log(JSON.stringify(out))
