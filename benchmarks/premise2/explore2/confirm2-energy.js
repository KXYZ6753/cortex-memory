// Energy for a TEST arm (addendum 4 §5; worker p3). Two bases, both from the run's own files
// (energy.jsonl from energy-logger.js, cpu.jsonl from tools/i-cpusampler.js, markers.jsonl):
//
//  1. Addendum 3's basis (block integration, explore/confirm.js analyzeConfirm): CPU package +
//     GPU over each block of 50, gross and marginal (the run's idle baseline subtracted), per
//     answer; a lower bound, comparable with gates' TEST figure.
//  2. e2.md's attribution (tools/e2-energy.js, method A with B as a check):
//     - GPU per question window [at - wallMs, at], gross and marginal (idle GPU W x seconds);
//     - CPU = (runner pid + every llama-server + ollama) CPU-seconds inside the windows, from
//       the sampler's cumulative counters (segments split at gaps > 5 s or when a counter falls,
//       linear interpolation), x J per CPU-second from this run's own fit of LHM package W on
//       machine busy % over 10 s block means (J/CPU-s = b x 100 / logical CPUs);
//     - B: per 10 s block, package power above the fitted floor shared out by CPU-seconds.
//     The runner pid comes from manifest.jsonl (explore2 arms) or, for a run without a manifest
//     (addendum 3's gates run), is detected as e2.md does: the node process alive over the
//     whole run with the most CPU inside the run's windows (logger/sampler pids excluded);
//     the runner-up and the correlation with non-generation time are reported.
// Unweighted means over the answers given (TEST is not design-weighted).

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { cpus } from "node:os"
import { integrateBlocks, summariseEnergy, readJsonl as readEnergyJsonl } from "../energy-integrate.js"

const BLOCK_MS = 10_000
// Round-5 fit (e2.md §1), used only when the run has fewer than 30 usable 10 s blocks.
export const FALLBACK_J_PER_CPU_S = 8.37
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN)
const round = (value, digits = 1) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)))
const readJsonl = (path) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }) : [])
export const windowOf = (answer) => { const end = Date.parse(answer.at); return { start: end - answer.wallMs, end } }

function ols2(xs, ys) {
    const mx = mean(xs), my = mean(ys)
    let sxy = 0, sxx = 0, syy = 0
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
    const b = sxy / sxx
    return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy), n: xs.length }
}
function pearson(xs, ys) {
    const mx = mean(xs), my = mean(ys)
    let sxy = 0, sxx = 0, syy = 0
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
    return sxy / Math.sqrt(sxx * syy)
}

// Sampler segments: one per pid lifetime (Windows reuses pids).
function segmentsOf(cpuRecs) {
    const segments = []
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
    for (const s of segments) { s.first = s.points[0].t; s.last = s.points.at(-1).t }
    return segments
}
const lowerIdx = (pts, t) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].t <= t) lo = m; else hi = m - 1 } return lo }
function cumAt(pts, t) {
    if (t <= pts[0].t) return pts[0].cpu
    if (t >= pts.at(-1).t) return pts.at(-1).cpu
    const k = lowerIdx(pts, t)
    const a = pts[k], b = pts[k + 1]
    return a.cpu + (b.cpu - a.cpu) * (t - a.t) / (b.t - a.t)
}
const segCpu = (s, lo, hi) => (s.last < lo || s.first > hi ? 0 : Math.max(0, cumAt(s.points, hi) - cumAt(s.points, lo)))
const groupCpu = (segs, lo, hi) => segs.reduce((acc, s) => acc + segCpu(s, lo, hi), 0)

// answers: the run's final answer records (at, wallMs, genMs, blockId, session); accuracy: the
// tier-A accuracy over the same answers (for J per correct answer), or null.
// runnerPids: { [session]: pid } from the manifest, or null to detect; excludePids: logger etc.
export async function armEnergy({ dir, answers, accuracy = null, runnerPids = null, excludePids = [], logicalCpus = cpus().length }) {
    const energyPath = join(dir, "energy.jsonl")
    if (!existsSync(energyPath)) return { available: false, reason: "no energy.jsonl" }
    const samples = (await readEnergyJsonl(energyPath)).records
    const markers = readJsonl(join(dir, "markers.jsonl"))
    const timed = answers.filter((a) => Number.isFinite(a.wallMs) && a.at).sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
    const perCorrect = (value) => (value != null && Number.isFinite(value) && accuracy ? round(value / accuracy) : null)

    // 1. addendum 3's basis
    const blocks = integrateBlocks({ samples, markers })
    const perBlock = {}
    for (const a of answers) if (a.blockId) perBlock[a.blockId] = (perBlock[a.blockId] ?? 0) + 1
    const summary = summariseEnergy(blocks, perBlock)
    const entry = Object.values(summary.byModelCell)[0] ?? null
    const idleBlocks = blocks.filter((b) => b.kind === "idle")
    const basis1 = {
        label: "CPU package + GPU, blocks of 50 (addendum 3's basis; a lower bound)",
        grossJPerAnswer: entry?.grossJPerAnswer ?? null, marginalJPerAnswer: entry?.marginalJPerAnswer ?? null,
        grossJPerCorrect: perCorrect(entry?.grossJPerAnswer?.mean), marginalJPerCorrect: perCorrect(entry?.marginalJPerAnswer?.mean),
        idle: idleBlocks.map((b) => ({ seconds: b.seconds, gpuMeanW: b.gpuMeanW, cpuMeanW: b.cpuMeanW })),
        samples: { gpu: samples.filter((s) => s.src === "gpu").length, cpu: samples.filter((s) => s.src === "cpu").length },
    }
    if (!timed.length) return { available: true, basis1, basis2: null }

    // 2. e2.md's attribution. GPU per question window; the run's idle blocks are kept in the
    // marker list so each window's marginal uses the latest preceding idle baseline.
    const windows = timed.map(windowOf)
    const qMarkers = [
        ...markers.filter((m) => m.kind === "idle-start" || m.kind === "idle-end"),
        ...timed.flatMap((a, i) => [
            { t: windows[i].start, kind: "block-start", blockId: `q${i}`, model: "small", cell: "q" },
            { t: windows[i].end, kind: "block-end", blockId: `q${i}`, model: "small", cell: "q" },
        ]),
    ]
    const qBlocks = new Map(integrateBlocks({ samples, markers: qMarkers }).filter((b) => b.kind === "block").map((b) => [b.blockId, b]))

    const cpuRecs = readJsonl(join(dir, "cpu.jsonl")).filter((r) => Number.isFinite(r.util)).sort((x, y) => x.t - y.t)
    const c0 = cpuRecs[0]?.t ?? Infinity
    const c1 = cpuRecs.at(-1)?.t ?? -Infinity
    const segments = segmentsOf(cpuRecs)
    const serverSegs = segments.filter((s) => s.name === "llama-server")
    const ollamaSegs = segments.filter((s) => s.name === "ollama")
    const lhm = samples.filter((s) => s.src === "cpu" && Number.isFinite(s.watts))
    // 10 s block fit of package W on busy %
    const tenS = new Map()
    for (const r of cpuRecs) { const k = Math.floor(r.t / BLOCK_MS); const e = tenS.get(k) ?? { k, u: 0, nu: 0, w: 0, nw: 0 }; e.u += r.util; e.nu++; tenS.set(k, e) }
    for (const r of lhm) { const e = tenS.get(Math.floor(r.t / BLOCK_MS)); if (e) { e.w += r.watts; e.nw++ } }
    const good = [...tenS.values()].filter((e) => e.nu >= 8 && e.nw >= 8)
    const fitted = good.length >= 30 ? ols2(good.map((e) => e.u / e.nu), good.map((e) => e.w / e.nw)) : null
    const fit = fitted
        ? { source: "this run", a: round(fitted.a, 2), b: round(fitted.b, 4), r2: round(fitted.r2, 3), blocks: fitted.n, jPerCpuS: round(fitted.b * 100 / logicalCpus, 3) }
        : { source: `fallback: round-5 fit (e2.md §1), only ${good.length} usable 10 s blocks`, a: 41.5, b: null, r2: null, blocks: good.length, jPerCpuS: FALLBACK_J_PER_CPU_S }
    const busyCpuS = (lo, hi) => {
        let acc = 0
        for (let k = lowerIdx(cpuRecs, lo); k < cpuRecs.length && cpuRecs[k].t <= hi + 1_000; k++) {
            const r = cpuRecs[k]
            const a = Math.max(lo, cpuRecs[k - 1]?.t ?? r.t - 1_000)
            const b = Math.min(hi, r.t)
            if (b > a) acc += (r.util / 100) * logicalCpus * (b - a) / 1000
        }
        return acc
    }

    // runner(s): per session from the manifest, else detected over the whole run
    const sessions = new Map()
    timed.forEach((a, i) => { const key = a.session ?? "run"; if (!sessions.has(key)) sessions.set(key, []); sessions.get(key).push(i) })
    const exclude = new Set(excludePids.map(Number))
    const runners = []
    const runnerOfIndex = new Array(timed.length).fill(null)
    for (const [session, idx] of sessions) {
        const lo = Math.min(...idx.map((i) => windows[i].start))
        const hi = Math.max(...idx.map((i) => windows[i].end))
        const inWin = (s) => idx.reduce((acc, i) => acc + segCpu(s, windows[i].start, windows[i].end), 0)
        const candidates = segments
            .filter((s) => s.name === "node" && !exclude.has(s.pid) && s.first <= lo + 1_500 && s.last >= hi - 3_000)
            .map((s) => ({ seg: s, inWin: inWin(s) }))
            .sort((x, y) => y.inWin - x.inWin)
        const pinned = runnerPids?.[session] ?? null
        const chosen = pinned != null ? candidates.find((c) => c.seg.pid === Number(pinned)) ?? null : candidates[0] ?? null
        const second = candidates.find((c) => c !== chosen) ?? null
        const covered = cpuRecs.length > 0 && lo >= c0 && hi <= c1
        let r = null
        if (chosen) {
            const per = idx.map((i) => segCpu(chosen.seg, windows[i].start, windows[i].end))
            const nonGen = idx.map((i) => timed[i].wallMs - (timed[i].genMs ?? 0))
            r = per.length > 2 ? pearson(per, nonGen) : null
        }
        runners.push({
            session, pid: chosen?.seg.pid ?? null, source: pinned != null ? "manifest" : "detected", pinnedPid: pinned, found: Boolean(chosen), covered,
            cpuSecondsInWindows: round(chosen?.inWin, 2), perAnswer: round(chosen ? chosen.inWin / idx.length : null, 3),
            runnerUp: second ? { pid: second.seg.pid, perAnswer: round(second.inWin / idx.length, 3) } : null, rNonGen: round(r, 2), answers: idx.length,
        })
        for (const i of idx) runnerOfIndex[i] = covered ? chosen?.seg ?? null : undefined
    }

    const perQ = timed.map((a, i) => {
        const w = windows[i]
        const b = qBlocks.get(`q${i}`)
        const seg = runnerOfIndex[i]
        const covered = seg !== undefined
        const run = seg ? segCpu(seg, w.start, w.end) : 0
        const server = covered ? groupCpu(serverSegs, w.start, w.end) : NaN
        const oll = covered ? groupCpu(ollamaSegs, w.start, w.end) : NaN
        const own = run + server + oll
        let cpuB = 0
        if (covered) for (let k = Math.floor(w.start / BLOCK_MS); k <= Math.floor(w.end / BLOCK_MS); k++) {
            const blk = tenS.get(k)
            if (!blk?.nw) continue
            const bl = k * BLOCK_MS, bh = bl + BLOCK_MS
            const ownBlk = (seg ? segCpu(seg, bl, bh) : 0) + groupCpu(serverSegs, bl, bh) + groupCpu(ollamaSegs, bl, bh)
            const rate = Math.max(0, blk.w / blk.nw - fit.a) * (BLOCK_MS / 1000) / Math.max(busyCpuS(bl, bh), ownBlk, 1e-9)
            const lo2 = Math.max(w.start, bl), hi2 = Math.min(w.end, bh)
            cpuB += rate * ((seg ? segCpu(seg, lo2, hi2) : 0) + groupCpu(serverSegs, lo2, hi2) + groupCpu(ollamaSegs, lo2, hi2))
        }
        const gpu = b?.gpuJ ?? NaN
        const gpuMarg = b ? b.gpuJ - (b.idleGpuW ?? 0) * b.seconds : NaN
        return { gpu, gpuMarg, run, server, oll, own, cpuA: covered ? fit.jPerCpuS * own : NaN, cpuB: covered ? cpuB : NaN }
    })
    const m = (fn) => mean(perQ.map(fn).filter(Number.isFinite))
    const coveredN = perQ.filter((q) => Number.isFinite(q.cpuA)).length
    const gpuJ = m((q) => q.gpu), gpuMargJ = m((q) => q.gpuMarg), cpuAJ = m((q) => q.cpuA), cpuBJ = m((q) => q.cpuB)
    const basis2 = {
        label: "e2.md attribution: GPU per question window + (runner + llama-server + ollama) CPU-seconds x J per CPU-second",
        answers: timed.length, cpuCovered: coveredN, fit, runners,
        perAnswer: {
            gpuGrossJ: round(gpuJ), gpuMarginalJ: round(gpuMargJ),
            cpuSeconds: { runner: round(m((q) => q.run), 3), llamaServer: round(m((q) => q.server), 3), ollama: round(m((q) => q.oll), 3) },
            cpuAJ: round(cpuAJ), cpuBJ: round(cpuBJ),
            totalGrossJ: round(gpuJ + cpuAJ), totalMarginalJ: round(gpuMargJ + cpuAJ),
            cpuShare: round(cpuAJ / (gpuJ + cpuAJ), 3),
        },
        perCorrect: {
            gpuGrossJ: perCorrect(gpuJ), gpuMarginalJ: perCorrect(gpuMargJ),
            totalGrossJ: perCorrect(gpuJ + cpuAJ), totalMarginalJ: perCorrect(gpuMargJ + cpuAJ), totalGrossJB: perCorrect(gpuJ + cpuBJ),
        },
    }
    return { available: true, basis1, basis2 }
}
