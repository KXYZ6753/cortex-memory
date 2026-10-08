// Round 6, lead: features of lead-ya's YES commits (rank in W0, YES logprob, NO logprob,
// answer agreement with gates) by what the YES email is. Screening sets only.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const SETS = ["S300-4", "S300-5", "FULL-2", "FULL-3"]
const pool = loadPool(dataDir); const judge = judgeConfig("j1")
const keys = new Set(SETS.flatMap((s) => loadSet(dataDir, s, pool).questionKeys.map((k) => `${s}|${k}`)))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) { if (!line) continue; try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {} }
const ya = new Map(), g = new Map()
for (const line of readFileSync(join(dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
    if (!line || !(line.includes('"lead-ya"') || line.includes('"i-det-gates"'))) continue
    const r = JSON.parse(line); const k = `${r.set}|${r.questionKey}`
    if (!keys.has(k) || r.alias !== "small") continue
    if (r.variant === "lead-ya") ya.set(k, r); else if (r.version === "2+cold") g.set(k, r)
}
const sc = (r) => { if (preGrade(r)) return 0; const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const tok = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) ?? [])
const f1 = (a, b) => { const A = tok(a), B = tok(b); if (!A.size || !B.size) return 0; let i = 0; for (const t of A) if (B.has(t)) i++; return i ? (2 * i) / (A.size + B.size) : 0 }
const rows = []
for (const [k, a] of ya) {
    if (a.step !== "yes-alone") continue
    const b = g.get(k); if (!b) continue
    const rec = pool.byKey.get(a.questionKey)
    const twins = new Set([rec.path, ...(rec.twins ?? []), ...(rec.nearDups ?? [])])
    const checks = a.log.filter((e) => e.act === "check")
    const rank = checks.length - 1
    const yes = checks[rank]
    rows.push({ stratum: rec.stratum, gold: twins.has(a.yesPath), rank, yesLp: yes.yesLp, noLp: yes.noLp, agree: f1(a.answer, b.answer), ya: sc(a), g: sc(b), sure: (yes.yesLp ?? -9) >= -0.1, gatesTop: b.contextPaths?.[0] === a.yesPath })
}
const show = (label, xs) => console.log(`${label}: n ${xs.length} gold ${xs.filter((r) => r.gold).length}  ya ${xs.reduce((t, r) => t + r.ya, 0)}  gates ${xs.reduce((t, r) => t + r.g, 0)}  net ${xs.reduce((t, r) => t + r.ya - r.g, 0)}`)
for (const stratum of ["hit", "miss"]) {
    console.log(`== ${stratum}`)
    const xs = rows.filter((r) => r.stratum === stratum)
    for (const sure of [true, false]) {
        const ys = xs.filter((r) => r.sure === sure)
        show(`${sure ? "sure" : "doubted"}`, ys)
        for (const rank of [0, 1, 2, 3, 4]) show(`   rank ${rank}`, ys.filter((r) => r.rank === rank))
        if (!sure) for (const [lo, hi] of [[-0.7, -0.1], [-1.5, -0.7], [-99, -1.5]]) show(`   yesLp [${lo}, ${hi})`, ys.filter((r) => r.yesLp >= lo && r.yesLp < hi))
        for (const [lo, hi] of [[0.8, 1.01], [0.4, 0.8], [0, 0.4]]) show(`   agree F1 [${lo}, ${hi})`, ys.filter((r) => r.agree >= lo && r.agree < hi))
    }
}
