// Offline (no GPU): analyse wprobe answers (single-email sandwich answers per candidate).
// Single-email abstention on answer-bearing vs other emails, and pick rules simulated with
// a proxy: a single-email answer counts right iff its email is answer-bearing (gold, twin,
// or evidence-matched) and it is not an abstention; gates' own answer uses its J1 verdict.
// node benchmarks/premise2/explore2/tools/w-probe.js S100-0 wprobe
process.loadEnvFile(".env")
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { EvidenceCache } from "../../evidence.js"
import { ensureEmailStore } from "../../agent-run.js"
const dataDir = ".data/premise2"
const [setName = "S100-0", variant = "wprobe"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const evidence = new EvidenceCache({ get: emails.emailOf })
const rows = latestAnswers(dataDir).filter((a) => a.set === setName && a.variant === variant && a.singles)
const t = {}
const add = (k, v = 1) => (t[k] = (t[k] ?? 0) + v)
const rules = {}
const score = (name, stratum, v, ms) => { rules[name] ??= { miss: [], hit: [], ms: [] }; rules[name][stratum].push(v); rules[name].ms.push(ms) }
for (const a of rows) {
    const r = pool.byKey.get(a.questionKey)
    const ab = (p) => p === r.path || (r.twins ?? []).includes(p) || evidence.answerBearing(p, r) === true
    const pre = preGrade(a)
    const v = pre ? 0 : verdicts.get(answerVerdictKey(a, r, judge))
    const gatesOk = pre ? 0 : v ? (v.verdict === "CORRECT" ? 1 : 0) : null
    const gatesMs = a.wallMs - a.singles.reduce((s, x) => s + x.ms, 0)
    a.singles.forEach((s, i) => {
        const kind = ab(s.path) ? "bearing" : "other"
        add(`${kind} n`); if (s.abstain) add(`${kind} abstain`)
        add(`${kind} pos${i < 5 ? i : "5-9"} n`); if (s.abstain) add(`${kind} pos${i < 5 ? i : "5-9"} abstain`)
        add("ms", s.ms); add("calls")
    })
    const proxy = (s) => (s && !s.abstain && ab(s.path) ? 1 : 0)
    if (gatesOk !== null) score("gates (J1)", r.stratum, gatesOk, gatesMs)
    const firstNon = (n) => { let ms = 0; for (const s of a.singles.slice(0, n)) { ms += s.ms; if (!s.abstain) return { s, ms } } return { s: null, ms } }
    for (const n of [1, 2, 3, 5, 10]) {
        const { s, ms } = firstNon(n)
        score(`first non-abstain of ${n}, else gates`, r.stratum, s ? proxy(s) : gatesOk ?? 0, ms + (s ? 0 : gatesMs))
    }
    score("gold-bearing among 10 any (upper)", r.stratum, a.singles.some((s) => proxy(s)) ? 1 : 0, 0)
    add(`gates correct=${gatesOk} top1-single proxy=${proxy(a.singles[0])} top1abst=${a.singles[0]?.abstain}`)
}
console.log(`${rows.length} questions; mean single-call ms ${(t.ms / t.calls).toFixed(0)}`)
for (const kind of ["bearing", "other"]) {
    console.log(`${kind}: abstain ${t[`${kind} abstain`] ?? 0}/${t[`${kind} n`]} ; by pos ` + ["pos0", "pos1", "pos2", "pos3", "pos4", "pos5-9"].map((p) => `${p} ${t[`${kind} ${p} abstain`] ?? 0}/${t[`${kind} ${p} n`] ?? 0}`).join(", "))
}
const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
for (const [name, x] of Object.entries(rules)) console.log(`${name}: weighted ${(100 * (missShare * mean(x.miss) + (1 - missShare) * mean(x.hit))).toFixed(1)} miss ${(100 * mean(x.miss)).toFixed(1)} (${x.miss.length}) hit ${(100 * mean(x.hit)).toFixed(1)} (${x.hit.length}) ms ${mean(x.ms).toFixed(0)}`)
console.log(Object.entries(t).filter(([k]) => k.startsWith("gates")).sort().map((e) => e.join(": ")).join("\n"))
emails.close()
