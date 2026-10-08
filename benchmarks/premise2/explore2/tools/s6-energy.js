// Worker s6: GPU (and raw CPU package) energy per question for the scale-control arms.
//
//   node benchmarks/premise2/explore2/tools/s6-energy.js --set FULL-0 [--log .data/premise2/explore/s6-energy.jsonl]
//        [--arms s6-det-pb@mid,s6-det-gates@mid,s6-det-oracles@mid] [--idle s6-idle] [--json out.json]
//
// Windows: one block per question, [at - wallMs, at] from answers.jsonl (variant.run only:
// model load and warm-up excluded; det reset calls included). The GPU lock serialises
// generation, so GPU power inside a window belongs to that question. Integration:
// integrateBlocks from ../../energy-integrate.js, unchanged (trapezoid, edge interpolation).
// Idle baseline per alias: the s6-idle windows (30 s, model resident, lock held, no calls),
// first 2 s dropped as in i-energy.js. Marginal GPU = gross - idle W x seconds. CPU package
// power includes other workers' CPU jobs, so it is reported raw, as an upper bound only.
// Design-weighted means (0.068 x miss + 0.932 x hit). Accuracy for J per correct: J1 weighted.

import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { integrateBlocks, readJsonl as readEnergy } from "../../energy-integrate.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const setName = opt("set", "FULL-0")
if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(setName)) throw new Error(`${setName} is not a development set`)
const logPath = opt("log", join(dataDir, "explore", "s6-energy.jsonl"))
const arms = opt("arms", "s6-det-pb@mid,s6-det-gates@mid,s6-det-oracles@mid").split(",").map((s) => { const [variant, alias] = s.split("@"); return { variant, alias, label: s } })
const idleVariant = opt("idle", "s6-idle")
const jsonOut = opt("json", null)

const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const keys = new Set(loadSet(dataDir, setName, pool).questionKeys)
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.verdict && keys.has(e.questionKey)) verdicts.set(e.vkey, e)
}

// latest final answers of the arms on the set, plus idle windows (any set) of the idle variant
const latest = new Map()
const idle = []
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")) })
for await (const line of rl) {
    if (!line || !arms.concat([{ variant: idleVariant }]).some((arm) => line.includes(`"variant":"${arm.variant}"`))) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (r.variant === idleVariant && r.status === "idle") { idle.push(r); continue }
    if (r.set !== setName || !keys.has(r.questionKey) || !FINAL_STATUSES.has(r.status)) continue
    if (!arms.some((a) => a.variant === r.variant && a.alias === r.alias)) continue
    latest.set(r.key, r)
}

const { records: samples } = await readEnergy(logPath)
const gpuT = samples.filter((s) => s.src === "gpu").map((s) => s.t)
const t0 = gpuT.reduce((a, b) => Math.min(a, b), Infinity)
const t1 = gpuT.reduce((a, b) => Math.max(a, b), -Infinity)
const windowOf = (a) => { const end = Date.parse(a.at); return { start: end - a.wallMs, end } }
const inLog = (w) => w.start >= t0 && w.end <= t1
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)

const idleByAlias = {}
for (const alias of new Set(idle.map((r) => r.alias))) {
    const ws = idle.filter((r) => r.alias === alias).map(windowOf).filter(inLog)
    if (!ws.length) continue
    const blocks = integrateBlocks({ samples, markers: ws.flatMap((w, i) => [{ t: w.start + 2_000, kind: "idle-start", blockId: `idle${i}`, model: alias }, { t: w.end, kind: "idle-end", blockId: `idle${i}`, model: alias }]) })
    idleByAlias[alias] = { windows: ws.length, gpuW: mean(blocks.map((b) => b.gpuMeanW)), cpuW: mean(blocks.map((b) => b.cpuMeanW)) }
}
const IDLE_FALLBACK_W = 8.2 // worker i's e2b idle GPU W (i.md §8), used when no s6-idle window exists for an alias

const rows = []
for (const arm of arms) {
    const items = [...latest.values()].filter((r) => r.variant === arm.variant && r.alias === arm.alias).filter((r) => inLog(windowOf(r)))
    if (!items.length) { rows.push({ arm: arm.label, n: 0 }); continue }
    const markers = items.flatMap((a) => { const w = windowOf(a); return [{ t: w.start, kind: "block-start", blockId: a.questionKey, model: arm.alias }, { t: w.end, kind: "block-end", blockId: a.questionKey, model: arm.alias }] })
    const blocks = new Map(integrateBlocks({ samples, markers }).map((b) => [b.blockId, b]))
    const idleW = idleByAlias[arm.alias]?.gpuW ?? IDLE_FALLBACK_W
    const perQ = items.map((a) => {
        const b = blocks.get(a.questionKey)
        const record = pool.byKey.get(a.questionKey)
        let correct = null
        if (preGrade(a)) correct = 0
        else { const v = verdicts.get(answerVerdictKey(a, record, judge)); if (v) correct = v.verdict === "CORRECT" ? 1 : 0 }
        return { stratum: record.stratum, correct, wall: a.wallMs, s: b.seconds, gpu: b.gpuJ, cpu: b.cpuJ, gpuMarg: b.gpuJ - idleW * b.seconds, cov: b.coverage.gpu }
    })
    const W = (fn, list = perQ) => missShare * mean(list.filter((q) => q.stratum === "miss").map(fn)) + (1 - missShare) * mean(list.filter((q) => q.stratum === "hit").map(fn))
    const graded = perQ.filter((q) => q.correct !== null)
    const acc = graded.length ? W((q) => q.correct, graded) : NaN
    const se = (fn) => {
        const part = (st, w) => { const v = perQ.filter((q) => q.stratum === st).map(fn); if (v.length < 2) return 0; const m = mean(v); return w * w * v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1) / v.length }
        return Math.sqrt(part("miss", missShare) + part("hit", 1 - missShare))
    }
    const row = {
        arm: arm.label, n: items.length, graded: graded.length, accW: acc,
        wallMsW: W((q) => q.wall), gpuJq: W((q) => q.gpu), gpuJqCi: 1.96 * se((q) => q.gpu), gpuMargJq: W((q) => q.gpuMarg), cpuPkgJq: W((q) => q.cpu),
        gpuW: W((q) => q.gpu) / W((q) => q.s), idleGpuW: idleW, idleFrom: idleByAlias[arm.alias] ? "s6-idle" : "fallback 8.2 W (i.md)",
        gpuPerCorrect: W((q) => q.gpu) / acc, gpuMargPerCorrect: W((q) => q.gpuMarg) / acc,
        hitGpuJq: mean(perQ.filter((q) => q.stratum === "hit").map((q) => q.gpu)), missGpuJq: mean(perQ.filter((q) => q.stratum === "miss").map((q) => q.gpu)),
        coverage: mean(perQ.map((q) => q.cov)),
    }
    rows.push(row)
}

const f = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d))
console.log(`Energy on ${setName} (log ${logPath}); idle: ${JSON.stringify(idleByAlias)}`)
console.log("| arm | n in log | J1 weighted | wall ms (weighted) | GPU J/q gross | GPU W | GPU J/q marginal | GPU J per correct (gross / marginal) | GPU J/q hit / miss | CPU package J/q (raw, upper bound) | GPU sample coverage |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows) {
    if (!r.n) { console.log(`| ${r.arm} | 0 | | | | | | | | | |`); continue }
    console.log(`| ${r.arm} | ${r.n} | ${f(100 * r.accW, 1)} | ${f(r.wallMsW)} | ${f(r.gpuJq, 1)} ±${f(r.gpuJqCi, 1)} | ${f(r.gpuW, 1)} | ${f(r.gpuMargJq, 1)} | ${f(r.gpuPerCorrect, 1)} / ${f(r.gpuMargPerCorrect, 1)} | ${f(r.hitGpuJq, 1)} / ${f(r.missGpuJq, 1)} | ${f(r.cpuPkgJq, 1)} | ${f(r.coverage, 2)} |`)
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ set: setName, logPath, idleByAlias, rows }, null, 1))
