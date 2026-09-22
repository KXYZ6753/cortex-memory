// Offline integration for the overnight energy log.
//
// The logger (energy-logger.js) and the generation process each append their
// own JSONL file while the benchmark runs: raw GPU/CPU power samples on one
// side, block/idle markers on the other. Nothing here talks to a process, a
// socket, or the filesystem except readJsonl (a plain read, no writes, no
// mutation of module state) — every other export is a pure function of its
// arguments, safe to call from a test or an offline report script.
//
// Marker shape: { t, kind: "block-start"|"block-end"|"idle-start"|"idle-end", blockId, model, cell, judgeActive }
// Sample shape (as written by the logger): { t, wall, src: "gpu"|"cpu"|"status"|"heartbeat", watts, ... }

import { readFile } from "node:fs/promises"

const CPU_PACKAGE_SENSOR_ID = /\/(intelcpu|amdcpu)\/\d+\/power\/\d+/i
const CPU_PACKAGE_TEXT = /package/i
const CPU_LIKE_ANCESTOR = /intel|amd|ryzen|core|xeon|cpu/i

// ---------------------------------------------------------------------------
// LibreHardwareMonitor value + tree parsing
// ---------------------------------------------------------------------------

// "45.2 W" -> 45.2, "45,2 W" -> 45.2, "1.234,5 W" -> 1234.5, "1,234.5 W" -> 1234.5, "abc" -> null
export function parseLhmValue(raw) {
    if (typeof raw !== "string") return null
    const trimmed = raw.trim()
    if (!trimmed) return null
    const match = trimmed.match(/^([+-]?[\d.,\s]+)/)
    if (!match) return null
    let numeric = match[1].trim()
    if (!numeric) return null

    const hasComma = numeric.includes(",")
    const hasDot = numeric.includes(".")
    if (hasComma && hasDot) {
        const lastComma = numeric.lastIndexOf(",")
        const lastDot = numeric.lastIndexOf(".")
        numeric = lastComma > lastDot
            ? numeric.replace(/\./g, "").replace(",", ".") // comma is the decimal separator
            : numeric.replace(/,/g, "") // dot is the decimal separator
    } else if (hasComma) {
        // A single comma with no dot is a decimal separator, per LHM's locale formatting.
        numeric = numeric.replace(",", ".")
    }
    numeric = numeric.replace(/\s+/g, "")

    const value = Number(numeric)
    return Number.isFinite(value) ? value : null
}

// Walks an LHM data.json tree looking for the CPU package power sensor.
// Primary: a node whose SensorId is a package-power leaf under intelcpu/amdcpu
// and whose Text mentions "package". Fallback: any node under a CPU-like
// ancestor (Text containing Intel/AMD/Ryzen/Core/Xeon/CPU) whose own Text
// mentions "package" and whose Value looks like a wattage.
export function findCpuPackageSensor(root) {
    if (!root || typeof root !== "object") return null

    const primary = []
    const fallback = []

    function walk(node, ancestorTexts) {
        if (!node || typeof node !== "object") return
        const text = typeof node.Text === "string" ? node.Text : ""
        const path = [...ancestorTexts, text].filter(Boolean).join(" > ")
        const value = typeof node.Value === "string" ? node.Value : null
        const isPackageText = CPU_PACKAGE_TEXT.test(text)
        const sensorId = typeof node.SensorId === "string" ? node.SensorId : null

        if (isPackageText && sensorId && CPU_PACKAGE_SENSOR_ID.test(sensorId)) {
            primary.push({ path, sensorId, text, value })
        } else if (isPackageText && value && / W$/i.test(value.trim())) {
            const underCpu = ancestorTexts.some((ancestorText) => CPU_LIKE_ANCESTOR.test(ancestorText))
            if (underCpu) fallback.push({ path, sensorId, text, value })
        }

        const children = Array.isArray(node.Children) ? node.Children : []
        for (const child of children) walk(child, [...ancestorTexts, text])
    }

    walk(root, [])
    if (primary.length) return primary[0]
    if (fallback.length) return fallback[0]
    return null
}

// ---------------------------------------------------------------------------
// nvidia-smi CSV parsing
// ---------------------------------------------------------------------------

function toNumberOrNull(value) {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed || /n\/a/i.test(trimmed)) return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
}

// Parses one `nvidia-smi --format=csv,noheader,nounits` line.
// fieldsHaveInstant=true expects power.draw.instant,power.draw,utilization.gpu,memory.used.
// fieldsHaveInstant=false (the fallback field list) expects power.draw,utilization.gpu,memory.used.
export function parseNvidiaSmiLine(line, fieldsHaveInstant) {
    if (typeof line !== "string") return null
    const parts = line.split(",").map((part) => part.trim())

    if (fieldsHaveInstant) {
        if (parts.length < 4) return null
        const [instant, average, util, mem] = parts
        // Some GPUs report [N/A] for the instant field; fall back to the average.
        return { watts: toNumberOrNull(instant) ?? toNumberOrNull(average), wattsAvg: toNumberOrNull(average), util: toNumberOrNull(util), memMB: toNumberOrNull(mem) }
    }
    if (parts.length < 3) return null
    const [average, util, mem] = parts
    return { watts: toNumberOrNull(average), wattsAvg: null, util: toNumberOrNull(util), memMB: toNumberOrNull(mem) }
}

// ---------------------------------------------------------------------------
// JSONL loading
// ---------------------------------------------------------------------------

export async function readJsonl(path) {
    const raw = await readFile(path, "utf8")
    const lines = raw.split("\n")
    const records = []
    let dropped = 0
    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        try {
            records.push(JSON.parse(line))
        } catch {
            dropped++
        }
    }
    return { records, dropped }
}

// ---------------------------------------------------------------------------
// Trapezoid integration with edge interpolation
// ---------------------------------------------------------------------------

const round2 = (value) => (value == null || Number.isNaN(value) ? null : Math.round(value * 100) / 100)

function lerp(a, b, t) {
    if (b.t === a.t) return a.watts
    const ratio = (t - a.t) / (b.t - a.t)
    return a.watts + (b.watts - a.watts) * ratio
}

// Builds the point list to trapezoid-integrate over [start, end]: samples
// strictly inside the window, plus the window edges, interpolated from the
// nearest samples just outside when no in-window sample sits on the edge.
// This is what keeps a short window (e.g. 0.25s inside a 1s sampling
// interval) from integrating to zero.
function buildWindowPoints(sourceSamples, start, end) {
    const finite = sourceSamples.filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.watts))
    const inside = finite.filter((sample) => sample.t > start && sample.t < end).sort((a, b) => a.t - b.t)

    let before = null
    let after = null
    for (const sample of finite) {
        if (sample.t <= start && (!before || sample.t > before.t)) before = sample
        if (sample.t >= end && (!after || sample.t < after.t)) after = sample
    }

    const points = []
    if (before && inside.length) points.push({ t: start, watts: lerp(before, inside[0], start) })
    else if (before && after) points.push({ t: start, watts: lerp(before, after, start) })
    else if (inside.length) points.push({ t: start, watts: inside[0].watts })
    else if (before) points.push({ t: start, watts: before.watts })

    for (const sample of inside) points.push(sample)

    if (after && inside.length) points.push({ t: end, watts: lerp(inside[inside.length - 1], after, end) })
    else if (before && after) points.push({ t: end, watts: lerp(before, after, end) })
    else if (inside.length) points.push({ t: end, watts: inside[inside.length - 1].watts })
    else if (after) points.push({ t: end, watts: after.watts })

    return points
}

function trapezoidJoules(points) {
    if (points.length < 2) return { joules: 0, meanWatts: points.length === 1 ? points[0].watts : null }
    let joules = 0
    let wattSeconds = 0
    let totalSeconds = 0
    for (let index = 0; index + 1 < points.length; index++) {
        const seconds = (points[index + 1].t - points[index].t) / 1000
        if (seconds <= 0) continue
        const averageWatts = (points[index].watts + points[index + 1].watts) / 2
        joules += averageWatts * seconds
        wattSeconds += averageWatts * seconds
        totalSeconds += seconds
    }
    return { joules, meanWatts: totalSeconds > 0 ? wattSeconds / totalSeconds : null }
}

function medianInterval(sortedTimes) {
    if (sortedTimes.length < 2) return null
    const deltas = []
    for (let index = 0; index + 1 < sortedTimes.length; index++) {
        const delta = sortedTimes[index + 1] - sortedTimes[index]
        if (delta > 0) deltas.push(delta)
    }
    if (!deltas.length) return null
    deltas.sort((a, b) => a - b)
    const mid = Math.floor(deltas.length / 2)
    return deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2
}

// Fraction of the window covered by gaps no larger than 2x the source's
// nominal sampling interval — a stand-in for "did this source actually keep
// sampling through the whole block."
function computeCoverage(points, windowSeconds, nominalIntervalMs) {
    if (!points.length || windowSeconds <= 0) return 0
    if (!Number.isFinite(nominalIntervalMs) || nominalIntervalMs <= 0) return points.length >= 2 ? 1 : 0
    let coveredMs = 0
    for (let index = 0; index + 1 < points.length; index++) {
        const gapMs = points[index + 1].t - points[index].t
        if (gapMs <= 0) continue
        if (gapMs <= 2 * nominalIntervalMs) coveredMs += gapMs
    }
    return Math.min(1, (coveredMs / 1000) / windowSeconds)
}

function groupSamplesBySource(samples) {
    const bySource = { gpu: [], cpu: [] }
    for (const sample of samples) {
        const watts = Number.isFinite(sample?.watts) ? sample.watts : sample?.wattsAvg
        if (!sample || !Number.isFinite(sample.t) || !Number.isFinite(watts)) continue
        if (sample.src === "gpu") bySource.gpu.push({ t: sample.t, watts })
        else if (sample.src === "cpu") bySource.cpu.push({ t: sample.t, watts })
    }
    bySource.gpu.sort((a, b) => a.t - b.t)
    bySource.cpu.sort((a, b) => a.t - b.t)
    return bySource
}

function groupMarkersByBlock(markers) {
    const byBlock = new Map()
    for (const marker of markers) {
        if (!marker || marker.blockId == null) continue
        if (!byBlock.has(marker.blockId)) byBlock.set(marker.blockId, [])
        byBlock.get(marker.blockId).push(marker)
    }
    return byBlock
}

function buildBlockEntry(blockId, blockMarkers, bySource, nominalIntervalMs) {
    const startMarker = blockMarkers.find((marker) => marker.kind === "block-start") ?? blockMarkers.find((marker) => marker.kind === "idle-start")
    const endMarker = blockMarkers.find((marker) => marker.kind === "block-end") ?? blockMarkers.find((marker) => marker.kind === "idle-end")
    if (!startMarker || !endMarker) return null

    const kind = startMarker.kind === "idle-start" ? "idle" : "block"
    const start = startMarker.t
    const end = endMarker.t
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null

    const seconds = (end - start) / 1000
    const model = startMarker.model ?? endMarker.model ?? null
    const cell = startMarker.cell ?? endMarker.cell ?? null
    const judgeActive = blockMarkers.some((marker) => marker.judgeActive === true)

    const gpuPoints = buildWindowPoints(bySource.gpu, start, end)
    const cpuPoints = buildWindowPoints(bySource.cpu, start, end)
    const gpuIntegral = trapezoidJoules(gpuPoints)
    const cpuIntegral = trapezoidJoules(cpuPoints)
    const gpuJ = round2(gpuIntegral.joules)
    const cpuJ = round2(cpuIntegral.joules)
    const totalJ = round2(gpuIntegral.joules + cpuIntegral.joules)

    const entry = {
        blockId,
        kind,
        model,
        cell,
        judgeActive,
        start,
        end,
        seconds: round2(seconds),
        gpuJ,
        cpuJ,
        totalJ,
        grossJ: totalJ,
        marginalJ: null,
        gpuMeanW: gpuIntegral.meanWatts == null ? null : round2(gpuIntegral.meanWatts),
        cpuMeanW: cpuIntegral.meanWatts == null ? null : round2(cpuIntegral.meanWatts),
        idleGpuW: null,
        idleCpuW: null,
        counts: {
            gpu: bySource.gpu.filter((sample) => sample.t >= start && sample.t <= end).length,
            cpu: bySource.cpu.filter((sample) => sample.t >= start && sample.t <= end).length,
        },
        coverage: {
            gpu: computeCoverage(gpuPoints, seconds, nominalIntervalMs.gpu),
            cpu: computeCoverage(cpuPoints, seconds, nominalIntervalMs.cpu),
        },
    }

    if (kind === "idle") {
        entry.idleGpuW = entry.gpuMeanW
        entry.idleCpuW = entry.cpuMeanW
    }

    return entry
}

// Most recent baseline entry for `model` with t <= beforeTime.
function lookupIdleBaseline(baselinesByModel, model, beforeTime) {
    if (!baselinesByModel || !model) return null
    const list = baselinesByModel[model]
    if (!Array.isArray(list) || !list.length) return null
    let best = null
    for (const entry of list) {
        if (!entry || !Number.isFinite(entry.t) || entry.t > beforeTime) continue
        if (!best || entry.t > best.t) best = entry
    }
    return best
}

// integrateBlocks({ samples, markers, idleBaselines }) -> per-window results.
//
// samples: flat array of logger records ({ t, src: "gpu"|"cpu", watts, ... }); non gpu/cpu
//   records (status/heartbeat) are ignored.
// markers: flat array of { t, kind, blockId, model, cell, judgeActive } from the generation
//   process. Every blockId with a matching start+end pair (block-start/block-end, or
//   idle-start/idle-end) becomes one entry in the result.
// idleBaselines (optional): { [model]: [{ t, gpuW, cpuW }, ...] }. When a model isn't covered
//   there, the idle windows found in this same `markers` array are used instead (the most
//   recent one, for the same model, preceding the block).
export function integrateBlocks({ samples = [], markers = [], idleBaselines = null } = {}) {
    const bySource = groupSamplesBySource(Array.isArray(samples) ? samples : [])
    const nominalIntervalMs = {
        gpu: medianInterval(bySource.gpu.map((sample) => sample.t)),
        cpu: medianInterval(bySource.cpu.map((sample) => sample.t)),
    }

    const byBlock = groupMarkersByBlock(Array.isArray(markers) ? markers : [])
    const results = []
    for (const [blockId, blockMarkers] of byBlock) {
        const entry = buildBlockEntry(blockId, blockMarkers, bySource, nominalIntervalMs)
        if (entry) results.push(entry)
    }

    const derivedIdleBaselines = {}
    for (const entry of results) {
        if (entry.kind !== "idle" || !entry.model) continue
        derivedIdleBaselines[entry.model] ??= []
        derivedIdleBaselines[entry.model].push({ t: entry.end, gpuW: entry.gpuMeanW, cpuW: entry.cpuMeanW })
    }

    for (const entry of results) {
        if (entry.kind !== "block") continue
        const baseline = lookupIdleBaseline(idleBaselines, entry.model, entry.start)
            ?? lookupIdleBaseline(derivedIdleBaselines, entry.model, entry.start)
        if (!baseline) continue
        const idleGpuW = baseline.gpuW ?? 0
        const idleCpuW = baseline.cpuW ?? 0
        entry.idleGpuW = baseline.gpuW ?? null
        entry.idleCpuW = baseline.cpuW ?? null
        entry.marginalJ = round2(Math.max(0, entry.totalJ - (idleGpuW + idleCpuW) * entry.seconds))
    }

    return results
}

// ---------------------------------------------------------------------------
// Cross-block summary
// ---------------------------------------------------------------------------

function meanAndCi95(values) {
    const finite = values.filter((value) => Number.isFinite(value))
    const n = finite.length
    if (!n) return { n: 0, mean: null, stdDev: null, ci95: [null, null] }
    const meanValue = finite.reduce((sum, value) => sum + value, 0) / n
    if (n < 2) return { n, mean: round2(meanValue), stdDev: null, ci95: [null, null] }
    const variance = finite.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (n - 1)
    const stdDev = Math.sqrt(variance)
    const margin = 1.959964 * (stdDev / Math.sqrt(n))
    return { n, mean: round2(meanValue), stdDev: round2(stdDev), ci95: [round2(meanValue - margin), round2(meanValue + margin)] }
}

// summariseEnergy(blockResults, answersPerBlock) -> gross/marginal J per answer, per block,
// plus a mean and normal-approximation 95% CI across blocks for each model x cell.
// answersPerBlock: { [blockId]: number of answers generated in that block }.
export function summariseEnergy(blockResults, answersPerBlock = {}) {
    const perBlock = []
    for (const block of blockResults ?? []) {
        if (block.kind !== "block") continue
        const answers = Number(answersPerBlock?.[block.blockId]) || null
        const grossJPerAnswer = answers ? round2(block.grossJ / answers) : null
        const marginalJPerAnswer = answers && block.marginalJ != null ? round2(block.marginalJ / answers) : null
        perBlock.push({
            blockId: block.blockId,
            model: block.model,
            cell: block.cell,
            answers,
            grossJ: block.grossJ,
            marginalJ: block.marginalJ,
            grossJPerAnswer,
            marginalJPerAnswer,
        })
    }

    const groups = new Map()
    for (const row of perBlock) {
        const key = `${row.model ?? "unknown"}|${row.cell ?? "unknown"}`
        if (!groups.has(key)) groups.set(key, { model: row.model, cell: row.cell, gross: [], marginal: [] })
        const group = groups.get(key)
        if (row.grossJPerAnswer != null) group.gross.push(row.grossJPerAnswer)
        if (row.marginalJPerAnswer != null) group.marginal.push(row.marginalJPerAnswer)
    }

    const byModelCell = {}
    for (const [key, group] of groups) {
        byModelCell[key] = {
            model: group.model,
            cell: group.cell,
            grossJPerAnswer: meanAndCi95(group.gross),
            marginalJPerAnswer: meanAndCi95(group.marginal),
        }
    }

    return { perBlock, byModelCell }
}
