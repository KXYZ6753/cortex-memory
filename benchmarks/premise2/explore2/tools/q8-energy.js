// Worker q8 (round 6): GPU energy per question for the q8 arms (Q4 vs Q8), from a running
// energy-logger.js log (default: s6's session log, which records the whole machine).
//
//   node benchmarks/premise2/explore2/tools/q8-energy.js [--log .data/premise2/explore/s6-energy.jsonl]
//        [--variant q8-det-oracle] [--sets FULL-2,FULL-3,S300-4,S300-5]
//
// Windows: one block per answer, [at − wallMs, at] (the runner's timing of variant.run; model
// load and warm-up excluded). The GPU lock serialises generation, so GPU power inside a
// window is this run's. Integration: integrateBlocks from ../../energy-integrate.js
// (trapezoid with edge interpolation), unchanged. Reports gross GPU J per question, mean GPU W,
// and the GPU memory in use (nvidia-smi memory.used) during the windows; CPU package power is
// reported raw (it includes other workers' CPU jobs, so it is an upper bound only). No idle
// subtraction (the two models' idle draw was not measured separately).

import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { integrateBlocks, readJsonl } from "../../energy-integrate.js"
import { FINAL_STATUSES } from "../../explore/run.js"

const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const logPath = opt("log", join(dataDir, "explore", "s6-energy.jsonl"))
const variant = opt("variant", "q8-det-oracle")
const sets = new Set(opt("sets", "FULL-2,FULL-3,S300-4,S300-5").split(","))
for (const s of sets) if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(s)) throw new Error(`${s} is not a development set`)

const answers = new Map()
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    if (!line || !line.includes(`"variant":"${variant}"`)) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!sets.has(r.set) || !FINAL_STATUSES.has(r.status)) continue
    answers.set(r.key, r)
}
const { records: samples } = await readJsonl(logPath)
const gpu = samples.filter((s) => s.src === "gpu")
const t0 = Math.min(...gpu.map((s) => s.t))
const t1 = Math.max(...gpu.map((s) => s.t))
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)

const byAlias = new Map()
for (const r of answers.values()) {
    const end = Date.parse(r.at)
    const start = end - r.wallMs
    if (start < t0 || end > t1) continue
    const list = byAlias.get(r.alias) ?? []
    list.push({ r, start, end })
    byAlias.set(r.alias, list)
}
console.log(`log ${logPath}: ${new Date(t0).toISOString()} .. ${new Date(t1).toISOString()}`)
console.log("| alias | answers in log | wall ms | GPU J / q | GPU mean W | GPU mem MB (median in windows) | CPU pkg W (raw) |")
console.log("|---|---|---|---|---|---|---|")
for (const [alias, list] of byAlias) {
    const lo = Math.min(...list.map((w) => w.start)) - 5_000
    const hi = Math.max(...list.map((w) => w.end)) + 5_000
    const near = samples.filter((s) => s.t >= lo && s.t <= hi)
    const markers = list.flatMap((w, i) => [
        { t: w.start, kind: "block-start", blockId: `b${i}`, model: alias, cell: variant },
        { t: w.end, kind: "block-end", blockId: `b${i}`, model: alias, cell: variant },
    ])
    const blocks = integrateBlocks({ samples: near, markers })
    const seconds = blocks.reduce((a, b) => a + b.seconds, 0)
    const gpuJ = blocks.reduce((a, b) => a + b.gpuJ, 0)
    const cpuJ = blocks.reduce((a, b) => a + (b.cpuJ ?? 0), 0)
    const inWindows = near.filter((s) => s.src === "gpu" && Number.isFinite(s.memMB) && list.some((w) => s.t >= w.start && s.t <= w.end)).map((s) => s.memMB).sort((a, b) => a - b)
    console.log(`| ${alias} | ${list.length} | ${Math.round(mean(list.map((w) => w.r.wallMs)))} | ${(gpuJ / list.length).toFixed(1)} | ${(gpuJ / seconds).toFixed(1)} | ${inWindows[Math.floor(inWindows.length / 2)] ?? "–"} | ${(cpuJ / seconds).toFixed(1)} |`)
}
