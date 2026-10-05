// Offline (p): answer-bearing (AB) recall per slot and an end-to-end simulation for
// p-perfect.js configurations, no GPU. Contexts come from p-perfect.js buildContexts
// with cached cross-encoder scores (p-ce.js) and pdense lists. e2b is deterministic
// here (identical prompt -> identical answer), so a question whose first context
// equals a stored sandwich-prompt answer's first context gets that answer's J1
// verdict; only the others are estimated, from P(correct | stratum, AB position in
// the first context) fitted on every stored sandwich-family answer.
//   node benchmarks/premise2/explore2/tools/p-sim.js <sets...> [--only=a,b]

import { join } from "node:path"
import { openAll, SCRATCH, readJsonIf, DATA_DIR } from "./r-common.js"
import { denseLists } from "./p-common.js"
import { buildContexts } from "../variants/p-perfect.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"

process.env.R_ALLOW_HELDOUT = "1"
process.loadEnvFile(".env")
const sets = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7)
const env = await openAll({ sets })
const ce = { std: readJsonIf(join(SCRATCH, "p-ce-std.json"), {}), snip: readJsonIf(join(SCRATCH, "p-ce-snip.json"), {}) }
const dense = denseLists()
const judge = judgeConfig("j1")
const verdicts = verdictIndex(DATA_DIR)
const FAMILY = new Set(["gates", "r1", "r2", "r4", "r5", "s1", "o3", "o11", "oref", "pbs"])
const NOT_P = new Set(["pb", "pbu", "pbuthink", "pbrep", "pb3", "pbfill", "pbs", "pdense"])
const inFamily = (id) => FAMILY.has(id) || (id.startsWith("p") && !NOT_P.has(id))
const known = new Map() // qk|ctx0 -> [{ correct, abstain, read }]
const positionStats = new Map() // stratum|pos -> [right, n]
const abCache = new Map()
const ab = (record, path) => {
    const key = `${record.questionKey}|${path}`
    if (!abCache.has(key)) abCache.set(key, env.answerBearing(record, path))
    return abCache.get(key)
}
const firstAb = (record, paths) => paths.findIndex((path) => ab(record, path))
const allAnswers = latestAnswers(DATA_DIR).filter((a) => a.alias === "small" && inFamily(a.variant))
for (const a of allAnswers) {
    const record = env.pool.byKey.get(a.questionKey)
    if (!record || !a.contextPaths) continue
    const pre = preGrade(a)
    let correct = pre ? 0 : null
    if (correct === null) { const v = verdicts.get(answerVerdictKey(a, record, judge)); if (v) correct = v.verdict === "CORRECT" ? 1 : 0 }
    if (correct === null) continue
    const entry = { correct, abstain: isAbstain(a.answer), read: (a.readPaths ?? []).join(","), variant: a.variant }
    const key = `${a.questionKey}|${a.contextPaths.join(",")}`
    if (!known.has(key)) known.set(key, [])
    known.get(key).push(entry)
    if (a.variant === "pbs") continue
    const pk = `${record.stratum}|${firstAb(record, a.contextPaths)}`
    const s = positionStats.get(pk) ?? [0, 0]
    s[0] += correct; s[1]++
    positionStats.set(pk, s)
}
const pAt = (stratum, pos) => { const s = positionStats.get(`${stratum}|${pos}`); return s && s[1] >= 5 ? s[0] / s[1] : (pos < 0 ? 0.1 : 0.8) }
console.log("P(correct | stratum, first AB pos in ctx0) from stored sandwich-family answers (records in these sets only):")
for (const st of ["hit", "miss"]) console.log(`  ${st}: ` + [-1, 0, 1, 2, 3, 4].map((p) => { const s = positionStats.get(`${st}|${p}`) ?? [0, 0]; return `${p < 0 ? "none" : "pos" + (p + 1)} ${(100 * s[0] / Math.max(1, s[1])).toFixed(0)}% (${s[1]})` }).join(", "))

export const CONFIGS = {
    gates: { gates: true },
    r5: {},
    slot4: { slot: 4 }, slot3: { slot: 3 }, slot2: { slot: 2 }, slot1: { slot: 1 },
    nswap2: { nswap: 2 },
    d20: { depth: 20 }, d50: { depth: 50 },
    snip: { text: "snip" }, "snip-d50": { text: "snip", depth: 50 },
    dense10: { dense: 10 }, dense20: { dense: 20 }, dense30: { dense: 30 }, "dense20-d50": { dense: 20, depth: 50 },
    dedup: { dedup: true },
    "rev-global": { reverse: "global" }, "rev-pool": { reverse: "pool" }, "rev-pool-dedup": { reverse: "pool", dedup: true },
    "r4(m-1)": { margin: -1 },
    "dedup+snip": { dedup: true, text: "snip" },
    "dedup+dense20": { dedup: true, dense: 20 },
    "snip-dense20": { text: "snip", dense: 20 }, "snip-dense30": { text: "snip", dense: 30 }, "snip-dense10": { text: "snip", dense: 10 },
    "snip-revpool-dedup": { text: "snip", reverse: "pool", dedup: true },
    "snip-dense20-revpool-dedup": { text: "snip", dense: 20, reverse: "pool", dedup: true },
    "revpool-dedup-d50": { reverse: "pool", dedup: true, depth: 50 },
    "n2f-m0": { nswap: 2, drop: "foreign", margin2: 0 }, "n2f-m-1": { nswap: 2, drop: "foreign", margin2: -1 },
    "n2f-m-2": { nswap: 2, drop: "foreign", margin2: -2 }, "n2f-m-3": { nswap: 2, drop: "foreign", margin2: -3 },
    "n2f-bl": { nswap: 2, drop: "foreign", bestLast: true }, "n2f-m-2-bl": { nswap: 2, drop: "foreign", margin2: -2, bestLast: true },
    "n3f-m-2-bl": { nswap: 3, drop: "foreign", margin2: -2, bestLast: true },
    minCe: { drop: "minCe" }, foreign: { drop: "foreign" },
    "nswap2-foreign": { nswap: 2, drop: "foreign" }, "nswap2-minCe": { nswap: 2, drop: "minCe" },
    "foreign-dedup-revpool": { drop: "foreign", dedup: true, reverse: "pool" },
}
const missShare = env.missShare
const r5ctx = new Map()
const rows = []
const lists = new Map(env.records.map((record) => [record.questionKey, {
    global: env.bm25.search(record.question, 20).map((h) => h.path),
    mailbox: env.bm25.search(record.question, 50, record.user).map((h) => h.path),
}]))
for (const [name, cfg] of Object.entries(CONFIGS)) {
    if (only && !only.split(",").includes(name) && name !== "r5" && name !== "gates") continue
    const text = cfg.text ?? "std"
    let missingCe = 0
    let missingDense = 0
    const acc = { hit: [], miss: [] }
    for (const record of env.records) {
        const qk = record.questionKey
        const { global, mailbox } = lists.get(qk)
        const d = dense.get(qk)
        if (cfg.dense && !d) missingDense++
        const cache = ce[text][qk] ?? {}
        const scoreCe = async (paths) => new Map(paths.map((p) => { if (cache[p] === undefined) missingCe++; return [p, cache[p] ?? -99] }))
        const built = cfg.gates
            ? await buildContexts({ question: record.question, user: record.user, lists: { global, mailbox, dense: null }, emailOf: env.emailOf, scoreCe, opts: { depth: 0 } })
            : await buildContexts({ question: record.question, user: record.user, lists: { global, mailbox, dense: d ? d.mailbox.map((x) => x[0]) : null }, emailOf: env.emailOf, scoreCe, opts: cfg })
        const [c0, c1] = built.contexts
        if (name === "r5") r5ctx.set(qk, c0.join(","))
        const pos = firstAb(record, c0)
        const union = pos >= 0 || firstAb(record, c1) >= 0
        const hits = known.get(`${qk}|${c0.join(",")}`) ?? []
        const entry = hits.find((h) => !h.abstain) ?? hits.find((h) => h.read === [...c0, ...c1].join(","))
        const est = entry ? entry.correct : pAt(record.stratum, pos)
        acc[record.stratum].push({ pos, union, est, isKnown: Boolean(entry), changed: r5ctx.size && name !== "r5" ? r5ctx.get(qk) !== c0.join(",") : false })
    }
    const mean = (xs, f) => xs.reduce((s, x) => s + f(x), 0) / Math.max(1, xs.length)
    const w = (f) => missShare * mean(acc.miss, f) + (1 - missShare) * mean(acc.hit, f)
    const pct = (v) => (100 * v).toFixed(1)
    rows.push([name, pct(w((x) => x.pos === 0)), pct(w((x) => x.pos >= 0)), pct(w((x) => x.union)),
        `${pct(mean(acc.miss, (x) => x.pos === 0))}/${pct(mean(acc.miss, (x) => x.pos >= 0))}/${pct(mean(acc.miss, (x) => x.union))}`,
        `${pct(mean(acc.hit, (x) => x.pos === 0))}/${pct(mean(acc.hit, (x) => x.pos >= 0))}`,
        `${acc.miss.filter((x) => x.changed).length}/${acc.hit.filter((x) => x.changed).length}`,
        `${acc.miss.filter((x) => !x.isKnown).length}/${acc.hit.filter((x) => !x.isKnown).length}`,
        pct(w((x) => x.est)), pct(mean(acc.miss, (x) => x.est)), pct(mean(acc.hit, (x) => x.est)), `${missingCe}${missingDense ? ` d${missingDense}` : ""}`])
}
console.log(`\nSets ${sets.join("+")} (n=${env.records.length}); AB = gold/twin/evidence-bearing; ctx0 = context read first`)
console.log("| config | w AB@1 | w AB@5 | w union | miss @1/@5/union | hit @1/@5 | ctx0 changed vs r5 (m/h) | unknown (m/h) | sim w | sim miss | sim hit | missing |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows) console.log(`| ${r.join(" | ")} |`)
