// Worker v (round 4): final tables and figures for the paper and the presentation.
// Offline only: stored exploration answers + J1 verdicts + pool records (no TEST data,
// no model calls). Sets: S300-2, S300-1, S300-3, FULL-0, FULL-1.
//
//   node benchmarks/premise2/explore2/tools/v-final.js [--md out.md]
//
// Writes benchmarks/results/premise2/explore/final-tables.json, final-tables.csv,
// final-pareto.svg, final-ladder.svg; prints the markdown tables (or writes them to --md).
//
// Accuracy: J1 (judgeConfig("j1"), verdicts joined exactly as explore/analyze.js does),
// design-weighted with the pool's miss share (analyze.js `weighted`).
// Per-set Δ vs gates: analyze.js `pairedBootstrap` (paired mailbox-cluster bootstrap,
// B 2000, seed 20260922), i.e. the CI `cli2.js report` prints.
// Pooled Δ: paired stratified bootstrap over the union of the variant's questions
// (resample within the miss / hit stratum, B 2000, seed 20260922); the cluster CI over
// the same pairs is kept in the JSON as a robustness check.
// A variant counts on a set only with full graded coverage (every set question answered
// and graded); everything else is listed as a coverage gap.

import { writeFileSync, mkdirSync } from "node:fs"
import { judgeConfig, preGrade } from "../../judge.js"
import { splitmix32 } from "../../text.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { weighted, pairedBootstrap } from "../../explore/analyze.js"

try { process.loadEnvFile(".env") } catch {}
const dataDir = ".data/premise2"
const OUT = "benchmarks/results/premise2/explore/"
const SETS = ["S300-2", "S300-1", "S300-3", "FULL-0", "FULL-1"]
const CAP_MS = 3243
const B = 2000
const SEED = 20260922
const argv = process.argv.slice(2)
const mdOut = argv.includes("--md") ? argv[argv.indexOf("--md") + 1] : null

// ---------- categories ----------
const ONE_SHOT = ["pb", "pbs", "gates", "gate", "gatea", "gates6", "gatesf", "gatesi", "gatesm", "hdru", "hdru6", "hdrud10", "hfill", "pbfill", "estar", "pbu", "rrfu", "sel5", "sel10u", "quote", "cascg", "p1", "p2", "p3", "p4", "r1", "r2", "r4", "r5", "s1", "s2", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o9", "o11", "o12", "n-cr1", "n-cs2", "w2", "w4", "w6", "w7"]
const HYBRID = ["n-g5", "n-g6", "g10", "a5", "s3", "h4", "h6", "a1", "a4"]
const AGENT = ["agent", "t1", "t2", "t3", "g1", "g2", "g5", "g6", "g7", "g8", "g9", "k1", "k2", "k3", "k4", "x1", "x2", "x3", "j1", "j2", "m1", "m2", "m3", "t-lk", "t-lx", "e1", "a2", "a3"]
// Not deployable systems: gold-only readers, logprob diagnostics, replays (wall time
// is the replay's, not a pipeline's) and the x1 replicate (identical to x1).
const DIAGNOSTIC = { oracle: "gold email only, T2 prompt", oracles: "gold email only, sandwich prompt", "n-lp0": "gates via chatRaw + logprob diagnostics", e1o: "replay of e1's unpicked candidates", "z-think1": "replay of x1 (thinking re-read)", "z-ext1": "replay of x1 (quote-verified extraction)", "t-x1r": "x1 re-run (byte-identical to x1)" }
const REFERENCE = { "pb:large": "31b P-B (Gemma 4 31b, same P-B pipeline)" }
const KNOWN_H = new Set(["h4", "h6", "hdru", "hdru6", "hdrud10", "hfill"])
const categoryOf = (id) => (REFERENCE[id] ? "reference" : DIAGNOSTIC[id] ? "diagnostic" : AGENT.includes(id) ? "agent" : HYBRID.includes(id) ? "hybrid" : ONE_SHOT.includes(id) ? "one-shot" : "other")
const ignored = (id) => id.startsWith("y") || (id.startsWith("h") && !KNOWN_H.has(id)) // round-4 workers y and h

const MAIN = {
    "one-shot": ["pb", "pbs", "gates", "p3"],
    hybrid: ["n-g5", "g10"], // + any other hybrid with >= 2 sets (added below)
    agent: ["agent", "t1", "t2", "t3", "g5", "k3", "t-lk", "t-lx", "x1", "j2", "m2"],
}
const LADDER = [
    ["agent", "frozen e2b agent (text SEARCH/OPEN/ANSWER)"],
    ["t1", "+ native tool calls"],
    ["t2", "+ top-3 results in full text"],
    ["t3", "+ separate sandwich answer call"],
    ["g5", "+ asker's-mailbox search + small-model hygiene"],
    ["g2", "+ harness runs the first search"],
    ["k1", "+ per-email YES/NO commit check, list-pick explore"],
    ["k3", "+ cross-encoder-ordered pick list"],
    ["x1", "+ logprob handover of unsure commits to g5"],
]
const LABEL = { agent: "frozen agent", pb: "P-B", "pb:large": "31b P-B" }

// ---------- load and join ----------
const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
if (judge.provider !== "openrouter") throw new Error(`J1 is ${judge.provider}:${judge.model}; .env not loaded?`)
const verdicts = verdictIndex(dataDir)
const setKeys = new Map(SETS.map((name) => [name, new Set(loadSet(dataDir, name, pool).questionKeys)]))
const setSize = (name) => setKeys.get(name).size

const raw = new Map() // id -> set -> version -> { items, records }
const technical = new Map()
for (const answer of latestAnswers(dataDir)) {
    if (!setKeys.has(answer.set) || !setKeys.get(answer.set).has(answer.questionKey)) continue
    const id = answer.alias === "small" ? answer.variant : `${answer.variant}:${answer.alias}`
    if (ignored(id)) continue
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
    slot.items.push({ key: `${answer.set}|${answer.questionKey}`, set: answer.set, user: record.user, stratum: record.stratum, correct, wallMs: answer.wallMs ?? 0, calls: answer.calls ?? 0, status: answer.status, technical: pre?.source === "technical" })
}

// coverage: per (id, set) choose the version with full graded coverage (latest if several)
const covered = new Map() // id -> set -> { version, items }
const gaps = []
const duplicates = []
for (const [id, bySet] of raw) {
    for (const [set, byVersion] of bySet) {
        const full = []
        for (const [version, slot] of byVersion) {
            const unique = new Set(slot.items.map((item) => item.key)).size
            if (unique !== slot.records) duplicates.push({ id, set, version, records: slot.records, unique })
            const graded = slot.items.filter((item) => item.correct !== null).length
            if (unique === setSize(set) && graded === setSize(set)) full.push(version)
            else gaps.push({ id, set, version, answered: unique, graded, size: setSize(set) })
        }
        if (full.length > 1) duplicates.push({ id, set, versions: full, note: "several fully graded versions; latest used" })
        if (full.length) {
            const version = full.sort().at(-1)
            if (!covered.has(id)) covered.set(id, new Map())
            covered.get(id).set(set, { version, items: byVersion.get(version).items })
        }
    }
}
const setsOf = (id) => SETS.filter((set) => covered.get(id)?.has(set))
const itemsOf = (id, sets) => sets.flatMap((set) => covered.get(id)?.get(set)?.items ?? [])
const versionsOf = (id) => [...new Set(setsOf(id).map((set) => covered.get(id).get(set).version))].join(",")

// ---------- statistics ----------
const pctl = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
const meanOf = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

function stratifiedBootstrap(pairs) {
    const miss = pairs.filter((p) => p.stratum === "miss").map((p) => p.a - p.b)
    const hit = pairs.filter((p) => p.stratum === "hit").map((p) => p.a - p.b)
    const est = (m, h) => missShare * m + (1 - missShare) * h
    const point = est(meanOf(miss), meanOf(hit))
    const random = splitmix32(SEED)
    const draws = []
    for (let draw = 0; draw < B; draw++) {
        let sm = 0, sh = 0
        for (let i = 0; i < miss.length; i++) sm += miss[Math.floor(random() * miss.length)]
        for (let i = 0; i < hit.length; i++) sh += hit[Math.floor(random() * hit.length)]
        draws.push(est(sm / miss.length, sh / hit.length))
    }
    draws.sort((x, y) => x - y)
    const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))]
    return { weighted: point, miss: meanOf(miss), hit: meanOf(hit), low: at(0.025), high: at(0.975) }
}

function pairsVs(id, refId, sets) {
    const ref = new Map(itemsOf(refId, sets).map((item) => [item.key, item]))
    return itemsOf(id, sets).filter((item) => ref.has(item.key)).map((item) => ({ user: item.user, stratum: item.stratum, a: item.correct, b: ref.get(item.key).correct }))
}

function accuracy(items) {
    const acc = weighted(items, missShare)
    return { n: items.length, nMiss: acc.nMiss, nHit: acc.nHit, weighted: 100 * acc.weighted, miss: 100 * acc.miss, hit: 100 * acc.hit }
}
function cost(items) {
    const walls = items.map((item) => item.wallMs), calls = items.map((item) => item.calls)
    return { wallMean: meanOf(walls), wallP50: pctl(walls, 0.5), wallP95: pctl(walls, 0.95), wallMax: Math.max(...walls), callsMean: meanOf(calls), callsMax: Math.max(...calls), technical: items.filter((item) => item.technical).length, outputLimit: items.filter((item) => item.status === "output_limit").length }
}
const scale = (d) => (d ? { weighted: 100 * d.weighted, miss: 100 * d.miss, hit: 100 * d.hit, low: 100 * d.low, high: 100 * d.high } : null)

function setRow(id, set) {
    const items = itemsOf(id, [set])
    const delta = id === "gates" || !covered.get("gates")?.has(set) ? null : scale(pairedBootstrap(pairsVs(id, "gates", [set]), missShare, { B, seed: SEED }))
    return { variant: id, category: categoryOf(id), set, version: covered.get(id).get(set).version, ...accuracy(items), vsGates: delta, ciMethod: "paired mailbox-cluster bootstrap (analyze.js)", ...cost(items) }
}

function pooledRow(id, sets, label, refId = "gates") {
    if (!sets.length) return null
    const items = itemsOf(id, sets)
    const pairs = pairsVs(id, refId, sets)
    const isRef = id === refId
    return {
        variant: id, category: categoryOf(id), pool: label, sets, ...accuracy(items),
        vsGates: isRef ? null : scale(stratifiedBootstrap(pairs)),
        vsGatesCluster: isRef ? null : scale(pairedBootstrap(pairs, missShare, { B, seed: SEED })),
        gatesSame: accuracy(itemsOf(refId, sets)).weighted,
        ciMethod: "paired stratified bootstrap over the union of questions",
        ...cost(items),
    }
}

// ---------- build ----------
const allIds = [...covered.keys()].sort()
const hybridsExtra = allIds.filter((id) => categoryOf(id) === "hybrid" && setsOf(id).length >= 2 && !MAIN.hybrid.includes(id))
MAIN.hybrid.push(...hybridsExtra)
const mainIds = [...MAIN["one-shot"], ...MAIN.hybrid, ...MAIN.agent]
const ceilingIds = ["oracles", "oracle", "pb:large"].filter((id) => covered.has(id))

const perSet = []
for (const id of allIds) for (const set of setsOf(id)) perSet.push(setRow(id, set))

const pooled = []
for (const id of allIds) {
    const sets = setsOf(id)
    pooled.push(pooledRow(id, sets, "all"))
    const noF0 = sets.filter((set) => set !== "FULL-0")
    if (noF0.length && noF0.length !== sets.length) pooled.push(pooledRow(id, noF0, "noF0"))
    if (sets.includes("S300-2") && sets.includes("S300-1")) pooled.push(pooledRow(id, ["S300-2", "S300-1"], "S2+S1"))
    if (sets.includes("S300-3") && sets.includes("FULL-1")) pooled.push(pooledRow(id, ["S300-3", "FULL-1"], "S3+F1"))
}
const pooledOf = (id, label) => pooled.find((row) => row.variant === id && row.pool === label) ?? (label === "noF0" && !setsOf(id).includes("FULL-0") ? pooled.find((row) => row.variant === id && row.pool === "all") : null)

// gates-anchored pooled score: gates' pooled weighted over all five sets + the variant's
// paired Δ vs gates over its own sets (puts variants run on different sets on one scale)
const gatesAll = pooledOf("gates", "all").weighted
const anchored = (id) => { const row = pooledOf(id, "all"); return row ? (id === "gates" ? gatesAll : gatesAll + row.vsGates.weighted) : null }

// Pareto over deployable variants with >= 2 graded sets
const paretoPts = allIds
    .filter((id) => ["one-shot", "hybrid", "agent"].includes(categoryOf(id)) && setsOf(id).length >= 2)
    .map((id) => { const row = pooledOf(id, "all"); return { variant: id, category: categoryOf(id), sets: setsOf(id), n: row.n, anchored: anchored(id), pooled: row.weighted, delta: row.vsGates?.weighted ?? 0, low: row.vsGates?.low ?? 0, high: row.vsGates?.high ?? 0, wallMean: row.wallMean, callsMean: row.callsMean } })
function frontier(points, key) {
    const sorted = [...points].sort((a, b) => a.wallMean - b.wallMean || b[key] - a[key])
    const out = []
    let best = -Infinity
    for (const point of sorted) if (point[key] > best + 1e-9) { out.push(point); best = point[key] }
    return out
}
const frontierAnchored = frontier(paretoPts, "anchored")
const frontierRaw = frontier(paretoPts, "pooled")
// robust frontier: only variants graded on >= 3 sets (variants seen only on the two
// screening sets S300-2/S300-1 carry selection optimism: they were picked there)
const screeningOnly = (p) => p.sets.every((set) => set === "S300-2" || set === "S300-1")
const frontierRobust = frontier(paretoPts.filter((p) => p.sets.length >= 3), "anchored")

// ladder, pooled S300-2 + S300-1
const LS = ["S300-2", "S300-1"]
const ladder = []
for (let index = 0; index < LADDER.length; index++) {
    const [id, what] = LADDER[index]
    if (!LS.every((set) => covered.get(id)?.has(set))) { ladder.push({ variant: id, what, missing: true }); continue }
    const acc = accuracy(itemsOf(id, LS))
    const prev = index ? LADDER[index - 1][0] : null
    const step = prev ? scale(stratifiedBootstrap(pairsVs(id, prev, LS))) : null
    const vsFrozen = index ? scale(stratifiedBootstrap(pairsVs(id, "agent", LS))) : null
    const vsGates = scale(stratifiedBootstrap(pairsVs(id, "gates", LS)))
    ladder.push({ variant: id, what, ...acc, step, vsFrozen, vsGates, perSet: Object.fromEntries(LS.map((set) => [set, accuracy(itemsOf(id, [set])).weighted])), ...cost(itemsOf(id, LS)) })
}
const ladderRefs = Object.fromEntries(["gates", "t-lx", "t-lk", "j2", "m2"].filter((id) => LS.every((set) => covered.get(id)?.has(set))).map((id) => [id, { ...accuracy(itemsOf(id, LS)), vsX1: scale(stratifiedBootstrap(pairsVs(id, "x1", LS))), ...cost(itemsOf(id, LS)) }]))

// provisional rows: near-complete coverage (>= 99% answered, every answer graded); shown
// separately, never pooled
const provisional = gaps.filter((g) => g.answered >= 0.99 * g.size && g.graded === g.answered && g.answered < g.size).map((g) => {
    const items = raw.get(g.id).get(g.set).get(g.version).items
    const ref = new Map(itemsOf("gates", [g.set]).map((item) => [item.key, item]))
    const pairs = items.filter((item) => ref.has(item.key)).map((item) => ({ user: item.user, stratum: item.stratum, a: item.correct, b: ref.get(item.key).correct }))
    return { variant: g.id, set: g.set, version: g.version, answered: g.answered, size: g.size, ...accuracy(items), vsGates: scale(pairedBootstrap(pairs, missShare, { B, seed: SEED })), ...cost(items) }
})

// sensitivity: fold the provisional rows into their variant's pool and recompute the
// anchored score and the robust frontier
const withProv = (id) => [...itemsOf(id, setsOf(id)), ...provisional.filter((r) => r.variant === id).flatMap((r) => raw.get(id).get(r.set).get(r.version).items)]
const pairsOf = (aItems, bItems) => { const ref = new Map(bItems.map((item) => [item.key, item])); return aItems.filter((item) => ref.has(item.key)).map((item) => ({ user: item.user, stratum: item.stratum, a: item.correct, b: ref.get(item.key).correct })) }
const gatesItemsAll = itemsOf("gates", SETS)
const sensitivity = [...new Set(provisional.map((r) => r.variant))].map((id) => {
    const items = withProv(id)
    const d = scale(stratifiedBootstrap(pairsOf(items, gatesItemsAll)))
    const sets = [...new Set(items.map((item) => item.set))]
    return { variant: id, category: categoryOf(id), sets: SETS.filter((set) => sets.includes(set)), n: items.length, anchored: gatesAll + d.weighted, pooled: accuracy(items).weighted, delta: d.weighted, low: d.low, high: d.high, wallMean: meanOf(items.map((item) => item.wallMs)), callsMean: meanOf(items.map((item) => item.calls)) }
})
const paretoSens = paretoPts.map((p) => sensitivity.find((s) => s.variant === p.variant) ?? p)
const frontierRobustSens = frontier(paretoSens.filter((p) => p.sets.length >= 3), "anchored")

// head-to-head on shared questions (paired stratified; provisional rows included where marked)
const H2H = [["t-lk", "x1"], ["t-lk", "k3"], ["k3", "x1"], ["g5", "x1"], ["p3", "x1"], ["t-lx", "x1"], ["j2", "x1"], ["m2", "x1"], ["n-g5", "gates"], ["p3", "gates"]]
const headToHead = []
for (const [a, b] of H2H) {
    if (!covered.has(a) || !covered.has(b)) continue
    for (const prov of [false, true]) {
        const aItems = prov ? withProv(a) : itemsOf(a, setsOf(a))
        const bItems = prov ? withProv(b) : itemsOf(b, setsOf(b))
        if (prov && aItems.length === itemsOf(a, setsOf(a)).length && bItems.length === itemsOf(b, setsOf(b)).length) continue
        const pairs = pairsOf(aItems, bItems)
        if (!pairs.length) continue
        const shared = SETS.filter((set) => aItems.some((item) => item.set === set) && bItems.some((item) => item.set === set))
        headToHead.push({ a, b, provisionalIncluded: prov, sets: shared, n: pairs.length, ...scale(stratifiedBootstrap(pairs)) })
    }
}

// paired comparison with the 31b P-B reference on FULL-0 (the only set it was run on)
const vs31b = covered.get("pb:large")?.has("FULL-0")
    ? [...new Set(["pb", "pbs", "gates", "r4", "r5", "n-g5", "g10", "agent", "g5", "k3", "x1", "oracles"])].filter((id) => covered.get(id)?.has("FULL-0")).map((id) => ({ variant: id, ...accuracy(itemsOf(id, ["FULL-0"])), vs31b: scale(pairedBootstrap(pairsVs(id, "pb:large", ["FULL-0"]), missShare, { B, seed: SEED })) }))
    : []

// ---------- outputs ----------
mkdirSync(OUT, { recursive: true })
const json = {
    at: new Date().toISOString(), sets: SETS, setSizes: Object.fromEntries(SETS.map((set) => [set, setSize(set)])), missShare, judge: `${judge.provider}:${judge.model}`,
    bootstrap: { B, seed: SEED, perSet: "paired mailbox-cluster (explore/analyze.js pairedBootstrap)", pooled: "paired stratified (miss/hit) over the union of questions; cluster CI in vsGatesCluster" },
    capMs: CAP_MS, gatesAllPooled: gatesAll, main: MAIN, ceilings: ceilingIds,
    perSet, pooled, pareto: { yAxis: "gates-anchored pooled weighted = gates' 5-set pooled + paired pooled Δ vs gates on the variant's own sets", points: paretoPts, frontierAnchored: frontierAnchored.map((p) => p.variant), frontierRobust3Sets: frontierRobust.map((p) => p.variant), frontierRaw: frontierRaw.map((p) => p.variant) },
    ladder, ladderRefs, vs31bFull0: vs31b, provisional, sensitivity: { points: sensitivity, frontierRobust3SetsWithProvisional: frontierRobustSens.map((p) => p.variant) }, headToHead, coverageGaps: gaps, duplicates,
    excluded: { diagnostic: DIAGNOSTIC, reference: REFERENCE, ignoredPrefixes: "y*, h* (round-4 workers; h4/h6/hdru* kept)", singleSet: allIds.filter((id) => setsOf(id).length === 1) },
}
writeFileSync(OUT + "final-tables.json", JSON.stringify(json, null, 2))

const f = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "" : v.toFixed(d))
const csvHead = ["row", "variant", "category", "sets", "version", "n", "n_miss", "n_hit", "weighted", "miss", "hit", "delta_vs_gates", "ci_low", "ci_high", "ci_method", "cluster_ci_low", "cluster_ci_high", "gates_weighted_same_questions", "wall_mean_ms", "wall_p50_ms", "wall_p95_ms", "wall_max_ms", "calls_mean", "calls_max", "technical_failures", "output_limit"]
const csv = [csvHead.join(",")]
for (const r of perSet) csv.push(["set", r.variant, r.category, r.set, r.version, r.n, r.nMiss, r.nHit, f(r.weighted), f(r.miss), f(r.hit), f(r.vsGates?.weighted), f(r.vsGates?.low), f(r.vsGates?.high), r.vsGates ? "cluster" : "", "", "", "", f(r.wallMean, 0), r.wallP50, r.wallP95, r.wallMax, f(r.callsMean), r.callsMax, r.technical, r.outputLimit].join(","))
for (const r of pooled) csv.push([`pooled_${r.pool}`, r.variant, r.category, r.sets.join("+"), versionsOf(r.variant), r.n, r.nMiss, r.nHit, f(r.weighted), f(r.miss), f(r.hit), f(r.vsGates?.weighted), f(r.vsGates?.low), f(r.vsGates?.high), r.vsGates ? "stratified" : "", f(r.vsGatesCluster?.low), f(r.vsGatesCluster?.high), f(r.gatesSame), f(r.wallMean, 0), r.wallP50, r.wallP95, r.wallMax, f(r.callsMean), r.callsMax, r.technical, r.outputLimit].join(","))
writeFileSync(OUT + "final-tables.csv", csv.join("\n") + "\n")

// ---------- markdown ----------
const p1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(1))
const sg = (v) => { const r = Number(v.toFixed(1)); return (r >= 0 ? "+" : "−") + Math.abs(r).toFixed(1) }
const dci = (d) => (d ? `${sg(d.weighted)} [${sg(d.low)}, ${sg(d.high)}]`.replace(/\[\+/, "[").replace(/, \+/, ", ") : "–")
const name = (id) => LABEL[id] ?? id
const md = []
md.push(`### Main table: weighted J1 per set (Δ vs gates on the same questions)`, "")
md.push(`| category | variant | ${SETS.join(" | ")} | wall ms | calls |`, `|---|---|${SETS.map(() => "---|").join("")}---|---|`)
const cellOf = (id, set) => { const r = perSet.find((row) => row.variant === id && row.set === set); return r ? `${p1(r.weighted)}${r.vsGates ? ` (${sg(r.vsGates.weighted)})` : ""}` : (gaps.some((g) => g.id === id && g.set === set) ? "gap" : "") }
for (const [category, ids] of Object.entries(MAIN)) for (const id of ids) {
    if (!covered.has(id)) continue
    const all = pooledOf(id, "all")
    md.push(`| ${category} | ${name(id)} | ${SETS.map((set) => cellOf(id, set)).join(" | ")} | ${Math.round(all.wallMean).toLocaleString("en-US")} | ${all.callsMean.toFixed(1)} |`)
}
for (const id of ceilingIds) { const all = pooledOf(id, "all"); md.push(`| ${categoryOf(id)} | ${name(id)}${DIAGNOSTIC[id] ? ` (${DIAGNOSTIC[id]})` : ""} | ${SETS.map((set) => cellOf(id, set)).join(" | ")} | ${Math.round(all.wallMean).toLocaleString("en-US")} | ${all.callsMean.toFixed(1)} |`) }
md.push("")
md.push(`### Pooled (Δ vs gates on the same questions, paired stratified bootstrap 95% CI)`, "")
md.push(`| category | variant | sets | n | pooled W (miss / hit) | Δ vs gates [CI] | gates same q | excl. FULL-0: n | W | Δ vs gates [CI] | S300-3+FULL-1: W | Δ vs gates [CI] |`, `|---|---|---|---|---|---|---|---|---|---|---|---|`)
const short = (sets) => sets.map((set) => set.replace("S300-", "S").replace("FULL-", "F")).join("+")
const pooledLine = (category, id) => {
    const a = pooledOf(id, "all"), b = pooledOf(id, "noF0"), c = pooledOf(id, "S3+F1")
    const hasF0 = setsOf(id).includes("FULL-0")
    return `| ${category} | ${name(id)} | ${short(a.sets)} | ${a.n} | ${p1(a.weighted)} (${p1(a.miss)} / ${p1(a.hit)}) | ${dci(a.vsGates)} | ${p1(a.gatesSame)} | ${b ? (hasF0 ? b.n : "same") : "–"} | ${b && hasF0 ? p1(b.weighted) : b ? "" : "–"} | ${b && hasF0 ? dci(b.vsGates) : b ? "" : "–"} | ${c ? p1(c.weighted) : "–"} | ${c ? dci(c.vsGates) : "–"} |`
}
for (const [category, ids] of Object.entries(MAIN)) for (const id of ids) if (covered.has(id)) md.push(pooledLine(category, id))
for (const id of ceilingIds) md.push(pooledLine(categoryOf(id), id))
md.push("")
md.push(`### Cost per question (pooled over each variant's graded sets; cap ${CAP_MS.toLocaleString("en-US")} ms mean)`, "")
md.push(`| category | variant | n | wall mean | p50 | p95 | max | calls mean | calls max | mean ≤ cap |`, `|---|---|---|---|---|---|---|---|---|---|`)
for (const [category, ids] of Object.entries(MAIN)) for (const id of ids) if (covered.has(id)) { const a = pooledOf(id, "all"); md.push(`| ${category} | ${name(id)} | ${a.n} | ${Math.round(a.wallMean).toLocaleString("en-US")} | ${a.wallP50.toLocaleString("en-US")} | ${a.wallP95.toLocaleString("en-US")} | ${a.wallMax.toLocaleString("en-US")} | ${a.callsMean.toFixed(2)} | ${a.callsMax} | ${a.wallMean <= CAP_MS ? "yes" : "**no**"} |`) }
for (const id of ceilingIds) { const a = pooledOf(id, "all"); md.push(`| ${categoryOf(id)} | ${name(id)} | ${a.n} | ${Math.round(a.wallMean).toLocaleString("en-US")} | ${a.wallP50.toLocaleString("en-US")} | ${a.wallP95.toLocaleString("en-US")} | ${a.wallMax.toLocaleString("en-US")} | ${a.callsMean.toFixed(2)} | ${a.callsMax} | ${a.wallMean <= CAP_MS ? "yes" : "no (different model)"} |`) }
md.push("")
md.push(`### Pareto frontier (gates-anchored pooled W = gates' 5-set pooled ${p1(gatesAll)} + paired Δ vs gates on the variant's own sets)`, "")
md.push(`| variant | category | sets | anchored W | Δ vs gates [CI] | raw pooled W | wall mean ms | calls |`, `|---|---|---|---|---|---|---|---|`)
for (const p of frontierAnchored) md.push(`| ${name(p.variant)} | ${p.category} | ${short(p.sets)} | ${p1(p.anchored)} | ${p.variant === "gates" ? "–" : dci({ weighted: p.delta, low: p.low, high: p.high })} | ${p1(p.pooled)} | ${Math.round(p.wallMean).toLocaleString("en-US")} | ${p.callsMean.toFixed(1)} |`)
md.push("", `Robust frontier (only variants graded on ≥ 3 sets):`, "")
md.push(`| variant | category | sets | anchored W | Δ vs gates [CI] | raw pooled W | wall mean ms | calls |`, `|---|---|---|---|---|---|---|---|`)
for (const p of frontierRobust) md.push(`| ${name(p.variant)} | ${p.category} | ${short(p.sets)} | ${p1(p.anchored)} | ${p.variant === "gates" ? "–" : dci({ weighted: p.delta, low: p.low, high: p.high })} | ${p1(p.pooled)} | ${Math.round(p.wallMean).toLocaleString("en-US")} | ${p.callsMean.toFixed(1)} |`)
md.push("", `Sensitivity, with the provisional rows (≥ 99% coverage) folded in: ${sensitivity.map((p) => `${name(p.variant)} → ${short(p.sets)}, n ${p.n}, Δ vs gates ${dci({ weighted: p.delta, low: p.low, high: p.high })}, anchored ${p1(p.anchored)}, ${Math.round(p.wallMean).toLocaleString("en-US")} ms`).join("; ")}. Robust frontier then: ${frontierRobustSens.map((p) => `${name(p.variant)} (${p1(p.anchored)}, ${Math.round(p.wallMean).toLocaleString("en-US")} ms)`).join(" → ")}.`)
md.push("", `Frontier on raw pooled W instead: ${frontierRaw.map((p) => `${name(p.variant)} (${p1(p.pooled)}, ${Math.round(p.wallMean)} ms)`).join(" → ")}`, "")
md.push(`### All deployable variants with ≥ 2 graded sets (sorted by anchored W)`, "")
md.push(`| variant | category | sets | n | anchored W | Δ vs gates [CI] | cluster CI | raw pooled W | wall mean ms | calls | frontier (all / ≥3 sets) |`, `|---|---|---|---|---|---|---|---|---|---|---|`)
for (const p of [...paretoPts].sort((a, b) => b.anchored - a.anchored)) {
    const cl = pooledOf(p.variant, "all").vsGatesCluster
    md.push(`| ${name(p.variant)} | ${p.category} | ${short(p.sets)} | ${p.n} | ${p1(p.anchored)} | ${p.variant === "gates" ? "–" : dci({ weighted: p.delta, low: p.low, high: p.high })} | ${cl ? `[${sg(cl.low)}, ${sg(cl.high)}]`.replace(/\[\+/, "[").replace(/, \+/, ", ") : "–"} | ${p1(p.pooled)} | ${Math.round(p.wallMean).toLocaleString("en-US")} | ${p.callsMean.toFixed(1)} | ${[frontierAnchored.includes(p) ? "all" : "", frontierRobust.includes(p) ? "≥3" : ""].filter(Boolean).join(", ")} |`)
}
md.push("")
md.push(`### Agentic-gap ladder (pooled S300-2 + S300-1, n = 600; step Δ vs the previous rung, paired stratified bootstrap)`, "")
md.push(`| # | rung | component added | S300-2 | S300-1 | pooled W (miss / hit) | step Δ [CI] | Δ vs frozen | wall ms | calls |`, `|---|---|---|---|---|---|---|---|---|---|`)
ladder.forEach((r, i) => md.push(r.missing ? `| ${i} | ${name(r.variant)} | ${r.what} | missing |||||||` : `| ${i} | ${name(r.variant)} | ${r.what} | ${p1(r.perSet["S300-2"])} | ${p1(r.perSet["S300-1"])} | ${p1(r.weighted)} (${p1(r.miss)} / ${p1(r.hit)}) | ${dci(r.step)} | ${r.vsFrozen ? sg(r.vsFrozen.weighted) : "–"} | ${Math.round(r.wallMean).toLocaleString("en-US")} | ${r.callsMean.toFixed(2)} |`))
for (const [id, r] of Object.entries(ladderRefs)) md.push(`| ref | ${id} | ${id === "gates" ? "no agent (one-shot champion)" : "vs x1: " + dci(r.vsX1)} | ${p1(accuracy(itemsOf(id, ["S300-2"])).weighted)} | ${p1(accuracy(itemsOf(id, ["S300-1"])).weighted)} | ${p1(r.weighted)} (${p1(r.miss)} / ${p1(r.hit)}) | | | ${Math.round(r.wallMean).toLocaleString("en-US")} | ${r.callsMean.toFixed(2)} |`)
md.push("")
md.push(`### Head-to-head on shared questions (paired stratified bootstrap; "+prov" = provisional ≥ 99% rows included)`, "")
md.push(`| A | B | shared sets | n | Δ (A − B) [CI] | Δ miss | Δ hit |`, `|---|---|---|---|---|---|---|`)
for (const r of headToHead) md.push(`| ${name(r.a)} | ${name(r.b)} | ${short(r.sets)}${r.provisionalIncluded ? " (+prov)" : ""} | ${r.n} | ${dci(r)} | ${sg(r.miss)} | ${sg(r.hit)} |`)
md.push("")
md.push(`### Paired vs 31b P-B on FULL-0 (the only set with the 31b run; mailbox-cluster bootstrap)`, "")
md.push(`| variant | FULL-0 W | miss | hit | Δ vs 31b P-B [CI] | Δ miss | Δ hit |`, `|---|---|---|---|---|---|---|`)
for (const r of vs31b) md.push(`| ${name(r.variant)} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vs31b)} | ${sg(r.vs31b.miss)} | ${sg(r.vs31b.hit)} |`)
md.push("")
md.push(`### Per-set detail (Δ vs gates: paired mailbox-cluster bootstrap, as cli2 report)`, "")
md.push(`| variant | set | n | W | miss | hit | Δ vs gates [CI] | wall mean | calls |`, `|---|---|---|---|---|---|---|---|---|`)
for (const id of [...mainIds, ...ceilingIds]) for (const r of perSet.filter((row) => row.variant === id)) md.push(`| ${name(id)} | ${r.set} | ${r.n} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vsGates)} | ${Math.round(r.wallMean).toLocaleString("en-US")} | ${r.callsMean.toFixed(2)} |`)
md.push("")
md.push(`### Coverage gaps (phase-2 sets; not used)`, "")
for (const g of gaps) md.push(`- ${g.id}@${g.version} on ${g.set}: ${g.answered}/${g.size} answered, ${g.graded} graded`)
if (provisional.length) {
    md.push("", `Provisional rows (≥ 99% answered, all graded; Δ vs gates on the answered questions, cluster bootstrap; not pooled):`, "")
    md.push(`| variant | set | answered | W | miss | hit | Δ vs gates [CI] | wall mean | calls |`, `|---|---|---|---|---|---|---|---|---|`)
    for (const r of provisional) md.push(`| ${name(r.variant)} | ${r.set} | ${r.answered}/${r.size} | ${p1(r.weighted)} | ${p1(r.miss)} | ${p1(r.hit)} | ${dci(r.vsGates)} | ${Math.round(r.wallMean).toLocaleString("en-US")} | ${r.callsMean.toFixed(2)} |`)
}
if (!gaps.length) md.push("- none")
md.push("", `Duplicates: ${duplicates.length ? duplicates.map((d) => JSON.stringify(d)).join("; ") : "none"}`)
md.push(`Single-set variants (not pooled/plotted): ${json.excluded.singleSet.join(", ")}`)

// ---------- SVG: Pareto ----------
const COLORS = { "one-shot": "#1f6fb4", hybrid: "#d4820a", agent: "#11906b" }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
function paretoSvg() {
    // plotted with the provisional (>= 99% coverage) rows folded in; such points carry a *
    const PTS = paretoSens, FRA = frontier(paretoSens, "anchored"), FRR = frontierRobustSens
    const star = (id) => (sensitivity.some((p) => p.variant === id) ? "*" : "")
    const W = 1200, H = 820, L = 70, R = 30, T = 76, Bm = 138
    const yMin = 78, yMax = 90.5, xMax = 3600
    const X = (ms) => L + (ms / xMax) * (W - L - R)
    const Y = (v) => T + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (H - T - Bm)
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`]
    parts.push(`<text x="${L}" y="26" font-size="17" font-weight="bold" fill="#111">Accuracy vs cost: e2b on EnronQA exploration sets (J1, design-weighted)</text>`)
    parts.push(`<text x="${L}" y="45" font-size="12" fill="#444">y: gates-anchored pooled weighted accuracy = gates' pooled score over all 5 sets (${p1(gatesAll)}) + the variant's paired Δ vs gates on its own sets.</text><text x="${L}" y="61" font-size="12" fill="#444">x: mean wall time per question. Every deployable variant graded on ≥ 2 of the 5 sets (S300-2, S300-1, S300-3, FULL-0, FULL-1).</text>`)
    for (let v = Math.ceil(yMin); v <= yMax; v += 1) parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e5e5"/><text x="${L - 8}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="#333">${v}</text>`)
    for (let ms = 0; ms <= xMax; ms += 500) parts.push(`<line x1="${X(ms)}" x2="${X(ms)}" y1="${T}" y2="${H - Bm}" stroke="#f0f0f0"/><text x="${X(ms)}" y="${H - Bm + 16}" font-size="11" text-anchor="middle" fill="#333">${ms.toLocaleString("en-US")}</text>`)
    parts.push(`<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - Bm}" fill="none" stroke="#888"/>`)
    parts.push(`<text x="${(L + W - R) / 2}" y="${H - Bm + 36}" font-size="13" text-anchor="middle" fill="#111">mean wall time per question (ms)</text>`)
    parts.push(`<text transform="translate(18 ${(T + H - Bm) / 2}) rotate(-90)" font-size="13" text-anchor="middle" fill="#111">weighted accuracy (%)</text>`)
    // cost cap
    parts.push(`<line x1="${X(CAP_MS)}" x2="${X(CAP_MS)}" y1="${T}" y2="${H - Bm}" stroke="#c0392b" stroke-width="2" stroke-dasharray="6 4"/><text x="${X(CAP_MS) - 6}" y="${T + 16}" font-size="12" text-anchor="end" fill="#c0392b">cost cap 3,243 ms (5× P-B)</text>`)
    // references (FULL-0 deltas vs gates, anchored)
    const refLine = (id, label, dy) => { const r = perSet.find((row) => row.variant === id && row.set === "FULL-0"); if (!r?.vsGates) return; const v = gatesAll + r.vsGates.weighted; parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#777" stroke-dasharray="3 4"/><text x="${X(CAP_MS) - 8}" y="${Y(v) + dy}" font-size="11" text-anchor="end" fill="#555">${esc(label)}: FULL-0 ${p1(r.weighted)} = gates ${sg(r.vsGates.weighted)} → ${p1(v)}</text>`) }
    refLine("oracles", "gold email only (reading ceiling)", -6)
    refLine("pb:large", "31b P-B (external reference)", 15)
    // frontier step lines: all points (dashed) and robust >= 3 sets (solid)
    const step = (fr) => { let d = ""; fr.filter((p) => p.anchored >= yMin).forEach((p, i) => { d += i ? ` H ${X(p.wallMean).toFixed(1)} V ${Y(p.anchored).toFixed(1)}` : `M ${X(p.wallMean).toFixed(1)} ${Y(p.anchored).toFixed(1)}` }); return d }
    parts.push(`<path d="${step(FRA)}" fill="none" stroke="#999" stroke-width="1.3" stroke-dasharray="5 3"/>`)
    parts.push(`<path d="${step(FRR)}" fill="none" stroke="#333" stroke-width="2"/>`)
    // points + greedy labels
    const placed = []
    const boxes = PTS.filter((p) => p.anchored >= yMin).map((p) => ({ x: X(p.wallMean) - 5, y: Y(p.anchored) - 5, w: 10, h: 10 }))
    const overlaps = (b) => [...placed, ...boxes].some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    const below = []
    const order = [...PTS].sort((a, b) => (["gates", "x1"].includes(b.variant) - ["gates", "x1"].includes(a.variant)) || (FRR.includes(b) - FRR.includes(a)) || (FRA.includes(b) - FRA.includes(a)))
    for (const p of order) {
        const key = p.variant === "gates" || p.variant === "x1"
        const onFront = FRA.includes(p) || FRR.includes(p)
        if (p.anchored < yMin) { below.push(p); continue }
        const cx = X(p.wallMean), cy = Y(p.anchored)
        const hollow = screeningOnly(p)
        parts.push(key ? `<circle cx="${cx}" cy="${cy}" r="8" fill="${COLORS[p.category]}" stroke="#000" stroke-width="2.5"/>` : hollow ? `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#fff" stroke="${COLORS[p.category]}" stroke-width="2"/>` : `<circle cx="${cx}" cy="${cy}" r="${onFront ? 5.5 : 4.8}" fill="${COLORS[p.category]}" stroke="${onFront ? "#000" : "#fff"}" stroke-width="1"/>`)
        const text = name(p.variant) + star(p.variant)
        const size = key ? 14 : FRR.includes(p) ? 11.5 : 10
        const w = text.length * size * 0.58, h = size
        let cands = [[10, 4], [-10 - w, 4], [-w / 2, -9], [-w / 2, 4 + h + 4], [10, -8], [10, 14], [-10 - w, -8], [-10 - w, 14], [14, -18], [14, 24], [-14 - w, -18], [-14 - w, 24], [-w / 2, -22], [-w / 2, 30], [26, -28], [-26 - w, -28], [26, 34], [-26 - w, 34], [-w / 2, -38], [-w / 2, 46], [40, 4], [-40 - w, 4]]
        // frontier lines leave a point to the right and arrive from below: prefer left / above
        const midFrontier = [FRA, FRR].some((fr) => fr.includes(p) && fr.at(-1) !== p)
        if (midFrontier) cands = [[-12 - w, 4], [-w / 2 - 6, -10], [-12 - w, -8], [-14 - w, -18], ...cands]
        let chosen = null
        for (const [dx, dy] of cands) { const b = { x: cx + dx, y: cy + dy - h + 2, w, h }; if (!overlaps(b) && b.x > L && b.x + w < W - R) { chosen = { dx, dy, b }; break } }
        if (!chosen) chosen = { dx: 10, dy: 4, b: { x: cx + 10, y: cy - h + 6, w, h } }
        placed.push(chosen.b)
        const lx = cx + chosen.dx, ly = cy + chosen.dy
        if (Math.hypot(chosen.dx, chosen.dy) > 16) parts.push(`<line x1="${cx}" y1="${cy}" x2="${lx + (chosen.dx < 0 ? w : 0)}" y2="${ly - h / 3}" stroke="#aaa" stroke-width="0.7"/>`)
        parts.push(`<text x="${lx}" y="${ly}" font-size="${size}" ${key || FRR.includes(p) ? 'font-weight="bold"' : ""} fill="${key ? "#000" : "#222"}">${esc(text)}</text>`)
    }
    // off-scale points
    below.sort((a, b) => a.wallMean - b.wallMean).forEach((p, i) => {
        const cx = X(p.wallMean), cy = H - Bm - 4
        parts.push(`<path d="M ${cx - 5} ${cy - 8} L ${cx + 5} ${cy - 8} L ${cx} ${cy} Z" fill="${COLORS[p.category]}"/><text x="${cx + 8}" y="${cy - 10 - i * 13}" font-size="10.5" fill="#222">${esc(name(p.variant) + star(p.variant))} ${p1(p.anchored)} (off scale)</text>`)
    })
    // legend (two rows)
    let lx = L
    let ly = H - 72
    for (const [cat, color] of Object.entries(COLORS)) { parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${color}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="#111">${cat}</text>`); lx += 95 }
    parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="5" fill="#fff" stroke="#555" stroke-width="2"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="#111">hollow = only screening sets S300-2/S300-1 (selection-optimistic)</text>`)
    lx = L
    ly = H - 52
    parts.push(`<circle cx="${lx + 7}" cy="${ly - 4}" r="7" fill="#fff" stroke="#000" stroke-width="2.5"/><text x="${lx + 19}" y="${ly}" font-size="12" fill="#111">gates (one-shot champion), x1 (best agent)</text>`)
    lx += 290
    parts.push(`<line x1="${lx}" x2="${lx + 24}" y1="${ly - 4}" y2="${ly - 4}" stroke="#333" stroke-width="2"/><text x="${lx + 30}" y="${ly}" font-size="12" fill="#111">frontier, variants on ≥ 3 sets</text>`)
    lx += 215
    parts.push(`<line x1="${lx}" x2="${lx + 24}" y1="${ly - 4}" y2="${ly - 4}" stroke="#999" stroke-width="1.3" stroke-dasharray="5 3"/><text x="${lx + 30}" y="${ly}" font-size="12" fill="#111">frontier, all variants on ≥ 2 sets</text>`)
    parts.push(`<text x="${L}" y="${H - 28}" font-size="10.5" fill="#555">Sets: S300-2, S300-1 (screening), S300-3, FULL-1 (confirmation), FULL-0 (phase-1 selection set, favours gates). Judge J1 = gpt-oss-20b; weighted = 0.068·miss + 0.932·hit.</text>`)
    if (sensitivity.length) parts.push(`<text x="${L}" y="${H - 12}" font-size="10.5" fill="#555">* includes one near-complete set (${esc(provisional.map((r) => `${name(r.variant)} ${r.set} ${r.answered}/${r.size}`).join(", "))}); strict-coverage values are in the tables.</text>`)
    parts.push(`</svg>`)
    return parts.join("\n")
}
writeFileSync(OUT + "final-pareto.svg", paretoSvg())

// ---------- SVG: ladder ----------
function ladderSvg() {
    const rows = ladder.filter((r) => !r.missing)
    const W = 1130, rowH = 46, T = 70, L = 300, CW = 520, A = L + CW + 20
    const H = T + rows.length * rowH + 150
    const X = (v) => L + (v / 100) * CW
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`]
    parts.push(`<text x="20" y="28" font-size="18" font-weight="bold" fill="#111">Closing the agentic gap with interface design (Gemma 4 e2b)</text>`)
    parts.push(`<text x="20" y="48" font-size="12" fill="#444">Weighted J1 accuracy, pooled S300-2 + S300-1 (n = 600). Each rung adds one component to the rung above; step Δ = paired stratified bootstrap 95% CI.</text>`)
    parts.push(`<text x="${A}" y="${T - 6}" font-size="11" font-weight="bold" fill="#333">accuracy</text><text x="${A + 62}" y="${T - 6}" font-size="11" font-weight="bold" fill="#333">step Δ [95% CI]</text><text x="${A + 178}" y="${T - 6}" font-size="11" font-weight="bold" fill="#333">wall ms · calls</text>`)
    const bottom = T + rows.length * rowH
    for (let v = 0; v <= 100; v += 10) parts.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${bottom}" stroke="#eee"/><text x="${X(v)}" y="${bottom + 16}" font-size="11" text-anchor="middle" fill="#333">${v}</text>`)
    parts.push(`<text x="${X(50)}" y="${bottom + 34}" font-size="12" text-anchor="middle" fill="#111">weighted accuracy (%)</text>`)
    rows.forEach((r, i) => {
        const y = T + i * rowH
        const sig = r.step && (r.step.low > 0 || r.step.high < 0)
        const color = i === 0 ? "#9a9a9a" : r.variant === "x1" ? "#0b6e50" : "#11906b"
        parts.push(`<text x="${L - 10}" y="${y + 19}" font-size="13" text-anchor="end" font-weight="bold" fill="#111">${esc(name(r.variant))}</text><text x="${L - 10}" y="${y + 34}" font-size="10.5" text-anchor="end" fill="#555">${esc(r.what)}</text>`)
        parts.push(`<rect x="${X(0)}" y="${y + 7}" width="${X(r.weighted) - X(0)}" height="${rowH - 14}" fill="${color}"/>`)
        if (i > 0) { const prev = rows[i - 1]; const a = Math.min(prev.weighted, r.weighted), b = Math.max(prev.weighted, r.weighted); parts.push(`<rect x="${X(a)}" y="${y + 7}" width="${Math.max(1.5, X(b) - X(a))}" height="${rowH - 14}" fill="${r.step.weighted >= 0 ? "#f2c14e" : "#e07a7a"}"/>`) }
        parts.push(`<text x="${A}" y="${y + 27}" font-size="14" font-weight="bold" fill="#111">${p1(r.weighted)}</text>`)
        if (r.step) parts.push(`<text x="${A + 62}" y="${y + 27}" font-size="12" ${sig ? 'font-weight="bold" fill="#111"' : 'fill="#777"'}>${esc(dci(r.step))}${sig ? "" : " n.s."}</text>`)
        parts.push(`<text x="${A + 178}" y="${y + 27}" font-size="11.5" fill="#444">${Math.round(r.wallMean).toLocaleString("en-US")} · ${r.callsMean.toFixed(1)}</text>`)
    })
    const vline = (v, color, dash) => parts.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${bottom}" stroke="${color}" stroke-width="1.8" stroke-dasharray="${dash}"/>`)
    if (ladderRefs.gates) vline(ladderRefs.gates.weighted, "#1f6fb4", "6 3")
    vline(75.8, "#8e44ad", "2 3")
    let ly = bottom + 58
    parts.push(`<line x1="20" x2="44" y1="${ly - 4}" y2="${ly - 4}" stroke="#1f6fb4" stroke-width="1.8" stroke-dasharray="6 3"/><text x="50" y="${ly}" font-size="11.5" fill="#111">gates, one-shot champion, same 600 questions: ${p1(ladderRefs.gates?.weighted)}</text>`)
    parts.push(`<line x1="400" x2="424" y1="${ly - 4}" y2="${ly - 4}" stroke="#8e44ad" stroke-width="1.8" stroke-dasharray="2 3"/><text x="430" y="${ly}" font-size="11.5" fill="#111">31b frozen agent 75.8 (main study, TEST questions; a context marker, not paired)</text>`)
    parts.push(`<rect x="20" y="${ly + 10}" width="14" height="10" fill="#f2c14e"/><text x="40" y="${ly + 19}" font-size="11.5" fill="#111">gain over the previous rung</text><rect x="210" y="${ly + 10}" width="14" height="10" fill="#e07a7a"/><text x="230" y="${ly + 19}" font-size="11.5" fill="#111">loss</text>`)
    ly += 42
    parts.push(`<text x="20" y="${ly}" font-size="11.5" fill="#333">Interface (native tool calls + full-text results, rungs 0→2): ${sg(rows[2].weighted - rows[0].weighted)} points. Answer call + mailbox scope (2→4): ${sg(rows[4].weighted - rows[2].weighted)}. Agent control (4→8, g5 → x1): ${sg(rows.at(-1).weighted - rows[4].weighted)}.</text>`)
    parts.push(`<text x="20" y="${ly + 18}" font-size="11.5" fill="#333">Judge J1 = gpt-oss-20b; weighted = 0.068·miss + 0.932·hit; cost cap 3,243 ms per question (5× P-B).</text>`)
    parts.push(`</svg>`)
    return parts.join("\n")
}
writeFileSync(OUT + "final-ladder.svg", ladderSvg())

const text = md.join("\n")
if (mdOut) writeFileSync(mdOut, text)
console.log(text)
console.error(`[v-final] wrote ${OUT}final-tables.json, final-tables.csv, final-pareto.svg, final-ladder.svg`)
process.exit(0)
