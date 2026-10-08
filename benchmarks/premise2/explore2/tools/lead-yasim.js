// Round 6, lead: exact derivation of lead-yas from lead-ya + i-det-gates (behind det every call
// starts from a reset, so lead-yas issues lead-ya's calls when its first YES is sure and gates'
// calls otherwise; its answers are those texts). Prints the paired table vs i-det-gates.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"
if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const SETS = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3").split(",")
const TAU = Number(process.argv[3] ?? -0.1)
const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const keys = new Set(SETS.flatMap((s) => loadSet(dataDir, s, pool).questionKeys.map((k) => `${s}|${k}`)))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) { if (!line) continue; try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {} }
const ya = new Map(), g = new Map()
for (const line of readFileSync(join(dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
    if (!line || !(line.includes("\"lead-ya") || line.includes("\"i-det-gates\""))) continue
    const r = JSON.parse(line); const k = `${r.set}|${r.questionKey}`
    if (!keys.has(k) || !FINAL_STATUSES.has(r.status) || r.alias !== "small") continue
    if (r.variant === "lead-ya" && !ya.has(k)) ya.set(k, r); else if (r.variant === "lead-yas") ya.set(k, { ...r, fromYas: true }); else if (r.variant === "i-det-gates" && r.version === "2+cold") g.set(k, r)
}
const sc = (r) => { if (preGrade(r)) return 0; const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const items = []
for (const [k, a] of ya) {
    const b = g.get(k); if (!b) continue
    const useYa = a.step === "yes-alone" && (a.yesLp ?? -Infinity) >= TAU
    const sa = sc(useYa ? a : b), sb = sc(b)
    if (sa === null || sb === null) continue
    const rec = pool.byKey.get(a.questionKey)
    items.push({ set: a.set, stratum: rec.stratum, user: rec.user, a: sa, b: sb })
}
const wd = (list) => { let d = 0; for (const s of ["miss", "hit"]) { const xs = list.filter((i) => i.stratum === s); if (!xs.length) continue; d += (s === "miss" ? missShare : 1 - missShare) * xs.reduce((t, i) => t + i.a - i.b, 0) / xs.length } return d }
const rnd = mulberry32(20260922)
const groups = new Map(); for (const i of items) { const k = `${i.set}|${i.stratum}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i) }
const boots = []; for (let b = 0; b < BOOT_B; b++) { const s = []; for (const gr of groups.values()) for (let j = 0; j < gr.length; j++) s.push(gr[Math.floor(rnd() * gr.length)]); boots.push(wd(s)) }
boots.sort((x, y) => x - y)
const f = (x) => (100 * x).toFixed(2)
console.log(`lead-yas (tau ${TAU}, derived) − i-det-gates on ${SETS.join(",")}: Δ ${f(wd(items))} [${f(pctSorted(boots, 0.025))}, ${f(pctSorted(boots, 0.975))}]`)
for (const s of ["miss", "hit"]) { const xs = items.filter((i) => i.stratum === s); console.log(`  ${s}: n ${xs.length} flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}`) }
for (const set of SETS) { const xs = items.filter((i) => i.set === set); console.log(`  ${set}: Δ ${f(wd(xs))} flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}`) }
