// Worker v5 (round 5): final tables and figures for the presentation. Offline only: stored
// exploration answers + J1 verdicts + pool records (no TEST data, no model calls), round-4
// numbers read from v-final's final-tables.json, and the energy summaries written by
// tools/i-energy.js.
//
//   node benchmarks/premise2/explore2/tools/v5-final.js [--md out.md]
//
// Writes benchmarks/results/premise2/explore/final-r5-tables.json, final-r5-tables.csv and
// final-r5-pareto.svg; prints the markdown tables (or writes them to --md). v-final.js and its
// outputs are not touched (v-final.js runs at import time, so it is not imported; its
// statistics come from the same modules: explore/analyze.js, explore/grade.js, judge.js).
//
// Accuracy: J1 (judgeConfig("j1"), verdicts joined exactly as explore/analyze.js does),
// design-weighted with the pool's miss share (analyze.js `weighted`; 0.068).
// Δ and 95% CI: analyze.js `pairedBootstrap` (paired mailbox-cluster bootstrap, B 2000, seed
// 20260922; the CI cli2.js report prints). Pooled rows bootstrap the union of the pairs with
// mailboxes as clusters across sets, as tools/q-stats.js does.
// Sign-flip randomisation p (two-sided, as q-stats.js): rng.js mulberry32(7), 200,000 draws.
// Pairing rule (i.md §6): det-wrapped arms are compared only with det-wrapped arms, unwrapped
// arms only with unwrapped arms.
// A variant counts on a set only with full graded coverage (every set question answered and
// graded); anything else is listed as a gap.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { judgeConfig, preGrade } from "../../judge.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { weighted, pairedBootstrap } from "../../explore/analyze.js"
import { mulberry32 } from "./rng.js"

try { process.loadEnvFile(".env") } catch {}
const dataDir = ".data/premise2"
const OUT = "benchmarks/results/premise2/explore/"
const ENERGY = ".data/premise2/explore/"
const FRESH = ["S300-4", "S300-5", "FULL-2"]
const DECISION = ["S300-4", "S300-5"]
const DEV = "S300-1"
const SETS = [...FRESH, DEV]
const CAP_MS = 3243
const B = 2000
const SEED = 20260922
const FLIP_B = 200000
const argv = process.argv.slice(2)
const mdOut = argv.includes("--md") ? argv[argv.indexOf("--md") + 1] : null

// ---------- systems ----------
// tier labels follow the lead's round-5 grouping: one-shot (P-B, gates), hybrid (x1 and its
// stacks: a harness pipeline with a g5 agent fallback), agentic (g5, t-lk). v-final (round 4)
// filed x1 under "agent"; the numbers do not depend on the label.
const SYSTEMS = {
    pb: { label: "P-B", tier: "one-shot", family: "unwrapped" },
    gates: { label: "gates", tier: "one-shot", family: "unwrapped" },
    x1: { label: "x1", tier: "hybrid", family: "unwrapped" },
    q1: { label: "q1", tier: "hybrid", family: "unwrapped" },
    g5: { label: "g5", tier: "agentic", family: "unwrapped" },
    "t-lk": { label: "t-lk", tier: "agentic", family: "unwrapped" },
    "i-det-gates": { label: "det gates", tier: "one-shot", family: "det" },
    "i-det-x1": { label: "det x1", tier: "hybrid", family: "det" },
    "q-det-q1": { label: "det q1", tier: "hybrid", family: "det" },
    "q-det-q2": { label: "det q2", tier: "hybrid", family: "det" },
    "i-det-tlk": { label: "det t-lk", tier: "agentic", family: "det" },
    d6: { label: "d6", tier: "hybrid", family: "unwrapped", what: "x1 + lexical CE explore list" },
    d8: { label: "d8", tier: "hybrid", family: "unwrapped", what: "d6 + g5 handover seeded with x1's first-YES email" },
    "c-fin3": { label: "c-fin3", tier: "hybrid", family: "unwrapped", what: "x1 + thread labels on chain emails" },
    "c-fin4": { label: "c-fin4", tier: "one-shot", family: "unwrapped", what: "gates + thread labels on chain emails" },
    "u-xyc": { label: "u-xyc", tier: "hybrid", family: "unwrapped", what: "x1 + CAD re-read of the YES email on sure commits" },
    "u-gpad": { label: "u-gpad", tier: "one-shot", family: "unwrapped", what: "placebo: gates with its prompt padded by periods (not a candidate)" },
}
const REF = { unwrapped: { x1: "x1", gates: "gates" }, det: { x1: "i-det-x1", gates: "i-det-gates" } }
const name = (id) => SYSTEMS[id]?.label ?? id
const FRESH_MAIN = ["gates", "x1", "i-det-gates", "i-det-x1", "q-det-q1", "q-det-q2"]
const FRESH_OTHER = ["d6", "d8", "c-fin3", "c-fin4", "u-xyc", "u-gpad"]
const DEV_UNWRAPPED = ["pb", "gates", "x1", "q1", "g5", "t-lk"]
const DEV_DET = ["i-det-gates", "i-det-x1", "q-det-q1", "q-det-q2", "i-det-tlk"]

// ---------- load and join (as v-final.js) ----------
const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
if (judge.provider !== "openrouter") throw new Error(`J1 is ${judge.provider}:${judge.model}; .env not loaded?`)
const verdicts = verdictIndex(dataDir)
const setKeys = new Map(SETS.map((setName) => [setName, new Set(loadSet(dataDir, setName, pool).questionKeys)]))
const setSize = (setName) => setKeys.get(setName).size

const raw = new Map() // id -> set -> version -> { items, records }
for (const answer of latestAnswers(dataDir)) {
    if (!setKeys.has(answer.set) || !setKeys.get(answer.set).has(answer.questionKey)) continue
    const id = answer.alias === "small" ? answer.variant : `${answer.variant}:${answer.alias}`
    const record = pool.byKey.get(answer.questionKey)
    const pre = preGrade(answer)
    let correct = null
    if (pre) correct = 0
    else {
        const verdict = verdicts.get(answerVerdictKey(answer, record, judge))
        if (verdict) correct = verdict.verdict === "CORRECT" ? 1 : 0
    }
    const bySet = raw.get(id) ?? raw.set(id, new Map()).get(id)
    const byVersion = bySet.get(answer.set) ?? bySet.set(answer.set, new Map()).get(answer.set)
    const slot = byVersion.get(String(answer.version)) ?? byVersion.set(String(answer.version), { items: [], records: 0 }).get(String(answer.version))
    slot.records++
    slot.items.push({
        key: `${answer.set}|${answer.questionKey}`, set: answer.set, user: record.user, stratum: record.stratum, correct,
        wallMs: answer.wallMs ?? 0, calls: answer.calls ?? 0, resets: answer.det?.resets ?? 0, resetMs: answer.det?.resetMs ?? 0,
        status: answer.status, technical: pre?.source === "technical", at: answer.at,
    })
}
const covered = new Map() // id -> set -> { version, items }
const gaps = []
for (const [id, bySet] of raw) {
    for (const [set, byVersion] of bySet) {
        const full = []
        for (const [version, slot] of byVersion) {
            const unique = new Set(slot.items.map((item) => item.key)).size
            const graded = slot.items.filter((item) => item.correct !== null).length
            if (unique === setSize(set) && graded === setSize(set)) full.push(version)
            else if (SYSTEMS[id]) gaps.push({ id, set, version, answered: unique, graded, size: setSize(set) })
        }
        if (full.length) {
            const version = full.sort().at(-1)
            if (!covered.has(id)) covered.set(id, new Map())
            covered.get(id).set(set, { version, items: byVersion.get(version).items })
        }
    }
}
const has = (id, set) => Boolean(covered.get(id)?.has(set))
const itemsOf = (id, sets) => sets.flatMap((set) => covered.get(id)?.get(set)?.items ?? [])
const versionOf = (id, sets) => [...new Set(sets.filter((set) => has(id, set)).map((set) => covered.get(id).get(set).version))].join(",")

// ---------- statistics ----------
const meanOf = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN)
const pctl = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
function accuracy(items) {
    const acc = weighted(items, missShare)
    return { n: items.length, nMiss: acc.nMiss, nHit: acc.nHit, weighted: 100 * acc.weighted, miss: 100 * acc.miss, hit: 100 * acc.hit }
}
function cost(items) {
    const walls = items.map((item) => item.wallMs)
    const det = items.some((item) => item.resets > 0)
    return {
        wallMean: meanOf(walls), wallP50: pctl(walls, 0.5), wallP95: pctl(walls, 0.95), wallMax: Math.max(...walls),
        callsMean: meanOf(items.map((item) => item.calls)), realCallsMean: meanOf(items.map((item) => item.calls - item.resets)),
        resetsMean: det ? meanOf(items.map((item) => item.resets)) : 0, resetMsMean: det ? meanOf(items.map((item) => item.resetMs)) : 0,
        technical: items.filter((item) => item.technical).length,
        runFrom: items.map((item) => item.at).sort()[0], runTo: items.map((item) => item.at).sort().at(-1),
    }
}
function pairsOf(aItems, bItems) {
    const ref = new Map(bItems.map((item) => [item.key, item]))
    return aItems.filter((item) => ref.has(item.key)).map((item) => ({ user: item.user, stratum: item.stratum, a: item.correct, b: ref.get(item.key).correct }))
}
// two-sided sign-flip randomisation of the weighted Δ over the discordant pairs (q-stats.js)
function signFlip(pairs) {
    const nMiss = pairs.filter((p) => p.stratum === "miss").length
    const nHit = pairs.filter((p) => p.stratum === "hit").length
    const count = (stratum, sign) => pairs.filter((p) => p.stratum === stratum && Math.sign(p.a - p.b) === sign).length
    const disc = { missPlus: count("miss", 1), missMinus: count("miss", -1), hitPlus: count("hit", 1), hitMinus: count("hit", -1) }
    const w = (dm, dh) => 100 * (missShare * dm / nMiss + (1 - missShare) * dh / nHit)
    const obs = w(disc.missPlus - disc.missMinus, disc.hitPlus - disc.hitMinus)
    const kM = disc.missPlus + disc.missMinus, kH = disc.hitPlus + disc.hitMinus
    const rnd = mulberry32(7)
    let extreme = 0
    for (let b = 0; b < FLIP_B; b++) {
        let sm = 0, sh = 0
        for (let i = 0; i < kM; i++) sm += rnd() < 0.5 ? 1 : -1
        for (let i = 0; i < kH; i++) sh += rnd() < 0.5 ? 1 : -1
        if (Math.abs(w(sm, sh)) >= Math.abs(obs) - 1e-9) extreme++
    }
    return { disc, p: extreme / FLIP_B }
}
function contrast(id, refId, sets) {
    if (!refId || id === refId || !sets.every((set) => has(id, set) && has(refId, set))) return null
    const pairs = pairsOf(itemsOf(id, sets), itemsOf(refId, sets))
    const d = pairedBootstrap(pairs, missShare, { B, seed: SEED })
    return { ref: refId, n: pairs.length, weighted: 100 * d.weighted, low: 100 * d.low, high: 100 * d.high, miss: 100 * d.miss, hit: 100 * d.hit, ...signFlip(pairs) }
}
function row(id, sets, table) {
    const items = itemsOf(id, sets)
    const family = SYSTEMS[id].family
    return {
        table, system: name(id), id, family, tier: SYSTEMS[id].tier, sets, version: versionOf(id, sets), ...accuracy(items),
        vsX1: contrast(id, REF[family].x1, sets), vsGates: contrast(id, REF[family].gates, sets), ...cost(items),
    }
}
const short = (sets) => sets.map((set) => set.replace("S300-", "S").replace("FULL-", "F")).join("+")

// ---------- 1. fresh sets (round 5) ----------
const fresh = []
for (const id of FRESH_MAIN) {
    const sets = FRESH.filter((set) => has(id, set))
    for (const set of sets) fresh.push({ ...row(id, [set], "fresh"), pool: set })
    if (DECISION.every((set) => sets.includes(set)) && sets.length > 2) fresh.push({ ...row(id, DECISION, "fresh"), pool: "S4+S5" })
    if (sets.length > 1) fresh.push({ ...row(id, sets, "fresh"), pool: `pooled ${short(sets)}` })
}
const freshOther = []
for (const id of FRESH_OTHER) {
    const sets = DECISION.filter((set) => has(id, set))
    for (const set of sets) freshOther.push({ ...row(id, [set], "fresh_other"), pool: set })
    if (sets.length > 1) freshOther.push({ ...row(id, sets, "fresh_other"), pool: `pooled ${short(sets)}` })
}
const freshGaps = gaps.filter((g) => FRESH.includes(g.set))

// ---------- 2. tiers ----------
const devUnwrapped = DEV_UNWRAPPED.filter((id) => has(id, DEV)).map((id) => ({ ...row(id, [DEV], "tiers_dev"), pool: DEV }))
const devDet = DEV_DET.filter((id) => has(id, DEV)).map((id) => ({ ...row(id, [DEV], "tiers_dev_det"), pool: DEV }))
const devPending = DEV_UNWRAPPED.filter((id) => !has(id, DEV)).map((id) => ({ id, gap: gaps.find((g) => g.id === id && g.set === DEV) ?? null }))

// round-4 numbers, reused from v-final (not recomputed)
const r4Path = OUT + "final-tables.json"
const r4 = existsSync(r4Path) ? JSON.parse(readFileSync(r4Path, "utf8")) : null
const r4Pooled = (id) => r4?.pooled.find((r) => r.variant === id && r.pool === "all") ?? null
const r4Sens = (id) => r4?.sensitivity?.points.find((p) => p.variant === id) ?? null
const r4Rows = ["pb", "gates", "g5", "t-lk", "x1"].map((id) => {
    const r = r4Pooled(id)
    if (!r) return { id, missing: true }
    const s = r4Sens(id)
    return {
        id, system: name(id), tier: SYSTEMS[id].tier, sets: r.sets, n: r.n, weighted: r.weighted, miss: r.miss, hit: r.hit,
        vsGates: r.vsGates, wallMean: r.wallMean, wallP95: r.wallP95, callsMean: r.callsMean,
        sensitivity: s ? { sets: s.sets, n: s.n, delta: s.delta, low: s.low, high: s.high } : null,
        source: "final-tables.json pooled 'all' (v-final; Δ vs gates = paired stratified bootstrap)",
    }
})
// round-5 fresh numbers per system for the tiers table (same family references)
const freshPooled = (id) => fresh.filter((r) => r.id === id && r.pool.startsWith("pooled")).at(0) ?? fresh.find((r) => r.id === id) ?? null
const r5Tier = [
    { tierRow: "gates", id: "gates" }, { tierRow: "gates", id: "i-det-gates" },
    { tierRow: "x1", id: "x1" }, { tierRow: "x1", id: "i-det-x1" },
    { tierRow: "q1", id: "q-det-q1" }, { tierRow: "q2", id: "q-det-q2" },
].map((e) => ({ ...e, row: freshPooled(e.id) })).filter((e) => e.row)

// ladder: round-4 rungs from v-final + q1 as rung 9 (det-paired step vs det x1)
const ladder = (r4?.ladder ?? []).map((r) => ({ variant: r.variant, what: r.what, weighted: r.weighted, miss: r.miss, hit: r.hit, step: r.step, wallMean: r.wallMean, callsMean: r.callsMean, sets: "S300-2+S300-1", source: "v-final" }))
const q1Step = {
    dev: has("q-det-q1", DEV) ? { set: DEV, ...accuracy(itemsOf("q-det-q1", [DEV])), step: contrast("q-det-q1", "i-det-x1", [DEV]), ...cost(itemsOf("q-det-q1", [DEV])) } : null,
    fresh: fresh.find((r) => r.id === "q-det-q1" && r.pool.startsWith("pooled")) ?? null,
}

// ---------- 3. energy ----------
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null)
const E_I = readJson(ENERGY + "i-energy-summary.json")
const E_F2 = readJson(ENERGY + "r5-energy-summary.json")
const E_Q1 = readJson(ENERGY + "r5-energy-q1.json")
const E_MAP = {
    "i-e-pb": ["P-B", "one-shot", "unwrapped"], "i-e-gates": ["gates", "one-shot", "unwrapped"], "i-e-tlk": ["t-lk", "agentic", "unwrapped"], "i-e-x1": ["x1", "hybrid", "unwrapped"],
    q1: ["q1", "hybrid", "unwrapped"],
    "i-det-gates": ["det gates", "one-shot", "det"], "i-det-tlk": ["det t-lk", "agentic", "det"], "i-det-x1": ["det x1", "hybrid", "det"],
    "q-det-q1": ["det q1", "hybrid", "det"], "q-det-q2": ["det q2", "hybrid", "det"],
}
function energyRows(summary, source) {
    if (!summary) return []
    return summary.rows.filter((r) => r.n && E_MAP[r.variant]).map((r) => {
        const [system, tier, family] = E_MAP[r.variant]
        const attributed = Number.isFinite(r.dw.cpuAttrJq) && r.ownCpu?.runnerFound
        return {
            source, set: summary.setName, variant: r.variant, system, tier, family, n: r.n, graded: r.graded, weighted: 100 * r.weighted,
            wallMsDw: r.dw.wallMs, wallMs: r.wallMs, calls: r.calls, gpuW: r.dw.gpuW,
            gpuJq: r.dw.gpuJq, gpuJqCi: r.dw.gpuJqCi, gpuMargJq: r.dw.gpuMargJq, gpuPerCorrect: r.dw.gpuPerCorrect, gpuMargPerCorrect: r.dw.gpuMargJq / r.weighted,
            missGpuJq: r.dw.missGpuJq, hitGpuJq: r.dw.hitGpuJq,
            cpuAttrJq: Number.isFinite(r.dw.cpuAttrJq) ? r.dw.cpuAttrJq : null, cpuAttrComplete: attributed,
            totalJq: Number.isFinite(r.dw.totalJq) ? r.dw.totalJq : null, totalPerCorrect: Number.isFinite(r.dw.totalPerCorrect) ? r.dw.totalPerCorrect : null,
            cpuPkgJq: r.dw.cpuPkgJq, idleGpuW: summary.idle?.gpuW, idleWindows: summary.idle?.windows, cpuFit: summary.cpuFit, from: r.from, to: r.to,
        }
    })
}
const energy = [...energyRows(E_I, "i-energy-summary.json (worker i, Wed 00:17-01:25 ET)"), ...energyRows(E_Q1, "r5-energy-q1.json (lead's q1 run, Wed)"), ...energyRows(E_F2, "r5-energy-summary.json (lead's FULL-2 run, Wed 09:34-10:52 ET)")]
// GPU J per correct relative to gates of the same set and wrapping
for (const e of energy) {
    const ref = energy.find((g) => g.set === e.set && g.family === e.family && /gates$/.test(g.system)) ?? (e.family === "unwrapped" ? energy.find((g) => g.set === e.set && g.system === "gates") : null)
    e.ratioVsGates = ref ? e.gpuPerCorrect / ref.gpuPerCorrect : null
    e.refGates = ref?.variant ?? null
}

// ---------- outputs ----------
mkdirSync(OUT, { recursive: true })
const json = {
    at: new Date().toISOString(), missShare, judge: `${judge.provider}:${judge.model}`,
    sets: { fresh: FRESH, decision: DECISION, dev: DEV, sizes: Object.fromEntries(SETS.map((set) => [set, setSize(set)])) },
    bootstrap: { method: "explore/analyze.js pairedBootstrap: paired mailbox-cluster bootstrap; pooled rows resample mailboxes over the union of pairs (as tools/q-stats.js)", B, seed: SEED, signFlip: { rng: "tools/rng.js mulberry32(7)", draws: FLIP_B } },
    pairing: "det arms vs det arms (i-det-x1, i-det-gates); unwrapped vs unwrapped (x1, gates)",
    tiers: "one-shot: P-B, gates; hybrid: x1, q1, q2 (harness pipeline with a g5 agent fallback); agentic: g5, t-lk",
    capMs: CAP_MS,
    fresh, freshOther, freshGaps,
    tiersDev: { set: DEV, unwrapped: devUnwrapped, det: devDet, pending: devPending },
    tiersRound4: r4Rows, tiersRound5: r5Tier.map((e) => ({ tierRow: e.tierRow, id: e.id, pool: e.row.pool })),
    ladder, ladderQ1: q1Step, round4Source: r4 ? { path: r4Path, at: r4.at } : null,
    energy, energySources: { i: Boolean(E_I), full2: Boolean(E_F2), q1: Boolean(E_Q1) },
    gaps,
}
writeFileSync(OUT + "final-r5-tables.json", JSON.stringify(json, null, 2))

const f = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "" : v.toFixed(d))
const csvHead = ["table", "pool", "system", "id", "version", "family", "tier", "sets", "n", "n_miss", "n_hit", "weighted", "miss", "hit", "ref_x1", "delta_vs_x1", "ci_low_vs_x1", "ci_high_vs_x1", "p_signflip_vs_x1", "ref_gates", "delta_vs_gates", "ci_low_vs_gates", "ci_high_vs_gates", "p_signflip_vs_gates", "wall_mean_ms", "wall_p50_ms", "wall_p95_ms", "wall_max_ms", "calls_mean", "real_calls_mean", "gpu_j_per_q", "gpu_j_per_q_ci95", "gpu_marginal_j_per_q", "gpu_j_per_correct", "cpu_attributed_j_per_q", "total_j_per_correct", "idle_gpu_w"]
const csv = [csvHead.join(",")]
const csvRow = (r) => [r.table, r.pool, r.system, r.id, r.version, r.family, r.tier, r.sets.join("+"), r.n, r.nMiss, r.nHit, f(r.weighted), f(r.miss), f(r.hit), r.vsX1?.ref ?? "", f(r.vsX1?.weighted), f(r.vsX1?.low), f(r.vsX1?.high), f(r.vsX1?.p, 4), r.vsGates?.ref ?? "", f(r.vsGates?.weighted), f(r.vsGates?.low), f(r.vsGates?.high), f(r.vsGates?.p, 4), f(r.wallMean, 0), r.wallP50, r.wallP95, r.wallMax, f(r.callsMean), f(r.realCallsMean), "", "", "", "", "", "", ""].join(",")
for (const r of [...fresh, ...freshOther, ...devUnwrapped, ...devDet]) csv.push(csvRow(r))
for (const e of energy) csv.push(["energy", e.set, e.system, e.variant, "", e.family, e.tier, e.set, e.n, "", "", f(e.weighted), "", "", "", "", "", "", "", "", "", "", "", "", f(e.wallMsDw, 0), "", "", "", f(e.calls), "", f(e.gpuJq, 1), f(e.gpuJqCi, 1), f(e.gpuMargJq, 1), f(e.gpuPerCorrect, 1), f(e.cpuAttrJq, 1), f(e.totalPerCorrect, 1), f(e.idleGpuW, 2)].join(","))
writeFileSync(OUT + "final-r5-tables.csv", csv.join("\n") + "\n")

// ---------- markdown ----------
const p1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(1))
const sg = (v, d = 1) => { const r = Number(v.toFixed(d)); return (r >= 0 ? "+" : "−") + Math.abs(r).toFixed(d) }
const ci = (d, dd = 1) => `[${sg(d.low, dd)}, ${sg(d.high, dd)}]`.replace(/\[\+/, "[").replace(/, \+/, ", ")
const dci = (d, dd = 1) => (d ? `${sg(d.weighted, dd)} ${ci(d, dd)}` : "–")
const ms = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "–")
const pv = (p) => (p >= 0.0995 ? p.toFixed(2) : p >= 0.001 ? p.toFixed(3) : "< 0.001")
const disc = (d) => (d ? `+${d.disc.missPlus}/−${d.disc.missMinus} · +${d.disc.hitPlus}/−${d.disc.hitMinus}` : "–")
const calls = (r) => (r.family === "det" ? `${r.callsMean.toFixed(1)} (${r.realCallsMean.toFixed(1)})` : r.callsMean.toFixed(1))
const md = []

md.push("### Table 1. Fresh sets, round 5 (J1 weighted; Δ = paired mailbox-cluster bootstrap 95% CI)", "")
md.push("| family | system | rows | n | W | miss | hit | Δ vs x1 ref [CI] | Δ vs gates ref [CI] | discordant vs x1 ref (miss · hit) | p (sign-flip) | wall ms mean | p95 | calls (real) |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of fresh) md.push(`| ${r.family} | ${r.system} | ${r.pool} | ${r.n} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vsX1)} | ${dci(r.vsGates)} | ${disc(r.vsX1)} | ${r.vsX1 ? pv(r.vsX1.p) : "–"} | ${ms(r.wallMean)} | ${ms(r.wallP95)} | ${calls(r)} |`)
md.push("")
md.push("### Table 1b. Other variants stored on the decision sets (unwrapped; vs the lead's unwrapped x1 and gates)", "")
md.push("| system | what it is | rows | W | miss | hit | Δ vs x1 [CI] | Δ vs gates [CI] | wall ms | calls |", "|---|---|---|---|---|---|---|---|---|---|")
for (const r of freshOther) md.push(`| ${r.system} | ${SYSTEMS[r.id].what} | ${r.pool} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vsX1)} | ${dci(r.vsGates)} | ${ms(r.wallMean)} | ${r.callsMean.toFixed(1)} |`)
md.push("")
if (freshGaps.length) md.push(`Gaps on the fresh sets: ${freshGaps.map((g) => `${g.id}@${g.version} ${g.set} ${g.answered}/${g.size} answered, ${g.graded} graded`).join("; ")}`, "")

md.push(`### Table 2a. Tiers on one set: ${DEV} (development set, 300 q; unwrapped runs)`, "")
md.push("| tier | system | version | W | miss | hit | Δ vs gates [CI] | Δ vs x1 [CI] | wall ms mean | p95 | calls |", "|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of devUnwrapped) md.push(`| ${r.tier} | ${r.system} | ${r.version} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vsGates)} | ${dci(r.vsX1)} | ${ms(r.wallMean)} | ${ms(r.wallP95)} | ${r.callsMean.toFixed(1)} |`)
for (const p of devPending) md.push(`| ${SYSTEMS[p.id].tier} | ${name(p.id)} | ${p.gap ? `${p.gap.version}: ${p.gap.answered}/300 answered, ${p.gap.graded} graded` : "not stored"} | | | | | | | | |`)
md.push("")
md.push(`### Table 2b. Tiers on ${DEV}, det-wrapped runs (det vs det)`, "")
md.push("| tier | system | W | miss | hit | Δ vs det gates [CI] | Δ vs det x1 [CI] | wall ms mean | calls (real) |", "|---|---|---|---|---|---|---|---|---|")
for (const r of devDet) md.push(`| ${r.tier} | ${r.system} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vsGates)} | ${dci(r.vsX1)} | ${ms(r.wallMean)} | ${calls(r)} |`)
md.push("")
md.push("### Table 2c. Tiers across sets: round-4 pool (v-final, reused) and round-5 fresh sets", "")
md.push("| tier | system | round-4 sets (n) | round-4 W (miss / hit) | round-4 Δ vs gates [CI] | round-4 wall ms | round-5 rows | round-5 W | round-5 Δ vs x1 ref [CI] | round-5 Δ vs gates ref [CI] | round-5 wall ms |", "|---|---|---|---|---|---|---|---|---|---|---|")
for (const id of ["pb", "gates", "x1", "q1", "q2", "g5", "t-lk"]) {
    const r = r4Rows.find((x) => x.id === id && !x.missing)
    const r5 = r5Tier.filter((e) => e.tierRow === id || (id === "pb" && false))
    const tier = SYSTEMS[id]?.tier ?? "hybrid"
    const left = r ? `${short(r.sets)} (${r.n}) | ${p1(r.weighted)} (${p1(r.miss)} / ${p1(r.hit)}) | ${r.vsGates ? dci(r.vsGates) : "–"}${r.sensitivity ? `; with FULL-1 599/600: ${dci({ weighted: r.sensitivity.delta, low: r.sensitivity.low, high: r.sensitivity.high })}` : ""} | ${ms(r.wallMean)}` : "not run | | | "
    const label = id === "q2" ? "q2" : name(id)
    if (!r5.length) md.push(`| ${tier} | ${label} | ${left} | not run on the fresh sets | | | | |`)
    r5.forEach((e, i) => {
        // det gates exists on FULL-2 only: a pooled det row shows its FULL-2 Δ vs det gates instead
        const f2 = !e.row.vsGates && e.row.family === "det" ? fresh.find((x) => x.id === e.id && x.pool === "FULL-2")?.vsGates : null
        const vsG = e.row.vsGates ? dci(e.row.vsGates) : f2 ? `FULL-2: ${dci(f2)}` : "–"
        md.push(`| ${tier} | ${e.row.family === "det" ? `${label} (det)` : label} | ${i ? "(as above) | | | " : left} | ${e.row.family} ${e.row.pool.replace("pooled ", "")} (${e.row.n}) | ${p1(e.row.weighted)} | ${dci(e.row.vsX1)} | ${vsG} | ${ms(e.row.wallMean)} |`)
    })
}
md.push("")
md.push("### Table 2d. Agentic-gap ladder (v-final rungs 0-8, pooled S300-2 + S300-1, n = 600) and q1 as rung 9", "")
md.push("| # | rung | component added | pooled W (miss / hit) | step Δ [CI] | wall ms | calls |", "|---|---|---|---|---|---|---|")
ladder.forEach((r, i) => md.push(`| ${i} | ${r.variant === "agent" ? "frozen agent" : r.variant} | ${r.what} | ${p1(r.weighted)} (${p1(r.miss)} / ${p1(r.hit)}) | ${r.step ? dci(r.step) : "–"} | ${ms(r.wallMean)} | ${r.callsMean?.toFixed(2) ?? "–"} |`))
if (q1Step.dev) md.push(`| 9 | q1, det; S300-1 only (300) | + m2 recovery, d8 seeded handover, d6 explore list (step = det q1 − det x1) | ${p1(q1Step.dev.weighted)} (${p1(q1Step.dev.miss)} / ${p1(q1Step.dev.hit)}) | ${dci(q1Step.dev.step)} | ${ms(q1Step.dev.wallMean)} | ${q1Step.dev.callsMean.toFixed(2)} (${q1Step.dev.realCallsMean.toFixed(2)} real) |`)
if (q1Step.fresh) md.push(`| 9 | q1, det; S300-4 + S300-5 + FULL-2 (${q1Step.fresh.n.toLocaleString("en-US")}) | same | ${p1(q1Step.fresh.weighted)} (${p1(q1Step.fresh.miss)} / ${p1(q1Step.fresh.hit)}) | ${dci(q1Step.fresh.vsX1, 2)} | ${ms(q1Step.fresh.wallMean)} | ${q1Step.fresh.callsMean.toFixed(2)} (${q1Step.fresh.realCallsMean.toFixed(2)} real) |`)
md.push("")

md.push("### Table 3. Energy per question and per correct answer (GPU board power; design-weighted per-question means)", "")
md.push("| set | system | wrap | n | J1 W | wall ms (design-weighted) | mean GPU W | **GPU J/q (gross)** ± 95% | GPU J/q (marginal) | **GPU J per correct** | × gates (same set, same wrap) | CPU J/q attributed (approx.) | total J per correct (approx.) | idle GPU W |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const e of energy) md.push(`| ${e.set} | ${e.system} | ${e.family} | ${e.n} | ${p1(e.weighted)} | ${ms(e.wallMsDw)} | ${e.gpuW.toFixed(0)} | **${e.gpuJq.toFixed(0)}** ±${e.gpuJqCi.toFixed(0)} | ${e.gpuMargJq.toFixed(0)} | **${e.gpuPerCorrect.toFixed(0)}** | ${e.ratioVsGates ? `${e.ratioVsGates.toFixed(2)}×` : "–"} | ${e.cpuAttrJq == null ? "n/a" : `${e.cpuAttrJq.toFixed(0)}${e.cpuAttrComplete ? "" : " (runner not attributed)"}`} | ${e.totalPerCorrect == null ? "n/a" : `${e.totalPerCorrect.toFixed(0)}${e.cpuAttrComplete ? "" : "*"}`} | ${e.idleGpuW.toFixed(1)} (${e.idleWindows} windows) |`)
if (!E_Q1) md.push("", "q1 (unwrapped, S300-1): energy summary `.data/premise2/explore/r5-energy-q1.json` not found when this table was generated.")
md.push("")

// ---------- SVG: accuracy vs wall ms, accuracy vs GPU J per correct ----------
const TIER_COLORS = { "one-shot": "#1f6fb4", hybrid: "#d4820a", agentic: "#11906b" }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const seriesA = [
    { key: "dev", title: `${DEV} (dev, 300 q, unwrapped runs)`, shape: "circle", points: devUnwrapped.map((r) => ({ label: r.system, tier: r.tier, x: r.wallMean, y: r.weighted })) },
    { key: "f2", title: "FULL-2 (confirmation, 600 q, det-wrapped)", shape: "square", points: fresh.filter((r) => r.pool === "FULL-2").map((r) => ({ label: r.system, tier: r.tier, x: r.wallMean, y: r.weighted })) },
]
const seriesB = [
    { key: "dev", title: `${DEV} (dev, 300 q, unwrapped energy runs)`, shape: "circle", points: energy.filter((e) => e.set === DEV && e.family === "unwrapped").map((e) => ({ label: e.system, tier: e.tier, x: e.gpuPerCorrect, y: e.weighted })) },
    { key: "f2", title: "FULL-2 (confirmation, 600 q, det-wrapped)", shape: "square", points: energy.filter((e) => e.set === "FULL-2").map((e) => ({ label: e.system, tier: e.tier, x: e.gpuPerCorrect, y: e.weighted })) },
]
function frontierOf(points) {
    const sorted = [...points].sort((a, b) => a.x - b.x || b.y - a.y)
    const out = []
    let best = -Infinity
    for (const p of sorted) if (p.y > best + 1e-9) { out.push(p); best = p.y }
    return out
}
function panel(parts, { x0, y0, w, h, series, xMax, xStep, xLabel, title, cap }) {
    const yMin = 76, yMax = 90
    const X = (v) => x0 + (v / xMax) * w
    const Y = (v) => y0 + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * h
    parts.push(`<text x="${x0}" y="${y0 - 12}" font-size="15" font-weight="bold" fill="#111">${esc(title)}</text>`)
    for (let v = yMin; v <= yMax; v += 2) parts.push(`<line x1="${x0}" x2="${x0 + w}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e5e5"/><text x="${x0 - 8}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="#333">${v}</text>`)
    for (let v = 0; v <= xMax; v += xStep) parts.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${y0}" y2="${y0 + h}" stroke="#f0f0f0"/><text x="${X(v)}" y="${y0 + h + 16}" font-size="11" text-anchor="middle" fill="#333">${v.toLocaleString("en-US")}</text>`)
    parts.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="#888"/>`)
    parts.push(`<text x="${x0 + w / 2}" y="${y0 + h + 36}" font-size="13" text-anchor="middle" fill="#111">${esc(xLabel)}</text>`)
    parts.push(`<text transform="translate(${x0 - 40} ${y0 + h / 2}) rotate(-90)" font-size="13" text-anchor="middle" fill="#111">J1 weighted accuracy (%)</text>`)
    if (cap) parts.push(`<line x1="${X(cap)}" x2="${X(cap)}" y1="${y0}" y2="${y0 + h}" stroke="#c0392b" stroke-width="2" stroke-dasharray="6 4"/><text x="${X(cap) - 6}" y="${y0 + 16}" font-size="11.5" text-anchor="end" fill="#c0392b">cost cap ${cap.toLocaleString("en-US")} ms</text>`)
    const placed = []
    const marks = series.flatMap((s) => s.points.map((p) => ({ x: X(p.x) - 6, y: Y(p.y) - 6, w: 12, h: 12 })))
    for (const s of series) {
        const fr = frontierOf(s.points)
        let d = ""
        fr.forEach((p, i) => {
            d += i ? ` H ${X(p.x).toFixed(1)} V ${Y(p.y).toFixed(1)}` : `M ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`
            if (i) { // the step's segments are label obstacles: horizontal at the previous y, then vertical
                const a = fr[i - 1]
                marks.push({ x: X(a.x), y: Y(a.y) - 2, w: X(p.x) - X(a.x), h: 4 })
                marks.push({ x: X(p.x) - 2, y: Y(p.y), w: 4, h: Y(a.y) - Y(p.y) })
            }
        })
        parts.push(`<path d="${d}" fill="none" stroke="#555" stroke-width="1.4" stroke-dasharray="${s.shape === "square" ? "5 3" : "none"}"/>`)
    }
    const overlaps = (b) => [...placed, ...marks].some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    for (const s of series) for (const p of s.points) {
        const cx = X(p.x), cy = Y(p.y), color = TIER_COLORS[p.tier]
        parts.push(s.shape === "square" ? `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="${color}" stroke="#000" stroke-width="1"/>` : `<circle cx="${cx}" cy="${cy}" r="6.5" fill="${color}" stroke="#000" stroke-width="1"/>`)
        const text = `${p.label} ${p.y.toFixed(1)}`
        const size = 11.5, tw = text.length * size * 0.56, th = size
        const cands = [[10, 4], [-10 - tw, 4], [-tw / 2, -10], [-tw / 2, th + 8], [10, -8], [10, 16], [-10 - tw, -8], [-10 - tw, 16], [14, -20], [14, 28], [-14 - tw, -20], [-14 - tw, 28], [-tw / 2, -24], [-tw / 2, 34]]
        let chosen = null
        for (const [dx, dy] of cands) { const b = { x: cx + dx, y: cy + dy - th + 2, w: tw, h: th }; if (!overlaps(b) && b.x > x0 && b.x + tw < x0 + w && b.y > y0 && b.y + th < y0 + h) { chosen = { dx, dy, b }; break } }
        if (!chosen) chosen = { dx: 10, dy: 4, b: { x: cx + 10, y: cy - th + 6, w: tw, h: th } }
        placed.push(chosen.b)
        if (Math.hypot(chosen.dx, chosen.dy) > 18) parts.push(`<line x1="${cx}" y1="${cy}" x2="${cx + chosen.dx + (chosen.dx < 0 ? tw : 0)}" y2="${cy + chosen.dy - th / 3}" stroke="#aaa" stroke-width="0.7"/>`)
        parts.push(`<text x="${cx + chosen.dx}" y="${cy + chosen.dy}" font-size="${size}" fill="#111">${esc(text)}</text>`)
    }
}
function paretoSvg() {
    const W = 1320, H = 700
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`]
    parts.push(`<text x="70" y="28" font-size="18" font-weight="bold" fill="#111">Accuracy vs cost, round 5: Gemma 4 e2b on EnronQA exploration sets</text>`)
    parts.push(`<text x="70" y="48" font-size="12" fill="#444">J1 weighted = 0.068·miss + 0.932·hit. Each series is one set: every point in it was scored on the same questions. Lines: accuracy frontier within the series.</text>`)
    panel(parts, { x0: 80, y0: 100, w: 540, h: 440, series: seriesA, xMax: 3600, xStep: 600, xLabel: "mean wall time per question (ms)", title: "A. Accuracy vs wall time", cap: CAP_MS })
    panel(parts, { x0: 740, y0: 100, w: 540, h: 440, series: seriesB, xMax: 250, xStep: 50, xLabel: "GPU energy per correct answer (J, gross board power, design-weighted)", title: "B. Accuracy vs GPU energy per correct answer" })
    let ly = H - 92, lx = 80
    for (const [tier, color] of Object.entries(TIER_COLORS)) { parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${color}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="#111">${tier}</text>`); lx += 100 }
    parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6.5" fill="#fff" stroke="#000"/><line x1="${lx + 16}" x2="${lx + 40}" y1="${ly - 4}" y2="${ly - 4}" stroke="#555" stroke-width="1.4"/><text x="${lx + 46}" y="${ly}" font-size="12" fill="#111">${esc(seriesA[0].title)}</text>`)
    lx += 330
    parts.push(`<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="#fff" stroke="#000"/><line x1="${lx + 16}" x2="${lx + 40}" y1="${ly - 4}" y2="${ly - 4}" stroke="#555" stroke-width="1.4" stroke-dasharray="5 3"/><text x="${lx + 46}" y="${ly}" font-size="12" fill="#111">${esc(seriesA[1].title)}</text>`)
    const notes = [
        `Panel A: ${DEV} points are the stored runs (P-B, gates, g5, t-lk, x1) and the lead's q1 run; FULL-2 points are the lead's det-wrapped confirmation arms. Wall time includes BM25, the CPU cross-encoder and every model call (det resets included).`,
        `Panel B: GPU board power (RTX 5060 Ti) integrated per question window, gross (idle not subtracted). ${DEV}: worker i's energy re-runs (byte-identical to the stored runs) and q1; FULL-2: the same det arms as panel A. g5 has no energy run.`,
        "det = every model call preceded by a fixed reset call, so answers do not depend on earlier questions; det arms are compared only with det arms.",
    ]
    notes.forEach((t, i) => parts.push(`<text x="80" y="${H - 58 + i * 16}" font-size="10.5" fill="#555">${esc(t)}</text>`))
    parts.push(`</svg>`)
    return parts.join("\n")
}
writeFileSync(OUT + "final-r5-pareto.svg", paretoSvg())

const text = md.join("\n")
if (mdOut) writeFileSync(mdOut, text)
console.log(text)
console.error(`[v5-final] wrote ${OUT}final-r5-tables.json, final-r5-tables.csv, final-r5-pareto.svg`)
process.exit(0)
