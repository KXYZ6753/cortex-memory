// Worker e2: total (GPU + attributed CPU) energy per question and per correct answer, with
// the runner process found automatically. Extends tools/i-energy.js (unchanged), which could
// not attribute the runner's own CPU (the cross-encoders run inside the runner process).
//   node benchmarks/premise2/explore2/tools/e2-energy.js --log .data/premise2/explore/r5-energy.jsonl \
//        --cpu .data/premise2/explore/r5-cpu.jsonl \
//        --runs FULL-3:i-det-gates@2,FULL-3:i-det-x1@2,FULL-3:q-det-q1@1,FULL-3:lite-det-ub@1 \
//        [--idle i-idle] [--exclude 2016,15192] [--pid FULL-3:q-det-q1@1=23392] [--impute FULL-3] \
//        [--out e2.json] [--md e2.md]
//
// Windows, GPU integration, idle baseline and design weighting are i-energy.js's (one block per
// question [at - wallMs, at]; integrateBlocks/summariseEnergy; 0.068 x miss + 0.932 x hit).
//
// Runner pid (auto): the CPU sampler (tools/i-cpusampler.js) logs every node / llama-server /
// ollama process's cumulative CPU seconds about once per second. Each pid's samples are split into
// segments at gaps > 5 s or when the cumulative value falls (Windows reuses pids). The runner of a
// run is the node segment (not excluded; segments alive for the whole log, i.e. the energy logger
// and the sampler, are excluded automatically) that is alive over the whole run and has the most
// CPU seconds inside the run's question windows. Reported with the runner-up, the segment's birth
// and exit relative to the run, and two checks: the correlation of its per-question CPU seconds
// with the question's non-generation time (wallMs - genMs), and its CPU rate per path.
//
// CPU energy (the run's own processes = runner + every llama-server + ollama):
//   A  slope: package W = a + b x busy% fitted on 10 s block means (1 s pairs are misaligned
//      between LibreHardwareMonitor and Get-Counter, which attenuates b; see e2.md), J per
//      CPU-second = b x 100 / logical CPUs. Primary.
//   B  direct share: per 10 s block, package power above the fitted floor a, shared by CPU
//      seconds (own / max(machine busy, own)).
//   C  check: block-mean package W regressed on the CPU rates of runners, llama-server, ollama
//      and the rest of the machine separately (is a runner CPU-second dearer than average?).
// Totals: GPU gross + CPU attributed (A) and GPU marginal + CPU attributed (A, as i-energy).
// Package J inside the windows (gross, and above the floor) are upper bounds: they include other
// workers' CPU jobs. Runs outside the sampler's span get only those upper bounds, plus (with
// --impute <set>) an imputed CPU figure: the same variant's attributed CPU J per wall-second on
// <set> times this run's wall time.

import { writeFileSync } from "node:fs"
import { integrateBlocks, summariseEnergy, readJsonl as readEnergy } from "../../energy-integrate.js"
import { answersOf, gradingContext, allAnswers, correctOf, mean } from "./i-lib.js"

const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const optAll = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []))
const logPath = opt("log", ".data/premise2/explore/r5-energy.jsonl")
const cpuPath = opt("cpu", ".data/premise2/explore/r5-cpu.jsonl")
const idleVariant = opt("idle", "i-idle")
const runSpecs = (opt("runs") ?? (opt("variants") ?? "").split(",").filter(Boolean).map((v) => `${opt("set", "S300-1")}:${v}`).join(",")).split(",").filter(Boolean)
const exclude = new Set((opt("exclude", "") ?? "").split(",").filter(Boolean).map(Number))
const pinned = new Map(optAll("pid").map((s) => { const [k, v] = s.split("="); return [k, Number(v)] }))
const imputeFrom = opt("impute")
const outPath = opt("out")
const mdPath = opt("md")
const BLOCK_MS = Number(opt("block", "10")) * 1000
const logical = (await import("node:os")).cpus().length

// ---------- energy log ----------
const { records: samples } = await readEnergy(logPath)
const gpuT = samples.filter((s) => s.src === "gpu").map((s) => s.t)
const t0 = gpuT.reduce((a, b) => Math.min(a, b), Infinity)
const t1 = gpuT.reduce((a, b) => Math.max(a, b), -Infinity)
const lhm = samples.filter((s) => s.src === "cpu" && Number.isFinite(s.watts)).sort((x, y) => x.t - y.t)
const windowOf = (a) => { const end = Date.parse(a.at); return { start: end - a.wallMs, end } }
const inLog = (w) => w.start >= t0 && w.end <= t1
const near = (lo, hi) => samples.filter((s) => s.t >= lo - 5_000 && s.t <= hi + 5_000)

// idle baseline (as i-energy)
const idle = allAnswers().filter((a) => a.variant === idleVariant && a.status === "idle").map(windowOf).filter(inLog)
const idleBlocks = idle.length ? integrateBlocks({
    samples: near(Math.min(...idle.map((w) => w.start)), Math.max(...idle.map((w) => w.end))),
    markers: idle.flatMap((w, i) => [{ t: w.start + 2_000, kind: "idle-start", blockId: `idle${i}`, model: "small" }, { t: w.end, kind: "idle-end", blockId: `idle${i}`, model: "small" }]),
}) : []
const idleGpuW = mean(idleBlocks.map((b) => b.gpuMeanW))
const idleCpuW = mean(idleBlocks.map((b) => b.cpuMeanW))

// ---------- CPU sampler: segments ----------
let cpuRecs = []
try { cpuRecs = (await readEnergy(cpuPath)).records.filter((r) => Number.isFinite(r.util)).sort((x, y) => x.t - y.t) } catch {}
const c0 = cpuRecs[0]?.t ?? Infinity
const c1 = cpuRecs.at(-1)?.t ?? -Infinity
const segments = [] // { id, pid, name, points: [{t, cpu}] }
{
    const open = new Map()
    for (const r of cpuRecs) for (const p of r.procs ?? []) {
        if (!Number.isFinite(p.cpu)) continue
        let s = open.get(p.pid)
        const last = s?.points.at(-1)
        if (!s || s.name !== p.name || r.t - last.t > 5_000 || p.cpu < last.cpu - 0.01) {
            s = { id: `${p.pid}#${segments.filter((x) => x.pid === p.pid).length}`, pid: p.pid, name: p.name, points: [] }
            segments.push(s)
            open.set(p.pid, s)
        }
        s.points.push({ t: r.t, cpu: p.cpu })
    }
}
for (const s of segments) { s.first = s.points[0].t; s.last = s.points.at(-1).t }
const always = new Set(segments.filter((s) => s.first - c0 < 5_000 && c1 - s.last < 5_000 && s.name === "node").map((s) => s.id))
const lowerIdx = (pts, t) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].t <= t) lo = m; else hi = m - 1 } return lo }
const cumAt = (pts, t) => {
    if (t <= pts[0].t) return pts[0].cpu
    if (t >= pts.at(-1).t) return pts.at(-1).cpu
    const k = lowerIdx(pts, t)
    const a = pts[k]
    const b = pts[k + 1]
    return a.cpu + (b.cpu - a.cpu) * (t - a.t) / (b.t - a.t)
}
const segCpu = (s, lo, hi) => (s.last < lo || s.first > hi ? 0 : Math.max(0, cumAt(s.points, hi) - cumAt(s.points, lo)))
const serverSegs = segments.filter((s) => s.name === "llama-server")
const ollamaSegs = segments.filter((s) => s.name === "ollama")
const groupCpu = (segs, lo, hi) => segs.reduce((acc, s) => acc + segCpu(s, lo, hi), 0)
const covered = (lo, hi) => cpuRecs.length > 0 && lo >= c0 && hi <= c1

// ---------- CPU power fits ----------
const ols = (X, y) => { // normal equations, small k; Gauss-Jordan on [X'X | I] gives (X'X)^-1
    const k = X[0].length
    const M = Array.from({ length: k }, (_, p) => [...new Array(k).fill(0), ...Array.from({ length: k }, (_, q) => (p === q ? 1 : 0))])
    const xty = new Array(k).fill(0)
    for (let i = 0; i < y.length; i++) for (let p = 0; p < k; p++) { for (let q = 0; q < k; q++) M[p][q] += X[i][p] * X[i][q]; xty[p] += X[i][p] * y[i] }
    for (let c = 0; c < k; c++) {
        let piv = c
        for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
        ;[M[c], M[piv]] = [M[piv], M[c]]
        if (Math.abs(M[c][c]) < 1e-12) return null
        const d = M[c][c]
        for (let q = 0; q < 2 * k; q++) M[c][q] /= d
        for (let r = 0; r < k; r++) if (r !== c) { const g = M[r][c]; for (let q = 0; q < 2 * k; q++) M[r][q] -= g * M[c][q] }
    }
    const invM = M.map((row) => row.slice(k))
    const beta = invM.map((row) => row.reduce((s, v, q) => s + v * xty[q], 0))
    const ybar = mean(y)
    const ssr = y.reduce((acc, v, i) => acc + (v - X[i].reduce((s, x, j) => s + x * beta[j], 0)) ** 2, 0)
    const sst = y.reduce((acc, v) => acc + (v - ybar) ** 2, 0)
    return { beta, r2: 1 - ssr / sst, n: y.length, sigma2: ssr / Math.max(1, y.length - k), invDiag: invM.map((row, i) => row[i]) }
}
const fit1s = (() => { // i-energy's 1 s nearest-sample pairs, for comparison
    const X = [], y = []
    let j = 0
    for (const r of cpuRecs) {
        while (j + 1 < lhm.length && Math.abs(lhm[j + 1].t - r.t) <= Math.abs(lhm[j].t - r.t)) j++
        if (lhm[j] && Math.abs(lhm[j].t - r.t) <= 600) { X.push([1, r.util]); y.push(lhm[j].watts) }
    }
    const f = X.length >= 30 ? ols(X, y) : null
    return f && { a: f.beta[0], b: f.beta[1], r2: f.r2, n: f.n }
})()
// 10 s blocks: mean util, mean package W, CPU seconds per process group
const blocks = new Map()
for (const r of cpuRecs) { const k = Math.floor(r.t / BLOCK_MS); const e = blocks.get(k) ?? { k, u: 0, nu: 0, w: 0, nw: 0 }; e.u += r.util; e.nu++; blocks.set(k, e) }
for (const r of lhm) { const e = blocks.get(Math.floor(r.t / BLOCK_MS)); if (e) { e.w += r.watts; e.nw++ } }
const sec = BLOCK_MS / 1000
const goodBlocks = [...blocks.values()].filter((e) => e.nu >= 0.8 * sec && e.nw >= 0.8 * sec).map((e) => ({ ...e, util: e.u / e.nu, watts: e.w / e.nw, lo: e.k * BLOCK_MS, hi: (e.k + 1) * BLOCK_MS }))
const fitBlock = (() => {
    if (goodBlocks.length < 30) return null
    const f = ols(goodBlocks.map((b) => [1, b.util]), goodBlocks.map((b) => b.watts))
    return f && { a: f.beta[0], b: f.beta[1], r2: f.r2, n: f.n, jPerCpuS: f.beta[1] * 100 / logical }
})()
const jPerCpuS = fitBlock?.jPerCpuS ?? NaN
const floorW = fitBlock?.a ?? NaN
const busyCache = new Map()
const busyCpuS = (lo, hi) => busyCache.get(`${lo}:${hi}`) ?? busyCache.set(`${lo}:${hi}`, busyRaw(lo, hi)).get(`${lo}:${hi}`)
function busyRaw(lo, hi) { // machine busy CPU-seconds in [lo, hi] from util samples (each covers the preceding ~1 s)
    let acc = 0
    for (let k = lowerIdx(cpuRecs, lo); k < cpuRecs.length && cpuRecs[k].t <= hi + 1_000; k++) {
        const r = cpuRecs[k]
        const a = Math.max(lo, (cpuRecs[k - 1]?.t ?? r.t - 1_000))
        const b = Math.min(hi, r.t)
        if (b > a) acc += (r.util / 100) * logical * (b - a) / 1000
    }
    return acc
}

// ---------- runs ----------
const pathOf = (a) => {
    if (a.q?.m2Fired === true || (Array.isArray(a.log) && a.log.some((l) => l.act === "rec"))) return a.step === "commit-g5" ? "m2+g5" : "m2"
    if (["found", "nofound", "nopick"].includes(a.step)) return "explore"
    if (a.step === "commit-g5") return "g5"
    if (a.step == null) return "one-shot"
    return "commit"
}
const { pool, missShare } = gradingContext()
const pearson = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 } return sxy / Math.sqrt(sxx * syy) }

const rows = []
for (const spec of runSpecs) {
    const [setName, variant] = spec.split(":")
    const answers = answersOf(setName, variant)
    const items = [...answers.values()].filter((a) => Number.isFinite(a.wallMs) && inLog(windowOf(a))).sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
    if (!items.length) { rows.push({ spec, setName, variant, n: 0 }); continue }
    const windows = items.map(windowOf)
    const lo = Math.min(...windows.map((w) => w.start))
    const hi = Math.max(...windows.map((w) => w.end))
    const markers = items.flatMap((a, i) => [
        { t: windows[i].start, kind: "block-start", blockId: a.questionKey, model: "small", cell: variant },
        { t: windows[i].end, kind: "block-end", blockId: a.questionKey, model: "small", cell: variant },
    ])
    const eb = integrateBlocks({ samples: near(lo, hi), markers, idleBaselines: Number.isFinite(idleGpuW) ? { small: [{ t: 0, gpuW: idleGpuW, cpuW: idleCpuW }] } : null })
    const ebOf = new Map(eb.map((b) => [b.blockId, b]))
    summariseEnergy(eb, Object.fromEntries(items.map((a) => [a.questionKey, 1])))
    const cpuOk = covered(lo, hi)

    // runner detection
    let runner = null
    const candidates = []
    if (cpuOk) {
        for (const s of segments) {
            if (s.name !== "node" || exclude.has(s.pid) || always.has(s.id)) continue
            if (s.first > lo + 1_500 || s.last < hi - 3_000) continue
            const inWin = windows.reduce((acc, w) => acc + segCpu(s, w.start, w.end), 0)
            candidates.push({ seg: s, inWin })
        }
        candidates.sort((x, y) => y.inWin - x.inWin)
        const forced = pinned.get(spec)
        runner = forced != null ? candidates.find((c) => c.seg.pid === forced)?.seg ?? null : candidates[0]?.seg ?? null
    }
    const runnerCpu = (lo2, hi2) => (runner ? segCpu(runner, lo2, hi2) : 0)

    // per question
    const perQ = items.map((a, i) => {
        const w = windows[i]
        const b = ebOf.get(a.questionKey)
        const r = runnerCpu(w.start, w.end)
        const sv = cpuOk ? groupCpu(serverSegs, w.start, w.end) : NaN
        const ol = cpuOk ? groupCpu(ollamaSegs, w.start, w.end) : NaN
        const own = r + sv + ol
        // B: per-block direct share of package power above the floor
        let jB = 0
        if (cpuOk) for (let k = Math.floor(w.start / BLOCK_MS); k <= Math.floor(w.end / BLOCK_MS); k++) {
            const blk = blocks.get(k)
            if (!blk || !blk.nw) continue
            const bl = k * BLOCK_MS, bh = (k + 1) * BLOCK_MS
            const pk = blk.w / blk.nw
            const ownBlk = runnerCpu(bl, bh) + groupCpu(serverSegs, bl, bh) + groupCpu(ollamaSegs, bl, bh)
            const busy = Math.max(busyCpuS(bl, bh), ownBlk, 1e-9)
            const rate = Math.max(0, pk - floorW) * sec / busy
            const lo2 = Math.max(w.start, bl), hi2 = Math.min(w.end, bh)
            jB += rate * (runnerCpu(lo2, hi2) + groupCpu(serverSegs, lo2, hi2) + groupCpu(ollamaSegs, lo2, hi2))
        }
        const pkgDyn = Math.max(0, b.cpuJ - floorW * b.seconds)
        const c = correctOf(a)
        return {
            key: a.questionKey, stratum: pool.byKey.get(a.questionKey).stratum, path: pathOf(a), c,
            wall: a.wallMs, nonGen: a.wallMs - (a.genMs ?? 0), s: b.seconds,
            gpu: b.gpuJ, gpuMarg: b.gpuJ - idleGpuW * b.seconds, pkg: b.cpuJ, pkgDyn,
            runnerS: r, serverS: sv, ollamaS: ol, ownS: own, cpuA: cpuOk ? jPerCpuS * own : NaN, cpuB: cpuOk ? jB : NaN,
        }
    })
    const done = perQ.filter((q) => q.c !== null)
    const acc = (st, qs = done) => mean(qs.filter((q) => q.stratum === st).map((q) => q.c))
    const weighted = missShare * acc("miss") + (1 - missShare) * acc("hit")
    const wm = (fn, qs = perQ) => {
        const m = qs.filter((q) => q.stratum === "miss"), h = qs.filter((q) => q.stratum === "hit")
        if (!m.length) return mean(h.map(fn))
        if (!h.length) return mean(m.map(fn))
        return missShare * mean(m.map(fn)) + (1 - missShare) * mean(h.map(fn))
    }
    const ci = (fn) => {
        const part = (st, wgt) => { const v = perQ.filter((q) => q.stratum === st).map(fn); if (v.length < 2) return 0; const m = mean(v); return wgt * wgt * v.reduce((acc2, x) => acc2 + (x - m) ** 2, 0) / (v.length - 1) / v.length }
        return 1.96 * Math.sqrt(part("miss", missShare) + part("hit", 1 - missShare))
    }
    const dw = {
        wallMs: wm((q) => q.wall), nonGenMs: wm((q) => q.nonGen), gpuJq: wm((q) => q.gpu), gpuMargJq: wm((q) => q.gpuMarg),
        pkgJq: wm((q) => q.pkg), pkgDynJq: wm((q) => q.pkgDyn),
        runnerS: wm((q) => q.runnerS), serverS: wm((q) => q.serverS), ollamaS: wm((q) => q.ollamaS),
        cpuAJq: wm((q) => q.cpuA), cpuBJq: wm((q) => q.cpuB),
    }
    dw.gpuJqCi = ci((q) => q.gpu)
    dw.totalGrossJq = dw.gpuJq + dw.cpuAJq
    dw.totalGrossCi = ci((q) => q.gpu + q.cpuA)
    dw.totalMargJq = dw.gpuMargJq + dw.cpuAJq
    dw.totalGrossJqB = dw.gpuJq + dw.cpuBJq
    dw.gpuPerCorrect = dw.gpuJq / weighted
    dw.totalGrossPerCorrect = dw.totalGrossJq / weighted
    dw.totalMargPerCorrect = dw.totalMargJq / weighted
    dw.totalGrossPerCorrectB = dw.totalGrossJqB / weighted
    dw.cpuShare = dw.cpuAJq / dw.totalGrossJq
    dw.cpuShareMarg = dw.cpuAJq / dw.totalMargJq
    dw.pkgUpperPerCorrect = (dw.gpuJq + dw.pkgDynJq) / weighted // GPU gross + all dynamic package power in the windows
    dw.boxJq = dw.gpuJq + floorW * wm((q) => q.s) + dw.cpuAJq // box-level sensitivity: + CPU package floor x wall
    dw.boxPerCorrect = dw.boxJq / weighted

    // runner checks
    let runnerInfo = null
    if (runner) {
        const second = candidates.find((c) => c.seg.id !== runner.id)
        const rq = perQ.map((q) => q.runnerS)
        // deconvolution: runner CPU per sampler interval ~ sum_path beta_path x seconds of that path's windows in the interval (+ gaps)
        const paths = [...new Set(perQ.map((q) => q.path))]
        const X = [], y = []
        let wi = 0
        const pts = runner.points.filter((p) => p.t >= lo - 1_000 && p.t <= hi + 1_000)
        for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1].t, b = pts[k].t
            const row = new Array(paths.length + 1).fill(0)
            while (wi < windows.length && windows[wi].end < a) wi++
            let covered2 = 0
            for (let j = wi; j < windows.length && windows[j].start < b; j++) {
                const ov = Math.max(0, Math.min(b, windows[j].end) - Math.max(a, windows[j].start)) / 1000
                row[paths.indexOf(perQ[j].path)] += ov
                covered2 += ov
            }
            row[paths.length] = Math.max(0, (b - a) / 1000 - covered2) // gaps between questions
            X.push(row)
            y.push(pts[k].cpu - pts[k - 1].cpu)
        }
        const dec = X.length > paths.length + 5 ? ols(X, y) : null
        const byPath = {}
        for (const [pi, p] of paths.entries()) {
            const qs = perQ.filter((q) => q.path === p)
            const meanS = mean(qs.map((q) => q.s))
            const se = dec ? Math.sqrt(dec.sigma2 * dec.invDiag[pi]) : NaN
            byPath[p] = { n: qs.length, coresInWindow: dec?.beta[pi], cpuSq: dec ? dec.beta[pi] * meanS : NaN, cpuSqCi: dec ? 1.96 * se * meanS : NaN, interpCpuSq: mean(qs.map((q) => q.runnerS)), wallMs: mean(qs.map((q) => q.wall)), nonGenMs: mean(qs.map((q) => q.nonGen)) }
        }
        runnerInfo = {
            pid: runner.pid, segment: runner.id, alive: [new Date(runner.first).toISOString(), new Date(runner.last).toISOString()],
            birthBeforeRunS: (lo - runner.first) / 1000, exitAfterRunS: (runner.last - hi) / 1000,
            cpuInWindowsS: candidates.find((c) => c.seg.id === runner.id)?.inWin, cpuWholeRunS: segCpu(runner, lo, hi),
            runnerUp: second ? { pid: second.seg.pid, cpuInWindowsS: second.inWin } : null,
            candidates: candidates.length,
            rNonGen: pearson(rq, perQ.map((q) => q.nonGen)), rWall: pearson(rq, perQ.map((q) => q.wall)),
            rNonGenRunnerUp: second ? pearson(perQ.map((q, i) => segCpu(second.seg, windows[i].start, windows[i].end)), perQ.map((q) => q.nonGen)) : null,
            gapCores: dec?.beta[paths.length], deconR2: dec?.r2, byPath,
            servers: serverSegs.filter((s) => s.first <= hi && s.last >= lo && segCpu(s, lo, hi) > 1).map((s) => ({ pid: s.pid, cpuS: segCpu(s, lo, hi), birthBeforeRunS: (lo - s.first) / 1000 })),
        }
    }
    // per-path energy (interpolated per question; CPU A uses the per-question smeared CPU seconds)
    const pathTable = {}
    for (const p of [...new Set(perQ.map((q) => q.path))]) {
        const qs = perQ.filter((q) => q.path === p)
        pathTable[p] = { n: qs.length, wallMs: mean(qs.map((q) => q.wall)), gpuJq: mean(qs.map((q) => q.gpu)), cpuAJq: mean(qs.map((q) => q.cpuA)), runnerS: mean(qs.map((q) => q.runnerS)), ownS: mean(qs.map((q) => q.ownS)) }
        if (runnerInfo?.byPath[p] && Number.isFinite(runnerInfo.byPath[p].cpuSq)) {
            // deconvolved runner CPU + interpolated llama-server/ollama
            const deconOwn = runnerInfo.byPath[p].cpuSq + mean(qs.map((q) => q.serverS + q.ollamaS))
            pathTable[p].cpuAJqDecon = jPerCpuS * deconOwn
            pathTable[p].totalJqDecon = pathTable[p].gpuJq + pathTable[p].cpuAJqDecon
        }
    }
    rows.push({
        spec, setName, variant, n: items.length, graded: done.length, weighted, missAcc: acc("miss"), hitAcc: acc("hit"),
        from: new Date(lo).toISOString(), to: new Date(hi).toISOString(), cpuCovered: cpuOk, dw, runner: runnerInfo, paths: pathTable,
        ownCpuTotalS: { runner: perQ.reduce((s, q) => s + q.runnerS, 0), server: perQ.reduce((s, q) => s + (q.serverS || 0), 0), ollama: perQ.reduce((s, q) => s + (q.ollamaS || 0), 0) },
        _perQ: perQ, _wm: wm,
    })
}
// method C: block regression with process groups (runner segments vs the rest)
const runnerSegs = rows.filter((r) => r.runner).map((r) => segments.find((s) => s.id === r.runner.segment))
const uniqRunner = [...new Map(runnerSegs.map((s) => [s.id, s])).values()]
const fitC = (() => {
    if (goodBlocks.length < 30 || !uniqRunner.length) return null
    const X = [], y = []
    for (const b of goodBlocks) {
        const rr = groupCpu(uniqRunner, b.lo, b.hi) / sec
        const sv = groupCpu(serverSegs, b.lo, b.hi) / sec
        const ol = groupCpu(ollamaSegs, b.lo, b.hi) / sec
        const busy = b.util / 100 * logical
        X.push([1, rr, sv, ol, Math.max(0, busy - rr - sv - ol)])
        y.push(b.watts)
    }
    const f = ols(X, y)
    return f && { a: f.beta[0], jPerCpuS: { runner: f.beta[1], llamaServer: f.beta[2], ollama: f.beta[3], rest: f.beta[4] }, r2: f.r2, n: f.n }
})()
for (const r of rows) if (r.n && r.cpuCovered && fitC) {
    const n = r.n
    const k = fitC.jPerCpuS
    r.cpuCJq = r._wm((q) => k.runner * q.runnerS + k.llamaServer * q.serverS + k.ollama * q.ollamaS) // design-weighted
    r.dw.totalGrossPerCorrectC = (r.dw.gpuJq + r.cpuCJq) / r.weighted
    r.cpuAJqUnweighted = jPerCpuS * (r.ownCpuTotalS.runner + r.ownCpuTotalS.server + r.ownCpuTotalS.ollama) / n
}
// imputation for runs outside the sampler
if (imputeFrom) for (const r of rows) if (r.n && !r.cpuCovered) {
    const src = rows.find((x) => x.n && x.cpuCovered && x.setName === imputeFrom && x.variant === r.variant)
    if (!src) continue
    const perSec = src.dw.cpuAJq / src.dw.wallMs
    r.imputed = { from: src.spec, cpuAJq: perSec * r.dw.wallMs }
    r.imputed.totalGrossJq = r.dw.gpuJq + r.imputed.cpuAJq
    r.imputed.totalGrossPerCorrect = r.imputed.totalGrossJq / r.weighted
    r.imputed.totalMargPerCorrect = (r.dw.gpuMargJq + r.imputed.cpuAJq) / r.weighted
    r.imputed.cpuShare = r.imputed.cpuAJq / r.imputed.totalGrossJq
}

// ---------- output ----------
const f = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d))
const lines = []
const say = (s = "") => { lines.push(s); console.log(s) }
say(`Log ${logPath}; CPU sampler ${cpuPath} (${cpuRecs.length} records, ${cpuRecs.length ? new Date(c0).toISOString() : "–"} .. ${cpuRecs.length ? new Date(c1).toISOString() : "–"})`)
say(`Idle baseline: ${idleBlocks.length} ${idleVariant} window(s): GPU ${f(idleGpuW, 2)} W, CPU package ${f(idleCpuW, 1)} W`)
say(`CPU fit (${sec} s blocks, primary): package W = ${f(fitBlock?.a, 1)} + ${f(fitBlock?.b, 3)} x busy% (R2 ${f(fitBlock?.r2, 3)}, ${fitBlock?.n ?? 0} blocks) -> ${f(jPerCpuS, 2)} J per CPU-second (${logical} logical CPUs); floor ${f(floorW, 1)} W`)
say(`CPU fit (1 s nearest pairs, as i-energy): package W = ${f(fit1s?.a, 1)} + ${f(fit1s?.b, 3)} x busy% (R2 ${f(fit1s?.r2, 3)}, n ${fit1s?.n ?? 0}) -> ${f(fit1s ? fit1s.b * 100 / logical : NaN, 2)} J per CPU-second`)
if (fitC) say(`CPU fit C (${sec} s blocks, by process group): J per CPU-second runner ${f(fitC.jPerCpuS.runner, 2)}, llama-server ${f(fitC.jPerCpuS.llamaServer, 2)}, ollama ${f(fitC.jPerCpuS.ollama, 2)}, rest of machine ${f(fitC.jPerCpuS.rest, 2)}; intercept ${f(fitC.a, 1)} W; R2 ${f(fitC.r2, 3)}`)
say("")
say("Runner pids:")
say("| run | window (UTC) | runner pid | alive (UTC) | born before run (s) | exits after run (s) | runner CPU s/q in windows | runner-up pid (CPU s/q) | r(CPU, non-gen ms) runner / runner-up | llama-server pid(s) |")
say("|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows.filter((x) => x.n)) {
    const ri = r.runner
    if (!ri) { say(`| ${r.spec} | ${r.from.slice(11, 19)}–${r.to.slice(11, 19)} | ${r.cpuCovered ? "not found" : "outside sampler"} | | | | | | | |`); continue }
    say(`| ${r.spec} | ${r.from.slice(11, 19)}–${r.to.slice(11, 19)} | **${ri.pid}** | ${ri.alive[0].slice(11, 19)}–${ri.alive[1].slice(11, 19)} | ${f(ri.birthBeforeRunS, 0)} | ${f(ri.exitAfterRunS, 0)} | ${f(ri.cpuInWindowsS / r.n, 2)} | ${ri.runnerUp ? `${ri.runnerUp.pid} (${f(ri.runnerUp.cpuInWindowsS / r.n, 3)})` : "none"} | ${f(ri.rNonGen, 2)} / ${f(ri.rNonGenRunnerUp, 2)} | ${ri.servers.map((s) => `${s.pid} (${f(s.cpuS / r.n, 2)} s/q, born ${f(s.birthBeforeRunS, 0)} s before)`).join("; ")} |`)
}
say("")
say("Runner processes: share of each process's lifetime CPU that falls inside its runs' question windows (the rest is start-up, queue wait and gaps):")
say("| runner pid | runs | alive (UTC) | lifetime CPU s | in its runs' windows | share |")
say("|---|---|---|---|---|---|")
for (const s of uniqRunner) {
    const mine = rows.filter((r) => r.runner?.segment === s.id)
    const inWin = mine.reduce((acc, r) => acc + r.runner.cpuInWindowsS, 0)
    const life = s.points.at(-1).cpu - s.points[0].cpu
    say(`| ${s.pid} | ${mine.map((r) => r.spec).join(", ")} | ${new Date(s.first).toISOString().slice(11, 19)}–${new Date(s.last).toISOString().slice(11, 19)} | ${f(life, 1)} | ${f(inWin, 1)} | ${f(100 * inWin / life, 1)}% |`)
}
say("")
say("Design-weighted per question (0.068 x miss + 0.932 x hit). CPU attributed = (runner + llama-server + ollama) CPU-seconds x J per CPU-second (A). Totals: GPU gross + CPU attributed, and GPU marginal + CPU attributed.")
say("| run | n | J1 W | wall ms | GPU J/q gross ±95% | GPU J/q marginal | CPU s/q (runner / llama-server / ollama) | CPU J/q attributed A (B direct, C by group) | **total J/q (gross GPU + CPU)** ±95% | total J/q (marginal GPU + CPU) | GPU J per correct | **total J per correct (gross)** | total J per correct (marginal) | CPU share of total (gross / marginal) | package J/q in windows: raw / above floor (upper bounds) |")
say("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows.filter((x) => x.n)) {
    const d = r.dw
    if (!r.cpuCovered) {
        const im = r.imputed
        say(`| ${r.spec} (no CPU sampler) | ${r.n} | ${f(100 * r.weighted, 1)} | ${f(d.wallMs)} | ${f(d.gpuJq)} ±${f(d.gpuJqCi)} | ${f(d.gpuMargJq)} | – | ${im ? `imputed ${f(im.cpuAJq)}` : "–"} | ${im ? `imputed ${f(im.totalGrossJq)}` : "–"} | – | ${f(d.gpuPerCorrect)} | ${im ? `imputed ${f(im.totalGrossPerCorrect)}` : "–"} | ${im ? `imputed ${f(im.totalMargPerCorrect)}` : "–"} | ${im ? `imputed ${f(100 * im.cpuShare)}%` : "–"} | ${f(d.pkgJq)} / ${f(d.pkgDynJq)} |`)
        continue
    }
    say(`| ${r.spec} | ${r.n} | ${f(100 * r.weighted, 1)} | ${f(d.wallMs)} | ${f(d.gpuJq)} ±${f(d.gpuJqCi)} | ${f(d.gpuMargJq)} | ${f(d.runnerS + d.serverS + d.ollamaS, 2)} (${f(d.runnerS, 2)} / ${f(d.serverS, 2)} / ${f(d.ollamaS, 2)}) | **${f(d.cpuAJq)}** (${f(d.cpuBJq)}, ${f(r.cpuCJq)}) | **${f(d.totalGrossJq)}** ±${f(d.totalGrossCi)} | ${f(d.totalMargJq)} | ${f(d.gpuPerCorrect)} | **${f(d.totalGrossPerCorrect)}** | ${f(d.totalMargPerCorrect)} | ${f(100 * d.cpuShare)}% / ${f(100 * d.cpuShareMarg)}% | ${f(d.pkgJq)} / ${f(d.pkgDynJq)} |`)
}
say("")
say("By path (unweighted means over the run's questions; runner CPU s/q deconvolved from the 1 Hz samples, ±95%; CPU J/q uses the deconvolved runner CPU + interpolated llama-server/ollama):")
say("| run | path | n | wall ms | non-gen ms | GPU J/q | runner CPU s/q (deconvolved ±95%) | runner CPU s/q (interpolated) | CPU J/q | total J/q (gross GPU + CPU) | CPU share |")
say("|---|---|---|---|---|---|---|---|---|---|---|")
const order = ["one-shot", "commit", "g5", "m2", "m2+g5", "explore"]
for (const r of rows.filter((x) => x.n && x.runner)) for (const p of order.filter((x) => r.paths[x])) {
    const pt = r.paths[p], bp = r.runner.byPath[p]
    say(`| ${r.spec} | ${p} | ${pt.n} | ${f(pt.wallMs)} | ${f(bp.nonGenMs)} | ${f(pt.gpuJq)} | ${f(bp.cpuSq, 2)} ${Number.isFinite(bp.cpuSqCi) ? `±${f(bp.cpuSqCi, 2)}` : ""} | ${f(bp.interpCpuSq, 2)} | ${f(pt.cpuAJqDecon, 1)} | ${f(pt.totalJqDecon)} | ${f(100 * pt.cpuAJqDecon / pt.totalJqDecon)}% |`)
}
say("")
say("J per correct answer under each accounting (design-weighted; in brackets the ratio to the same set's gates row, when present):")
say("| run | GPU gross (round-5 tables) | GPU gross + CPU A (primary) | GPU marginal + CPU A (i-energy's total) | GPU gross + CPU C (by-group slopes) | GPU gross + all dynamic package power in windows (upper bound) | box level: GPU gross + CPU floor x wall + CPU A |")
say("|---|---|---|---|---|---|---|")
const keyA = (x) => (x.cpuCovered ? x.dw.totalGrossPerCorrect : x.imputed?.totalGrossPerCorrect)
const keyAm = (x) => (x.cpuCovered ? x.dw.totalMargPerCorrect : x.imputed?.totalMargPerCorrect)
for (const r of rows.filter((x) => x.n)) {
    const d = r.dw
    const g = rows.find((x) => x.n && x.setName === r.setName && /gates/.test(x.variant))
    const rat = (key) => { const v = key(r), b = g && g !== r ? key(g) : NaN; return Number.isFinite(v) && Number.isFinite(b) ? ` (${f(v / b, 2)}x)` : "" }
    const tag = r.cpuCovered ? "" : "imputed "
    const cell = (key) => (Number.isFinite(key(r)) ? `${tag}${f(key(r))}${rat(key)}` : "–")
    const plain = (key) => (Number.isFinite(key(r)) ? `${f(key(r))}${rat(key)}` : "–")
    say(`| ${r.spec}${r.cpuCovered ? "" : " (no CPU sampler)"} | ${plain((x) => x.dw.gpuPerCorrect)} | ${cell(keyA)} | ${cell(keyAm)} | ${plain((x) => x.dw.totalGrossPerCorrectC)} | ${plain((x) => x.dw.pkgUpperPerCorrect)} | ${r.cpuCovered ? plain((x) => x.dw.boxPerCorrect) : "–"} |`)
}
for (const r of rows) { delete r._perQ; delete r._wm }
if (outPath) writeFileSync(outPath, JSON.stringify({ logPath, cpuPath, logical, idle: { windows: idleBlocks.length, gpuW: idleGpuW, cpuW: idleCpuW }, fitBlock, fit1s, fitC, rows }, null, 2))
if (mdPath) writeFileSync(mdPath, lines.join("\n") + "\n")
process.exit(0)
