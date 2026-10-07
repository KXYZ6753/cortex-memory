// Energy per question and per correct answer for variants run on one set while the
// main study's logger (energy-logger.js) was recording to --log.
//   node benchmarks/premise2/explore2/tools/i-energy.js --log .data/premise2/explore/i-energy.jsonl \
//        --set S300-1 --variants i-e-pb,i-e-gates,i-e-tlk,i-e-x1,i-det-x1 [--first 150] [--idle i-idle] [--out path]
//
// Windows: one block per question, [at - wallMs, at] from answers.jsonl (the runner's
// timestamps; variant.run only, so model load and warm-up are excluded). The GPU lock
// serialises generation, so GPU power inside a window belongs to that question. Idle
// baseline: the i-idle windows (30 s, e2b resident, lock held, no calls), as the main
// study's 30 s idle after load. Integration: integrateBlocks / summariseEnergy from
// ../../energy-integrate.js (trapezoid, edge interpolation), unchanged. Marginal energy =
// gross - idle W x seconds, per source. CPU package power includes other workers' CPU
// jobs (rerankers, analysis scripts), so CPU numbers are approximate.

import { writeFileSync, readFileSync } from "node:fs"
import { integrateBlocks, summariseEnergy, readJsonl as readEnergy } from "../../energy-integrate.js"
import { answersOf, setOf, correctOf, gradingContext, allAnswers, mean } from "./i-lib.js"

const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const logPath = opt("log", ".data/premise2/explore/i-energy.jsonl")
const setName = opt("set", "S300-1")
const variants = opt("variants", "i-e-pb,i-e-gates,i-e-tlk,i-e-x1,i-det-x1").split(",")
const firstN = Number(opt("first", "Infinity"))
const idleVariant = opt("idle", "i-idle")
const outPath = opt("out", ".data/premise2/explore/i-energy-summary.json")

const { records: samples } = await readEnergy(logPath)
const gpu = samples.filter((s) => s.src === "gpu").map((s) => s.t)
const t0 = gpu.reduce((a, b) => Math.min(a, b), Infinity)
const t1 = gpu.reduce((a, b) => Math.max(a, b), -Infinity)
const windowOf = (answer) => { const end = Date.parse(answer.at); return { start: end - answer.wallMs, end } }
const inLog = (w) => w.start >= t0 && w.end <= t1
const near = (lo, hi) => samples.filter((s) => s.t >= lo - 5_000 && s.t <= hi + 5_000)

// Idle baseline windows (status "idle" records of the idle variant, any set).
const idle = allAnswers().filter((a) => a.variant === idleVariant && a.status === "idle").map(windowOf).filter(inLog)
const idleBlocks = idle.length ? integrateBlocks({
    samples: near(Math.min(...idle.map((w) => w.start)), Math.max(...idle.map((w) => w.end))),
    markers: idle.flatMap((w, i) => [{ t: w.start + 2_000, kind: "idle-start", blockId: `idle${i}`, model: "small" }, { t: w.end, kind: "idle-end", blockId: `idle${i}`, model: "small" }]),
}) : []
const idleGpuW = mean(idleBlocks.map((b) => b.gpuMeanW))
const idleCpuW = mean(idleBlocks.map((b) => b.cpuMeanW))

// CPU attribution (i-cpusampler.js): package W ~ a + b x machine busy %, fitted on paired
// 1 s samples; a run's dynamic CPU energy = b x (100 / logical CPUs) x its own CPU seconds
// (runner node pid from the queue label, plus llama-server and ollama in the window).
const cpuPath = opt("cpu", ".data/premise2/explore/i-cpu.jsonl")
const pidPath = opt("pids", ".data/premise2/explore/i-pids.txt")
const logical = (await import("node:os")).cpus().length
let cpuSamples = []
try { cpuSamples = (await readEnergy(cpuPath)).records.filter((r) => Number.isFinite(r.util)) } catch {}
const lhm = samples.filter((s) => s.src === "cpu" && Number.isFinite(s.watts)).sort((x, y) => x.t - y.t)
const pairs = []
{
    let j = 0
    for (const r of cpuSamples) {
        while (j + 1 < lhm.length && Math.abs(lhm[j + 1].t - r.t) <= Math.abs(lhm[j].t - r.t)) j++
        if (lhm[j] && Math.abs(lhm[j].t - r.t) <= 600) pairs.push([r.util, lhm[j].watts])
    }
}
const fit = (() => {
    if (pairs.length < 30) return null
    const mx = mean(pairs.map((p) => p[0]))
    const my = mean(pairs.map((p) => p[1]))
    const sxy = pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0)
    const sxx = pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0)
    const b = sxy / sxx
    const a = my - b * mx
    const ssr = pairs.reduce((s, p) => s + (p[1] - (a + b * p[0])) ** 2, 0)
    const sst = pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0)
    return { a, b, r2: 1 - ssr / sst, n: pairs.length }
})()
const pidOf = (() => {
    const map = []
    try {
        for (const line of readFileSync(pidPath, "utf8").split("\n")) {
            const m = line.match(/-(\d+): run (\S+) (\S+)/)
            if (m) map.push({ pid: Number(m[1]), set: m[2], variants: m[3].split(",") })
        }
    } catch {}
    return (variant) => map.filter((e) => e.set === setName && e.variants.includes(variant)).map((e) => e.pid)
})()
const series = new Map() // pid -> [{t, cpu}]
for (const r of cpuSamples) for (const p of r.procs ?? []) {
    if (!series.has(p.pid)) series.set(p.pid, { name: p.name, points: [] })
    series.get(p.pid).points.push({ t: r.t, cpu: p.cpu })
}
const cumAt = (points, t) => {
    if (!points.length || t <= points[0].t) return points[0]?.cpu ?? 0
    if (t >= points.at(-1).t) return points.at(-1).cpu
    let k = points.findIndex((p) => p.t >= t)
    const a = points[k - 1]
    const b = points[k]
    return a.cpu + (b.cpu - a.cpu) * (t - a.t) / (b.t - a.t)
}
// CPU seconds of a process in [lo, hi] (0 if it did not overlap the window)
const cpuSeconds = (pid, lo, hi) => {
    const s = series.get(pid)
    if (!s || !s.points.length || s.points.at(-1).t < lo || s.points[0].t > hi) return 0
    return Math.max(0, cumAt(s.points, hi) - cumAt(s.points, lo))
}
const ownCpu = (variant, lo, hi) => {
    const runner = pidOf(variant).reduce((acc, pid) => acc + cpuSeconds(pid, lo, hi), 0)
    let server = 0
    let ollama = 0
    for (const [pid, s] of series) {
        if (s.name === "llama-server") server += cpuSeconds(pid, lo, hi)
        else if (s.name === "ollama") ollama += cpuSeconds(pid, lo, hi)
    }
    return { runner, server, ollama, total: runner + server + ollama, runnerFound: pidOf(variant).length > 0 }
}

const set = setOf(setName)
const keys = set.questionKeys.slice(0, firstN)
const { pool, missShare } = gradingContext()
const rows = []
for (const variant of variants) {
    const answers = answersOf(setName, variant)
    const items = keys.filter((k) => answers.has(k)).map((k) => answers.get(k)).filter((a) => inLog(windowOf(a)))
    if (!items.length) { rows.push({ variant, n: 0 }); continue }
    const windows = items.map(windowOf)
    const lo = Math.min(...windows.map((w) => w.start))
    const hi = Math.max(...windows.map((w) => w.end))
    const markers = items.flatMap((a, i) => [
        { t: windows[i].start, kind: "block-start", blockId: a.questionKey, model: "small", cell: variant },
        { t: windows[i].end, kind: "block-end", blockId: a.questionKey, model: "small", cell: variant },
    ])
    const blocks = integrateBlocks({ samples: near(lo, hi), markers, idleBaselines: Number.isFinite(idleGpuW) ? { small: [{ t: 0, gpuW: idleGpuW, cpuW: idleCpuW }] } : null })
    const summary = summariseEnergy(blocks, Object.fromEntries(items.map((a) => [a.questionKey, 1])))
    const sum = (f) => blocks.reduce((acc, b) => acc + f(b), 0)
    const seconds = sum((b) => b.seconds)
    const gpuJ = sum((b) => b.gpuJ)
    const cpuJ = sum((b) => b.cpuJ)
    const n = items.length
    // run window as one block too (includes the runner's gaps between questions)
    const run = integrateBlocks({ samples: near(lo, hi), markers: [{ t: lo, kind: "block-start", blockId: "run", model: "small" }, { t: hi, kind: "block-end", blockId: "run", model: "small" }] })[0]
    const graded = items.map((a) => ({ a, c: correctOf(a), stratum: pool.byKey.get(a.questionKey).stratum }))
    const done = graded.filter((g) => g.c !== null)
    const correct = done.reduce((acc, g) => acc + g.c, 0)
    const acc = (stratum) => mean(done.filter((g) => g.stratum === stratum).map((g) => g.c))
    const weighted = missShare * acc("miss") + (1 - missShare) * acc("hit")
    const gpuMarg = gpuJ - idleGpuW * seconds
    const cpuMarg = cpuJ - idleCpuW * seconds
    const own = ownCpu(variant, lo, hi)
    const cpuAttrJ = fit ? fit.b * (100 / logical) * own.total : null
    // Design-weighted per-question means (the sets oversample misses: S300 = 1/3 misses,
    // the natural share is missShare = 6.8%), per stratum then 0.068 x miss + 0.932 x hit.
    const blockOf = new Map(blocks.map((b) => [b.blockId, b]))
    const perQ = items.map((a, i) => {
        const b = blockOf.get(a.questionKey)
        const attr = fit ? fit.b * (100 / logical) * ownCpu(variant, windows[i].start, windows[i].end).total : NaN
        return { stratum: pool.byKey.get(a.questionKey).stratum, wall: a.wallMs, gpu: b.gpuJ, cpu: b.cpuJ, s: b.seconds, gpuMarg: b.gpuJ - idleGpuW * b.seconds, attr }
    })
    const wmean = (fn) => missShare * mean(perQ.filter((q) => q.stratum === "miss").map(fn)) + (1 - missShare) * mean(perQ.filter((q) => q.stratum === "hit").map(fn))
    const dw = {
        wallMs: wmean((q) => q.wall), gpuJq: wmean((q) => q.gpu), gpuMargJq: wmean((q) => q.gpuMarg), cpuPkgJq: wmean((q) => q.cpu), cpuAttrJq: wmean((q) => q.attr),
        missGpuJq: mean(perQ.filter((q) => q.stratum === "miss").map((q) => q.gpu)), hitGpuJq: mean(perQ.filter((q) => q.stratum === "hit").map((q) => q.gpu)),
    }
    dw.totalJq = dw.gpuMargJq + dw.cpuAttrJq
    const se = (fn) => {
        const part = (st, w) => { const v = perQ.filter((q) => q.stratum === st).map(fn); const m = mean(v); return w * w * v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1) / v.length }
        return Math.sqrt(part("miss", missShare) + part("hit", 1 - missShare))
    }
    dw.gpuJqCi = 1.96 * se((q) => q.gpu)
    dw.totalJqCi = 1.96 * se((q) => q.gpuMarg + q.attr)
    dw.totalPerCorrect = dw.totalJq / weighted
    dw.gpuPerCorrect = dw.gpuJq / weighted
    dw.gpuW = wmean((q) => q.gpu) / wmean((q) => q.s)
    rows.push({ dw,
        variant, n, graded: done.length, correct, rawAcc: done.length ? correct / done.length : null, weighted,
        wallMs: mean(items.map((a) => a.wallMs)), calls: mean(items.map((a) => a.calls)), runSeconds: (hi - lo) / 1000, busySeconds: seconds,
        gpuJq: gpuJ / n, cpuJq: cpuJ / n, totalJq: (gpuJ + cpuJ) / n,
        gpuMargJq: gpuMarg / n, cpuMargJq: cpuMarg / n, totalMargJq: (gpuMarg + cpuMarg) / n,
        gpuMeanW: gpuJ / seconds, cpuMeanW: cpuJ / seconds,
        runGpuJq: run.gpuJ / n, runCpuJq: run.cpuJ / n,
        ownCpuSecondsQ: own.total / n, ownCpu: own, cpuAttrJq: cpuAttrJ == null ? null : cpuAttrJ / n,
        attrTotalJq: cpuAttrJ == null ? null : (gpuMarg + cpuAttrJ) / n,
        attrJPerCorrectWeighted: cpuAttrJ == null ? null : ((gpuMarg + cpuAttrJ) / n) / weighted,
        jPerCorrectRaw: done.length ? ((gpuJ + cpuJ) / n) / (correct / done.length) : null,
        jPerCorrectWeighted: ((gpuJ + cpuJ) / n) / weighted,
        gpuJPerCorrectWeighted: (gpuJ / n) / weighted,
        margJPerCorrectWeighted: ((gpuMarg + cpuMarg) / n) / weighted,
        coverage: { gpu: mean(blocks.map((b) => b.coverage.gpu)), cpu: mean(blocks.map((b) => b.coverage.cpu)) },
        perQuestionCi: summary.byModelCell[`small|${variant}`]?.grossJPerAnswer ?? null,
        from: new Date(lo).toISOString(), to: new Date(hi).toISOString(),
    })
}

const f = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d))
console.log(`Energy on ${setName}${Number.isFinite(firstN) ? ` (first ${firstN})` : ""}; idle baseline from ${idleBlocks.length} window(s): GPU ${f(idleGpuW, 1)} W, CPU ${f(idleCpuW, 1)} W`)
console.log("| variant | n | weighted J1 | wall ms | calls | GPU J/q | CPU J/q | total J/q | GPU W | marginal J/q (GPU / CPU / total) | J per correct (weighted) | GPU J per correct | marginal J per correct |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows) {
    if (!r.n) { console.log(`| ${r.variant} | 0 | | | | | | | | | | | |`); continue }
    console.log(`| ${r.variant} | ${r.n} | ${f(100 * r.weighted, 1)} | ${f(r.wallMs)} | ${f(r.calls, 2)} | ${f(r.gpuJq, 1)} | ${f(r.cpuJq, 1)} | ${f(r.totalJq, 1)} | ${f(r.gpuMeanW, 1)} | ${f(r.gpuMargJq, 1)} / ${f(r.cpuMargJq, 1)} / ${f(r.totalMargJq, 1)} | ${f(r.jPerCorrectWeighted, 1)} | ${f(r.gpuJPerCorrectWeighted, 1)} | ${f(r.margJPerCorrectWeighted, 1)} |`)
}
for (const r of rows.filter((x) => x.n)) console.log(`  ${r.variant}: ${r.from} .. ${r.to}; busy ${f(r.busySeconds)} s of ${f(r.runSeconds)} s; raw acc ${f(100 * r.rawAcc, 1)}% (${r.correct}/${r.graded}); run-window GPU ${f(r.runGpuJq, 1)} J/q, CPU ${f(r.runCpuJq, 1)} J/q; coverage gpu ${f(r.coverage.gpu, 2)} cpu ${f(r.coverage.cpu, 2)}; CI ${JSON.stringify(r.perQuestionCi?.ci95)}`)
console.log(`CPU attribution: package W = ${f(fit?.a, 1)} + ${f(fit?.b, 3)} x busy% (R2 ${f(fit?.r2, 2)}, ${fit?.n ?? 0} paired 1 s samples, ${logical} logical CPUs)`)
console.log("| variant | own CPU s/q (runner / llama-server / ollama) | attributed CPU J/q | GPU marginal + attributed CPU J/q | per correct (weighted) |")
console.log("|---|---|---|---|---|")
for (const r of rows.filter((x) => x.n)) console.log(`| ${r.variant} | ${f(r.ownCpuSecondsQ, 3)} (${f(r.ownCpu.runner / r.n, 3)} / ${f(r.ownCpu.server / r.n, 3)} / ${f(r.ownCpu.ollama / r.n, 3)})${r.ownCpu.runnerFound ? "" : " runner pid unknown"} | ${f(r.cpuAttrJq, 1)} | ${f(r.attrTotalJq, 1)} | ${f(r.attrJPerCorrectWeighted, 1)} |`)
console.log("")
console.log(`Design-weighted per question (miss share ${f(100 * missShare, 1)}%: 0.068 x miss + 0.932 x hit means). Total = GPU marginal (minus ${f(idleGpuW, 1)} W idle) + CPU attributed to own processes.`)
console.log("| system | J1 weighted | wall ms | GPU J/q (gross) | GPU J/q (marginal) | CPU J/q (attributed) | total J/q | J per correct (total) | GPU J per correct (gross) | GPU W | GPU J/q miss / hit | CPU package J/q (raw, upper bound) |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows.filter((x) => x.n)) console.log(`| ${r.variant} | ${f(100 * r.weighted, 1)} | ${f(r.dw.wallMs)} | ${f(r.dw.gpuJq, 0)} ±${f(r.dw.gpuJqCi, 0)} | ${f(r.dw.gpuMargJq, 0)} | ${f(r.dw.cpuAttrJq, 0)} | ${f(r.dw.totalJq, 0)} ±${f(r.dw.totalJqCi, 0)} | ${f(r.dw.totalPerCorrect, 0)} | ${f(r.dw.gpuPerCorrect, 0)} | ${f(r.dw.gpuW, 0)} | ${f(r.dw.missGpuJq, 0)} / ${f(r.dw.hitGpuJq, 0)} | ${f(r.dw.cpuPkgJq, 0)} |`)
writeFileSync(outPath, JSON.stringify({ setName, firstN: Number.isFinite(firstN) ? firstN : null, idle: { windows: idleBlocks.length, gpuW: idleGpuW, cpuW: idleCpuW }, cpuFit: fit, rows }, null, 2))
