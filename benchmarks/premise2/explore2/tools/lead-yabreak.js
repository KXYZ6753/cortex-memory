// Round 6, lead: lead-ya vs i-det-gates on hits, split by what the YES email is (gold path,
// twin/near-duplicate, other email) and by the sure/doubted YES logprob. Development sets only.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const SETS = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3").split(",")
const variant = process.argv[3] ?? "lead-ya"
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const keys = new Set(SETS.flatMap((s) => loadSet(dataDir, s, pool).questionKeys.map((k) => `${s}|${k}`)))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) { if (!line) continue; try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {} }
const arms = { ya: new Map(), g: new Map(), o: new Map(), q1: new Map() }
for (const line of readFileSync(join(dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
    if (!line || !(line.includes(`"${variant}"`) || line.includes("i-det-gates") || line.includes("q8-det-oracle") || line.includes("q-det-q1"))) continue
    const r = JSON.parse(line)
    const k = `${r.set}|${r.questionKey}`
    if (!keys.has(k) || !FINAL_STATUSES.has(r.status) || r.alias !== "small") continue
    if (r.variant === variant) arms.ya.set(k, r)
    else if (r.variant === "i-det-gates" && r.version === "2+cold") arms.g.set(k, r)
    else if (r.variant === "q8-det-oracle") arms.o.set(k, r)
    else if (r.variant === "q-det-q1") arms.q1.set(k, r)
}
const sc = (r) => { if (!r) return null; if (preGrade(r)) return 0; const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const cells = {}
for (const [k, a] of arms.ya) {
    const rec = pool.byKey.get(a.questionKey)
    if (rec.stratum !== "hit") continue
    const g = sc(arms.g.get(k)), y = sc(a), o = sc(arms.o.get(k))
    if (g === null || y === null) continue
    const twins = new Set([...(rec.twins ?? []), ...(rec.nearDups ?? [])])
    const q1checks = (arms.q1.get(k)?.log ?? []).filter((e) => e.act === "check")
    const q1yes = q1checks.find((e) => e.yes)?.path ?? null
    const what = a.step !== "yes-alone" ? a.step : a.yesPath === rec.path ? "YES=gold" : twins.has(a.yesPath) ? "YES=twin" : "YES=other"
    const sure = a.yesLp == null ? "" : a.yesLp >= -0.1 ? " sure" : " doubted"
    const agree = a.yesPath === q1yes ? "" : " (q1 YES differs)"
    const c = (cells[what + sure + agree] ??= { n: 0, g: 0, y: 0, o: 0, on: 0, plus: 0, minus: 0 })
    c.n++; c.g += g; c.y += y; c.plus += y > g; c.minus += y < g
    if (o !== null) { c.o += o; c.on++ }
}
console.log("cell | n | gates | lead | flips | gold-only (n graded)")
for (const [k, c] of Object.entries(cells).sort()) console.log(`${k} | ${c.n} | ${c.g} | ${c.y} | +${c.plus}/−${c.minus} | ${c.o} (${c.on})`)
