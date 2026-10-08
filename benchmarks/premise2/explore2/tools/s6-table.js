// Worker s6: paired scale-control tables (e2b vs e4b, and 31b P-B where it exists).
//
//   node benchmarks/premise2/explore2/tools/s6-table.js [--sets FULL-0,FULL-1] [--json out.json]
//
// Development sets only (refuses H6-C, DEMO, TEST); only verdicts of questions in the chosen
// development sets are kept. (Pool questionKeys "test:..." name the EnronQA dataset split, not
// the study TEST; the pool guard already excludes every study TEST email.)
// Accuracy: J1 (explore/grade.js verdict keys), design-weighted 0.068 x miss + 0.932 x hit. Arms are (variant@version, alias); latest final answer per
// (digest, variant@version, question). Contrasts are per-question linear combinations of arm
// correctness on questions where every arm involved is graded, with two 95% intervals
// (B = 10,000, tools/rng.js mulberry32): question-stratified paired bootstrap (resample
// within miss and within hit) and mailbox-cluster bootstrap (resample mailboxes; pooled sets
// share mailboxes as clusters).

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
const dataDir = ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const SETS = opt("sets", "FULL-0").split(",")
for (const s of SETS) if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(s)) throw new Error(`${s} is not a development set`)
const jsonOut = opt("json", null)

// Arms: label -> { variant, version, alias }
export const ARMS = {
    "e2b pb": { variant: "pb", version: "1", alias: "small" },
    "e2b gates": { variant: "gates", version: "1+cold", alias: "small" },
    "e2b oracles": { variant: "oracles", version: "1+cold", alias: "small" },
    "e2b det-pb": { variant: "s6-det-pb", version: "1+cold", alias: "small" },
    "e2b det-gates": { variant: "s6-det-gates", version: "1+cold", alias: "small" },
    "e2b det-oracles": { variant: "s6-det-oracles", version: "1+cold", alias: "small" },
    "e2b i-det-gates": { variant: "i-det-gates", version: "2+cold", alias: "small" },
    "e4b pb": { variant: "s6-det-pb", version: "1+cold", alias: "mid" },
    "e4b gates": { variant: "s6-det-gates", version: "1+cold", alias: "mid" },
    "e4b oracles": { variant: "s6-det-oracles", version: "1+cold", alias: "mid" },
    "e2b pbs": { variant: "pbs", version: "1+cold", alias: "small" },
    "e2b oracle-T2": { variant: "oracle", version: "1", alias: "small" },
    "e4b pbs": { variant: "s6-det-pbs", version: "1+cold", alias: "mid" },
    "e4b oracle-T2": { variant: "s6-det-oracle", version: "1+cold", alias: "mid" },
    "31b pb": { variant: "pb", version: "1", alias: "large" },
}

const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const setKeys = new Map(SETS.map((s) => [s, new Set(loadSet(dataDir, s, pool).questionKeys)]))

// verdicts of the chosen development sets' questions only
const inSets = (questionKey) => [...setKeys.values()].some((keys) => keys.has(questionKey))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.verdict && inSets(e.questionKey)) verdicts.set(e.vkey, e)
}

// answers: arm -> set -> questionKey -> item
const armOf = new Map(Object.entries(ARMS).map(([label, a]) => [`${a.variant}@${a.version}|${a.alias}`, label]))
const latest = new Map()
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")) })
for await (const line of rl) {
    if (!line) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!setKeys.has(r.set)) continue
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
        set: r.set, questionKey: r.questionKey, stratum: record.stratum, user: record.user, correct,
        wallMs: r.wallMs, calls: r.calls, resetMs: r.det?.resetMs ?? 0, resets: r.det?.resets ?? 0, genMs: r.genMs,
        promptTokens: r.promptTokens, outputTokens: r.outputTokens, switched: r.switched ?? null, used: r.used ?? null, answer: r.answer, status: r.status,
    })
}

// Merged e2b P-B arm: plain pb where it exists (FULL-0, the published round-0 run), else the det
// re-run s6-det-pb (FULL-1). The two sets never overlap, so each question has one e2b P-B answer.
data.set("e2b P-B (pb | det-pb)", new Map([...data.get("e2b det-pb"), ...data.get("e2b pb")]))
ARMS["e2b P-B (pb | det-pb)"] = { merged: true }

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const f1 = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) : "–")
const sgn = (x) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}` : "–")

function armRow(label, sets) {
    const items = [...data.get(label).values()].filter((i) => sets.includes(i.set))
    const graded = items.filter((i) => i.correct !== null)
    const byS = (s) => graded.filter((i) => i.stratum === s)
    const miss = mean(byS("miss").map((i) => i.correct))
    const hit = mean(byS("hit").map((i) => i.correct))
    const wmean = (fn) => missShare * mean(items.filter((i) => i.stratum === "miss").map(fn)) + (1 - missShare) * mean(items.filter((i) => i.stratum === "hit").map(fn))
    return {
        label, n: items.length, graded: graded.length, nMiss: byS("miss").length, nHit: byS("hit").length,
        weighted: missShare * miss + (1 - missShare) * hit, miss, hit,
        wallMs: mean(items.map((i) => i.wallMs)), wallMsW: wmean((i) => i.wallMs), wallNoResetMs: mean(items.map((i) => i.wallMs - i.resetMs)),
        calls: mean(items.map((i) => i.calls - i.resets)), resets: mean(items.map((i) => i.resets)),
        promptTokens: mean(items.map((i) => i.promptTokens)), outputTokens: mean(items.map((i) => i.outputTokens)),
        outputLimit: items.filter((i) => i.status === "output_limit").length, switchedShare: mean(items.filter((i) => i.switched !== null).map((i) => (i.switched ? 1 : 0))),
    }
}

// Contrast: terms [[label, coef], ...]; per question d = sum coef * correct
function contrast(name, terms, sets, { seed = 6060, B = BOOT_B } = {}) {
    const keys = [...data.get(terms[0][0]).keys()].filter((k) => sets.includes(k.split("|")[0]) && terms.every(([l]) => data.get(l).get(k)?.correct != null))
    const items = keys.map((k) => {
        const base = data.get(terms[0][0]).get(k)
        return { stratum: base.stratum, user: base.user, d: terms.reduce((s, [l, c]) => s + c * data.get(l).get(k).correct, 0) }
    })
    const miss = items.filter((i) => i.stratum === "miss").map((i) => i.d)
    const hit = items.filter((i) => i.stratum === "hit").map((i) => i.d)
    const W = (m, h) => (miss.length ? missShare * m + (1 - missShare) * h : h)
    const est = { weighted: W(mean(miss), mean(hit)), miss: mean(miss), hit: mean(hit) }
    // question-stratified
    const rnd = mulberry32(seed)
    const qW = []
    const qH = []
    const qM = []
    for (let b = 0; b < B; b++) {
        let sm = 0
        let sh = 0
        for (let i = 0; i < miss.length; i++) sm += miss[Math.floor(rnd() * miss.length)]
        for (let i = 0; i < hit.length; i++) sh += hit[Math.floor(rnd() * hit.length)]
        const m = miss.length ? sm / miss.length : 0
        const h = sh / hit.length
        qW.push(W(m, h)); qH.push(h); if (miss.length) qM.push(m)
    }
    // mailbox clusters
    const byUser = new Map()
    for (const i of items) { const g = byUser.get(i.user) ?? { m: [], h: [] }; (i.stratum === "miss" ? g.m : g.h).push(i.d); byUser.set(i.user, g) }
    const groups = [...byUser.values()]
    const rnd2 = mulberry32(seed + 1)
    const cW = []
    const cH = []
    for (let b = 0; b < B; b++) {
        let sm = 0, nm = 0, sh = 0, nh = 0
        for (let g = 0; g < groups.length; g++) {
            const G = groups[Math.floor(rnd2() * groups.length)]
            for (const x of G.m) sm += x
            for (const x of G.h) sh += x
            nm += G.m.length; nh += G.h.length
        }
        if (!nh) continue
        const h = sh / nh
        cW.push(nm ? W(sm / nm, h) : h); cH.push(h)
    }
    for (const a of [qW, qH, qM, cW, cH]) a.sort((x, y) => x - y)
    const ci = (a) => (a.length ? [pctSorted(a, 0.025), pctSorted(a, 0.975)] : [NaN, NaN])
    const flips = (list) => ({ plus: list.filter((x) => x > 0).length, minus: list.filter((x) => x < 0).length })
    return {
        name, terms, sets, n: items.length, nMiss: miss.length, nHit: hit.length, ...est,
        ciQ: ci(qW), ciC: ci(cW), ciQhit: ci(qH), ciChit: ci(cH), ciQmiss: ci(qM),
        flipsMiss: flips(miss), flipsHit: flips(hit),
    }
}

const out = { sets: SETS, missShare, at: new Date().toISOString(), arms: {}, contrasts: {} }
const groupsOfSets = [...SETS.map((s) => [s]), ...(SETS.length > 1 ? [SETS] : [])]
const ciTxt = (c) => `[${sgn(c[0])}, ${sgn(c[1])}]`
for (const sets of groupsOfSets) {
    const tag = sets.join("+")
    out.arms[tag] = {}
    console.log(`\n## ${tag}: arms (J1, design-weighted; wall = runner wall incl. det resets; calls exclude det resets)\n`)
    console.log("| arm | n graded / answered | weighted | miss | hit | wall ms (mean) | wall ms excl. det resets | answer calls/q | prompt tok/q | output tok/q | output-limit answers |")
    console.log("|---|---|---|---|---|---|---|---|---|---|---|")
    for (const label of Object.keys(ARMS)) {
        const r = armRow(label, sets)
        if (!r.n) continue
        out.arms[tag][label] = r
        console.log(`| ${label} | ${r.graded} / ${r.n} (${r.nMiss} miss, ${r.nHit} hit) | ${f1(r.weighted)} | ${f1(r.miss)} | ${f1(r.hit)} | ${r.wallMs.toFixed(0)} | ${r.wallNoResetMs.toFixed(0)} | ${r.calls.toFixed(2)} | ${r.promptTokens.toFixed(0)} | ${r.outputTokens.toFixed(1)} | ${r.outputLimit} |`)
    }
    const have = (l) => out.arms[tag][l]?.graded > 0
    const C = []
    const add = (name, terms) => { if (terms.every(([l]) => have(l))) C.push(contrast(name, terms, sets)) }
    // scale effect per system
    add("e4b − e2b, P-B", [["e4b pb", 1], ["e2b pb", -1]])
    add("e4b − e2b, gates", [["e4b gates", 1], ["e2b gates", -1]])
    add("e4b − e2b, gold only (oracles)", [["e4b oracles", 1], ["e2b oracles", -1]])
    add("e4b − e2b, P-B (det e2b)", [["e4b pb", 1], ["e2b det-pb", -1]])
    add("e4b − e2b, gates (det e2b)", [["e4b gates", 1], ["e2b det-gates", -1]])
    add("e4b − e2b, gold only (det e2b)", [["e4b oracles", 1], ["e2b det-oracles", -1]])
    // engineering gain per model
    add("gates − P-B, e2b", [["e2b gates", 1], ["e2b pb", -1]])
    add("gates − P-B, e2b (det)", [["e2b det-gates", 1], ["e2b det-pb", -1]])
    add("gates − P-B, e4b", [["e4b gates", 1], ["e4b pb", -1]])
    add("gain difference (e4b gain − e2b gain)", [["e4b gates", 1], ["e4b pb", -1], ["e2b gates", -1], ["e2b pb", 1]])
    add("e4b − e2b, P-B (merged e2b P-B)", [["e4b pb", 1], ["e2b P-B (pb | det-pb)", -1]])
    add("gates − P-B, e2b (merged e2b P-B)", [["e2b gates", 1], ["e2b P-B (pb | det-pb)", -1]])
    add("gain difference (merged e2b P-B)", [["e4b gates", 1], ["e4b pb", -1], ["e2b gates", -1], ["e2b P-B (pb | det-pb)", 1]])
    add("gain difference (det e2b)", [["e4b gates", 1], ["e4b pb", -1], ["e2b det-gates", -1], ["e2b det-pb", 1]])
    // engineering vs scale
    add("e2b gates − e4b P-B", [["e2b gates", 1], ["e4b pb", -1]])
    add("e2b gates − e4b P-B (det e2b)", [["e2b det-gates", 1], ["e4b pb", -1]])
    // vs 31b P-B
    add("e2b P-B − 31b P-B", [["e2b pb", 1], ["31b pb", -1]])
    add("e4b P-B − 31b P-B", [["e4b pb", 1], ["31b pb", -1]])
    add("e2b gates − 31b P-B", [["e2b gates", 1], ["31b pb", -1]])
    add("e4b gates − 31b P-B", [["e4b gates", 1], ["31b pb", -1]])
    // reading headroom: gold-only minus system, per model (distraction + retrieval cost)
    add("gold only − gates, e2b", [["e2b oracles", 1], ["e2b gates", -1]])
    add("gold only − gates, e4b", [["e4b oracles", 1], ["e4b gates", -1]])
    // decomposition: sandwich prompt on P-B context, and the gated switch on top of it
    add("pbs − P-B (prompt), e2b", [["e2b pbs", 1], ["e2b pb", -1]])
    add("pbs − P-B (prompt), e4b", [["e4b pbs", 1], ["e4b pb", -1]])
    add("gates − pbs (switch), e2b", [["e2b gates", 1], ["e2b pbs", -1]])
    add("gates − pbs (switch), e4b", [["e4b gates", 1], ["e4b pbs", -1]])
    add("prompt gain difference (e4b − e2b)", [["e4b pbs", 1], ["e4b pb", -1], ["e2b pbs", -1], ["e2b pb", 1]])
    add("switch gain difference (e4b − e2b)", [["e4b gates", 1], ["e4b pbs", -1], ["e2b gates", -1], ["e2b pbs", 1]])
    add("e4b − e2b, pbs", [["e4b pbs", 1], ["e2b pbs", -1]])
    // reading with the gold email only: sandwich vs T2
    add("gold only: sandwich − T2, e2b", [["e2b oracles", 1], ["e2b oracle-T2", -1]])
    add("gold only: sandwich − T2, e4b", [["e4b oracles", 1], ["e4b oracle-T2", -1]])
    add("e4b − e2b, gold only T2", [["e4b oracle-T2", 1], ["e2b oracle-T2", -1]])
    add("det check: e2b det-gates − e2b gates", [["e2b det-gates", 1], ["e2b gates", -1]])
    add("det check: e2b det-oracles − e2b oracles", [["e2b det-oracles", 1], ["e2b oracles", -1]])
    add("det check: e2b det-pb − e2b pb", [["e2b det-pb", 1], ["e2b pb", -1]])
    out.contrasts[tag] = C
    console.log(`\n## ${tag}: paired contrasts (95% CI: question-stratified | mailbox-cluster; B = ${BOOT_B})\n`)
    console.log("| contrast | n (miss/hit) | Δ weighted [q-strat] [cluster] | Δ miss | Δ hit [q-strat] [cluster] | flips miss +/− | flips hit +/− |")
    console.log("|---|---|---|---|---|---|---|")
    for (const c of C) console.log(`| ${c.name} | ${c.nMiss}/${c.nHit} | ${sgn(c.weighted)} ${ciTxt(c.ciQ)} ${ciTxt(c.ciC)} | ${sgn(c.miss)} | ${sgn(c.hit)} ${ciTxt(c.ciQhit)} ${ciTxt(c.ciChit)} | ${c.flipsMiss.plus}/${c.flipsMiss.minus} | ${c.flipsHit.plus}/${c.flipsHit.minus} |`)
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1))
