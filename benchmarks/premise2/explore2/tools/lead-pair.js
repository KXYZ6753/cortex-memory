// Round 6, lead: paired comparison of two arms on development sets (J1, design-weighted).
//   node benchmarks/premise2/explore2/tools/lead-pair.js <A variant@version[|alias]> <B variant@version[|alias]> <set,set,...> [--by step]
// Weighted = missShare·miss + (1 − missShare)·hit per set stratum, pooled over questions.
// Intervals: B = 10,000 (tools/rng.js mulberry32, seed 20260922), question-stratified paired
// bootstrap (within set × stratum) and mailbox-cluster bootstrap. Flips +fixed/−broken by
// stratum and by A's `step` field. Refuses H6-C, DEMO and anything not a registered set.
import { createReadStream, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const [aArg, bArg, setsArg, ...rest] = process.argv.slice(2)
const allowH6C = rest.includes("--allow-h6c")
const SETS = setsArg.split(",")
for (const s of SETS) if (/^DEMO/.test(s) || (s === "H6-C" && !allowH6C)) throw new Error(`${s} is not allowed here`)
const parseArm = (s) => { const [vv, alias = "small"] = s.split("|"); const [variant, version] = vv.split("@"); return { variant, version, alias } }
const A = parseArm(aArg), B = parseArm(bArg)
const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const setKeys = new Map(SETS.map((s) => [s, new Set(loadSet(dataDir, s, pool).questionKeys)]))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {}
}
const match = (r, arm) => r.variant === arm.variant && r.version === arm.version && r.alias === arm.alias
const latest = { A: new Map(), B: new Map() }
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    const m = line.match(/"set":"([^"]+)"/)
    if (!m || !setKeys.has(m[1])) continue
    const r = JSON.parse(line)
    if (!FINAL_STATUSES.has(r.status) || !setKeys.get(r.set).has(r.questionKey)) continue
    for (const [k, arm] of [["A", A], ["B", B]]) if (match(r, arm)) latest[k].set(`${r.set}|${r.questionKey}`, r)
}
const score = (r) => {
    if (preGrade(r)) return 0
    const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}
const items = []
for (const [k, a] of latest.A) {
    const b = latest.B.get(k)
    if (!b) continue
    const sa = score(a), sb = score(b)
    if (sa === null || sb === null) continue
    const rec = pool.byKey.get(a.questionKey)
    items.push({ set: a.set, stratum: rec.stratum, user: rec.user, a: sa, b: sb, step: a.step ?? "–", same: a.answer === b.answer, wa: a.wallMs, wb: b.wallMs, ca: a.calls - (a.det?.resets ?? 0), cb: b.calls - (b.det?.resets ?? 0) })
}
const w = (s) => (s === "miss" ? missShare : 1 - missShare)
// Weighted Δ: per stratum mean difference, weighted (strata missing in the pool of items drop out).
function weightedDelta(list) {
    const strata = ["miss", "hit"].filter((s) => list.some((i) => i.stratum === s))
    const tw = strata.reduce((t, s) => t + w(s), 0)
    let d = 0, ma = 0, mb = 0
    for (const s of strata) {
        const xs = list.filter((i) => i.stratum === s)
        const da = xs.reduce((t, i) => t + i.a, 0) / xs.length, db = xs.reduce((t, i) => t + i.b, 0) / xs.length
        d += (w(s) / tw) * (da - db); ma += (w(s) / tw) * da; mb += (w(s) / tw) * db
    }
    return { d, ma, mb }
}
const f = (x) => (100 * x).toFixed(2)
const base = weightedDelta(items)
const rnd = mulberry32(20260922)
const groups = new Map()
for (const i of items) { const g = `${i.set}|${i.stratum}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i) }
const boots = []
for (let b = 0; b < BOOT_B; b++) {
    const sample = []
    for (const g of groups.values()) for (let j = 0; j < g.length; j++) sample.push(g[Math.floor(rnd() * g.length)])
    boots.push(weightedDelta(sample).d)
}
boots.sort((x, y) => x - y)
const users = [...new Set(items.map((i) => i.user))]
const byUser = new Map(users.map((u) => [u, items.filter((i) => i.user === u)]))
const cboots = []
for (let b = 0; b < BOOT_B; b++) {
    const sample = []
    for (let j = 0; j < users.length; j++) sample.push(...byUser.get(users[Math.floor(rnd() * users.length)]))
    cboots.push(weightedDelta(sample).d)
}
cboots.sort((x, y) => x - y)
const perm = []
const disc = items.filter((i) => i.a !== i.b)
for (let b = 0; b < BOOT_B; b++) {
    const flipped = items.map((i) => (i.a !== i.b && rnd() < 0.5 ? { ...i, a: i.b, b: i.a } : i))
    perm.push(Math.abs(weightedDelta(flipped).d))
}
const p = perm.filter((x) => x >= Math.abs(base.d) - 1e-12).length / BOOT_B
const mean = (xs) => xs.reduce((t, x) => t + x, 0) / Math.max(xs.length, 1)
console.log(`A = ${aArg}, B = ${bArg}; sets ${SETS.join(",")}; ${items.length} paired questions (${items.filter((i) => i.stratum === "miss").length} miss)`)
console.log(`weighted A ${f(base.ma)}  B ${f(base.mb)}  Δ ${f(base.d)}  question-stratified [${f(pctSorted(boots, 0.025))}, ${f(pctSorted(boots, 0.975))}]  mailbox-cluster [${f(pctSorted(cboots, 0.025))}, ${f(pctSorted(cboots, 0.975))}]  sign-flip p ${p.toFixed(3)}`)
for (const s of ["miss", "hit"]) {
    const xs = items.filter((i) => i.stratum === s)
    if (!xs.length) continue
    console.log(`  ${s}: n ${xs.length}  A ${f(mean(xs.map((i) => i.a)))}  B ${f(mean(xs.map((i) => i.b)))}  flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}  identical texts ${xs.filter((i) => i.same).length}`)
}
for (const set of SETS) {
    const xs = items.filter((i) => i.set === set)
    if (!xs.length) continue
    const d = weightedDelta(xs)
    console.log(`  ${set}: n ${xs.length}  A ${f(d.ma)}  B ${f(d.mb)}  Δ ${f(d.d)}  flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}`)
}
const steps = [...new Set(items.map((i) => i.step))]
for (const st of steps) {
    const xs = items.filter((i) => i.step === st)
    const h = xs.filter((i) => i.stratum === "hit"), mi = xs.filter((i) => i.stratum === "miss")
    console.log(`  step ${st}: n ${xs.length}  hits +${h.filter((i) => i.a > i.b).length}/−${h.filter((i) => i.a < i.b).length} (A ${h.reduce((t, i) => t + i.a, 0)}/${h.length})  misses +${mi.filter((i) => i.a > i.b).length}/−${mi.filter((i) => i.a < i.b).length} (A ${mi.reduce((t, i) => t + i.a, 0)}/${mi.length})`)
}
console.log(`  wall ms A ${Math.round(mean(items.map((i) => i.wa)))}  B ${Math.round(mean(items.map((i) => i.wb)))};  real calls A ${mean(items.map((i) => i.ca)).toFixed(2)}  B ${mean(items.map((i) => i.cb)).toFixed(2)}`)
