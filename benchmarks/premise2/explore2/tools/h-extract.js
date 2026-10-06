// Worker h (round 4): is m-diag's single-email EXTRACT read (email-first prompt, one
// sentence, own logprobs; logged for every YES email of S300-1/S300-2) a usable third
// reading on x1's handover path? Grades the extract of the first YES email with J1
// (printed/cached in <scratch>, NOT written to verdicts.jsonl) and simulates policies
// against j2 from stored answers (h-handover.json rows).
//   node benchmarks/premise2/explore2/tools/h-extract.js <h-handover.json> <cache.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { judgeConfig, referenceVerdict, preGrade } from "../../judge.js"
import { referencesOf } from "../../explore/grade.js"
import { loadPool } from "../../explore/pool.js"
import { novelAnswerWords } from "../../text.js"
import { HEDGE } from "../variants/n-conf.js"
import { vagueAnswer } from "../variants/h-spec.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const [rowsFile, cacheFile] = process.argv.slice(2)
const rows = JSON.parse(readFileSync(rowsFile, "utf8"))
const pool = loadPool(".data/premise2")
const judge = judgeConfig("j1")
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {}
const firstYes = (r) => r.probes.find((p) => p.yes)?.path
const extractOf = (r) => r.extracts.find((e) => e.path === firstYes(r)) ?? null
const todo = rows.filter((r) => { const e = extractOf(r); return e && !e.abstain && cache[`${r.key}|${e.answer}`] === undefined })
let i = 0
async function worker() {
    while (i < todo.length) {
        const r = todo[i++]
        const e = extractOf(r)
        const rec = pool.byKey.get(r.key)
        if (preGrade({ answer: e.answer, status: "ok" })) { cache[`${r.key}|${e.answer}`] = 0; continue }
        try {
            const v = await referenceVerdict(judge, { question: rec.question, references: referencesOf(rec), candidate: e.answer })
            cache[`${r.key}|${e.answer}`] = v.verdict === "CORRECT" ? 1 : v.verdict === "INCORRECT" ? 0 : null
        } catch (err) { console.error(String(err).slice(0, 200)) }
    }
}
await Promise.all(Array.from({ length: 8 }, worker))
writeFileSync(cacheFile, JSON.stringify(cache))
const E = (r) => { const e = extractOf(r); if (!e) return null; return { ...e, v: e.abstain ? 0 : cache[`${r.key}|${e.answer}`] ?? null } }
const jac = (a, b, q) => { const A = new Set(novelAnswerWords([a ?? ""], q)), B = new Set(novelAnswerWords([b ?? ""], q)); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / (A.size + B.size - n) }
const tally = (name, f) => {
    const t = {}
    for (const r of rows) { const k = `${r.set} ${r.s}`; t[k] ??= [0, 0, 0]; const v = f(r); t[k][0]++; if (v == null) t[k][2]++; else t[k][1] += v }
    console.log(name.padEnd(34), Object.entries(t).sort().map(([k, [n, ok, unk]]) => `${k} ${ok}/${n}${unk ? ` (unk ${unk})` : ""}`).join(" | "))
}
tally("x1", (r) => r.x1)
tally("j2", (r) => r.j2)
tally("E (extract of first YES) always", (r) => E(r)?.v ?? r.x1)
tally("S (single read) always = j1-ish", (r) => r.singleV ?? r.x1)
for (const tau of [-0.05, -0.1, -0.15]) tally(`j2; S unsure -> E if E.mean>=${tau}`, (r) => { if (r.j2step === "commit-single") return r.j2; const e = E(r); return e && !e.abstain && !HEDGE.test(e.answer) && e.mean >= tau ? e.v : r.j2 })
tally("j2; S unsure -> E if E~S (jac>=.5)", (r) => { if (r.j2step === "commit-single") return r.j2; const e = E(r); return e && !e.abstain && r.single && jac(e.answer, r.single, r.q) >= 0.5 ? e.v : r.j2 })
tally("j2; final vague -> E if E not vague", (r) => { const e = E(r); return vagueAnswer(r.j2step === "commit-single" ? r.single : r.g5A) && e && !e.abstain && !vagueAnswer(e.answer) ? e.v : r.j2 })
// where E differs from j2 in correctness
const d = {}
for (const r of rows) { const e = E(r); if (!e || e.v == null || r.j2 == null) continue; const k = `${r.s} ${r.j2step} E${e.v} j2${r.j2} Emean${e.mean >= -0.1 ? ">=-.1" : "<-.1"}`; d[k] = (d[k] ?? 0) + 1 }
for (const [k, n] of Object.entries(d).sort()) console.log(" ", k, n)
process.exit(0)
