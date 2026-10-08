// Worker q8 (round 6): paired Q8_0 vs Q4_0 (QAT) tables for the precision diagnostic.
//
//   node benchmarks/premise2/explore2/tools/q8-table.js [--sets FULL-2,FULL-3,S300-4,S300-5] [--json out.json] [--dump flips.jsonl]
//
// Development sets only (refuses H6-C, DEMO, TEST). Only verdicts of the chosen sets'
// questions are read. (Pool questionKeys "test:..." name the EnronQA dataset split, not the
// study TEST; they are kept.) J1 verdicts joined as explore/analyze.js does (preGrade, then
// answerVerdictKey with judgeConfig("j1")). Arms are (variant@version, alias); the latest final
// answer per answer key. Contrasts are paired per question, on questions graded in both
// arms, with 95% intervals from B = 10,000 resamples (tools/rng.js mulberry32): a
// question-stratified paired bootstrap (within hit and within miss) and a mailbox-cluster
// bootstrap (mailboxes resampled; pooled sets share mailboxes as clusters). Flips: +fixed
// (B wrong -> A right) and -broken; exact two-sided sign test on the discordant pairs.

import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const SETS = opt("sets", "FULL-2,FULL-3,S300-4,S300-5").split(",")
for (const s of SETS) if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(s)) throw new Error(`${s} is not a development set`)
const jsonOut = opt("json", null)
const dumpOut = opt("dump", null)

export const ARMS = {
    "Q4 oracle": { variant: "q8-det-oracle", version: "1+cold", alias: "small" },
    "Q8 oracle": { variant: "q8-det-oracle", version: "1+cold", alias: "small-q8" },
    "Q4 a6-oracle": { variant: "a6-det-oracle", version: "1+cold", alias: "small" },
    "Q4 p6-g0": { variant: "p6-g0", version: "1+cold", alias: "small" },
    "Q4 gates": { variant: "i-det-gates", version: "2+cold", alias: "small" },
    "Q4 q8-gates": { variant: "q8-det-gates", version: "1+cold", alias: "small" },
    "Q8 gates": { variant: "q8-det-gates", version: "1+cold", alias: "small-q8" },
}

const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const setKeys = new Map(SETS.map((s) => [s, new Set(loadSet(dataDir, s, pool).questionKeys)]))
const allKeys = new Set([...setKeys.values()].flatMap((keys) => [...keys]))

const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.verdict && allKeys.has(e.questionKey)) verdicts.set(e.vkey, e)
}

const armOf = new Map(Object.entries(ARMS).map(([label, a]) => [`${a.variant}@${a.version}|${a.alias}`, label]))
const latest = new Map()
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    if (!line) continue
    const setMatch = line.match(/"set":"([^"]+)"/)
    if (!setMatch || !setKeys.has(setMatch[1])) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!armOf.has(`${r.variant}@${r.version}|${r.alias}`)) continue
    if (!FINAL_STATUSES.has(r.status) || !setKeys.get(r.set).has(r.questionKey)) continue
    latest.set(r.key, r)
}
const data = new Map(Object.keys(ARMS).map((label) => [label, new Map()]))
for (const r of latest.values()) {
    const label = armOf.get(`${r.variant}@${r.version}|${r.alias}`)
    const record = pool.byKey.get(r.questionKey)
    let correct = null
    if (preGrade(r)) correct = 0
    else {
        const v = verdicts.get(answerVerdictKey(r, record, judge))
        if (v) correct = v.verdict === "CORRECT" ? 1 : 0
    }
    data.get(label).set(`${r.set}|${r.questionKey}`, {
        set: r.set, questionKey: r.questionKey, stratum: record.stratum, user: record.user, correct, answer: r.answer, status: r.status,
        wallMs: r.wallMs, calls: r.calls, resets: r.det?.resets ?? 0, resetMs: r.det?.resetMs ?? 0, genMs: r.genMs,
        promptTokens: r.promptTokens, outputTokens: r.outputTokens, switched: r.switched ?? null, used: r.used ?? null, digest: r.digest,
    })
}

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const f1 = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) : "–")
const sgn = (x) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}` : "–")
const ci = ([lo, hi]) => `[${sgn(lo)}, ${sgn(hi)}]`

function armRow(label, sets) {
    const items = [...data.get(label).values()].filter((i) => sets.includes(i.set))
    const graded = items.filter((i) => i.correct !== null)
    const byS = (s) => graded.filter((i) => i.stratum === s)
    const miss = mean(byS("miss").map((i) => i.correct))
    const hit = mean(byS("hit").map((i) => i.correct))
    return {
        label, n: items.length, graded: graded.length, nMiss: byS("miss").length, nHit: byS("hit").length,
        weighted: byS("miss").length ? missShare * miss + (1 - missShare) * hit : NaN, miss, hit,
        wallMs: mean(items.map((i) => i.wallMs)), wallNoResetMs: mean(items.map((i) => i.wallMs - i.resetMs)),
        calls: mean(items.map((i) => i.calls - i.resets)), resets: mean(items.map((i) => i.resets)),
        promptTokens: mean(items.map((i) => i.promptTokens)), outputTokens: mean(items.map((i) => i.outputTokens)),
    }
}

// Exact two-sided sign test (binomial p = 0.5) on b fixed vs c broken.
function signTest(b, c) {
    const n = b + c
    if (!n) return 1
    const k = Math.min(b, c)
    let logC = 0
    let tail = 0
    for (let i = 0; i <= n; i++) {
        if (i > 0) logC += Math.log(n - i + 1) - Math.log(i)
        if (i <= k) tail += Math.exp(logC - n * Math.LN2)
    }
    return Math.min(1, 2 * tail)
}

// Paired contrast A − B: weighted (if misses), miss, hit; flips; identical answer texts.
function contrast(a, b, sets, { seed = 8008, B = BOOT_B } = {}) {
    const keys = [...data.get(a).keys()].filter((k) => sets.includes(k.split("|")[0]) && data.get(a).get(k)?.correct != null && data.get(b).get(k)?.correct != null)
    const items = keys.map((k) => {
        const x = data.get(a).get(k)
        const y = data.get(b).get(k)
        return { key: k, stratum: x.stratum, user: x.user, d: x.correct - y.correct, same: x.answer === y.answer, switched: y.switched, xa: x, ya: y }
    })
    const miss = items.filter((i) => i.stratum === "miss").map((i) => i.d)
    const hit = items.filter((i) => i.stratum === "hit").map((i) => i.d)
    const W = (m, h) => (miss.length ? missShare * m + (1 - missShare) * h : h)
    const est = { weighted: W(mean(miss), mean(hit)), miss: mean(miss), hit: mean(hit) }
    const rnd = mulberry32(seed)
    const qW = [], qH = [], qM = []
    for (let r = 0; r < B; r++) {
        let sm = 0, sh = 0
        for (let i = 0; i < miss.length; i++) sm += miss[Math.floor(rnd() * miss.length)]
        for (let i = 0; i < hit.length; i++) sh += hit[Math.floor(rnd() * hit.length)]
        const m = miss.length ? sm / miss.length : 0
        const h = hit.length ? sh / hit.length : 0
        qW.push(W(m, h)); qH.push(h); if (miss.length) qM.push(m)
    }
    const byUser = new Map()
    for (const i of items) { const g = byUser.get(i.user) ?? { m: [], h: [] }; (i.stratum === "miss" ? g.m : g.h).push(i.d); byUser.set(i.user, g) }
    const groups = [...byUser.values()]
    const rnd2 = mulberry32(seed + 1)
    const cW = [], cH = []
    for (let r = 0; r < B; r++) {
        let sm = 0, nm = 0, sh = 0, nh = 0
        for (let g = 0; g < groups.length; g++) {
            const grp = groups[Math.floor(rnd2() * groups.length)]
            for (const d of grp.m) { sm += d; nm++ }
            for (const d of grp.h) { sh += d; nh++ }
        }
        const h = nh ? sh / nh : 0
        const m = nm ? sm / nm : 0
        cW.push(W(m, h)); cH.push(h)
    }
    for (const arr of [qW, qH, qM, cW, cH]) arr.sort((x, y) => x - y)
    const iv = (arr) => (arr.length ? [pctSorted(arr, 0.025), pctSorted(arr, 0.975)] : [NaN, NaN])
    const flips = (stratum) => {
        const s = items.filter((i) => !stratum || i.stratum === stratum)
        const fixed = s.filter((i) => i.d === 1).length
        const broken = s.filter((i) => i.d === -1).length
        return { n: s.length, fixed, broken, p: signTest(fixed, broken), sameText: s.filter((i) => i.same).length }
    }
    return {
        a, b, n: items.length, nHit: hit.length, nMiss: miss.length, users: groups.length, ...est,
        ciQ: { weighted: iv(qW), hit: iv(qH), miss: iv(qM) }, ciC: { weighted: iv(cW), hit: iv(cH) },
        flips: { all: flips(null), hit: flips("hit"), miss: flips("miss") }, items,
    }
}

const out = { sets: SETS, at: new Date().toISOString(), arms: {}, contrasts: {} }
const lines = []
const P = (s = "") => lines.push(s)

P(`Sets: ${SETS.join(", ")} (development). J1. Intervals: question-stratified paired bootstrap and mailbox-cluster bootstrap, B = ${BOOT_B}, mulberry32.`)
P("")
P("| arm | set | n | graded | hit | miss | weighted | wall ms | wall − resets | calls | resets | prompt tok | out tok |")
P("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const label of Object.keys(ARMS)) {
    if (!data.get(label).size) continue
    for (const sets of [...SETS.map((s) => [s]), SETS]) {
        const row = armRow(label, sets)
        if (!row.n) continue
        const name = sets.length > 1 ? "pooled" : sets[0]
        out.arms[`${label}|${name}`] = row
        P(`| ${label} | ${name} | ${row.n} | ${row.graded} | ${f1(row.hit)} | ${f1(row.miss)} | ${f1(row.weighted)} | ${Math.round(row.wallMs)} | ${Math.round(row.wallNoResetMs)} | ${row.calls.toFixed(2)} | ${row.resets.toFixed(2)} | ${Math.round(row.promptTokens)} | ${Math.round(row.outputTokens)} |`)
    }
}

const PAIRS = [["Q8 oracle", "Q4 oracle"], ["Q4 oracle", "Q4 a6-oracle"], ["Q4 oracle", "Q4 p6-g0"], ["Q8 gates", "Q4 gates"], ["Q8 gates", "Q4 q8-gates"], ["Q4 q8-gates", "Q4 gates"], ["Q8 oracle", "Q4 gates"], ["Q4 oracle", "Q4 gates"]]
P("")
P("Paired contrasts (A − B, points). Flips: +fixed (B wrong, A right) / −broken; p = exact sign test; same = byte-identical answer texts.")
P("")
P("| A − B | sets | n (hit/miss) | Δ hit [q-strat] [mailbox] | Δ miss [q-strat] | Δ weighted [q-strat] [mailbox] | hit flips +/− (p) | miss flips +/− | same text |")
P("|---|---|---|---|---|---|---|---|---|")
for (const [a, b] of PAIRS) {
    if (!data.get(a).size || !data.get(b).size) continue
    for (const sets of [SETS, ...SETS.map((s) => [s])]) {
        const c = contrast(a, b, sets)
        if (!c.n) continue
        const name = sets.length > 1 ? "pooled" : sets[0]
        const { items, ...rest } = c
        out.contrasts[`${a} − ${b}|${name}`] = rest
        const fh = c.flips.hit, fm = c.flips.miss
        P(`| ${a} − ${b} | ${name} | ${c.n} (${c.nHit}/${c.nMiss}) | ${sgn(c.hit)} ${ci(c.ciQ.hit)} ${ci(c.ciC.hit)} | ${c.nMiss ? `${sgn(c.miss)} ${ci(c.ciQ.miss)}` : "–"} | ${c.nMiss ? `${sgn(c.weighted)} ${ci(c.ciQ.weighted)} ${ci(c.ciC.weighted)}` : "–"} | +${fh.fixed}/−${fh.broken} (${fh.p.toFixed(3)}) | ${c.nMiss ? `+${fm.fixed}/−${fm.broken}` : "–"} | ${c.flips.all.sameText}/${c.n} |`)
        if (dumpOut && sets.length > 1 && a.startsWith("Q8")) {
            for (const i of items.filter((x) => x.d !== 0)) {
                const record = pool.byKey.get(i.xa.questionKey)
                appendLine(dumpOut, { pair: `${a} − ${b}`, set: i.xa.set, questionKey: i.xa.questionKey, stratum: i.stratum, d: i.d, question: record.question, gold: record.gold, a: i.xa.answer, b: i.ya.answer })
            }
        }
    }
}

// Gates flips by path (switched / retry used), when both gates arms exist.
for (const [a, b] of [["Q8 gates", "Q4 gates"]]) {
    if (!data.get(a).size || !data.get(b).size) continue
    const c = contrast(a, b, SETS)
    P("")
    P(`${a} − ${b} flips by path (B's path; pooled):`)
    const paths = new Map()
    for (const i of c.items) {
        const path = `${i.stratum} ${i.ya.switched ? "switched" : "global"}${(i.ya.used ?? 1) > 1 ? "+retry" : ""}`
        const e = paths.get(path) ?? { n: 0, fixed: 0, broken: 0 }
        e.n++; if (i.d === 1) e.fixed++; if (i.d === -1) e.broken++
        paths.set(path, e)
    }
    for (const [path, e] of [...paths].sort()) P(`- ${path}: n ${e.n}, +${e.fixed} / −${e.broken}`)
}

function appendLine(path, obj) {
    writeFileSync(path, JSON.stringify(obj) + "\n", { flag: "a" })
}

console.log(lines.join("\n"))
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2))
