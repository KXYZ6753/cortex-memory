#!/usr/bin/env node
// Standalone energy logger for the overnight premise benchmark.
//
// Runs as its own OS process, independent of the generation process, so a
// crash or hang here can never stall or abort generation. It only appends
// raw samples to a JSONL file (--out); a separate generation process writes
// its own block markers to a different JSONL file. All integration happens
// offline afterwards, in energy-integrate.js.
//
// Usage:
//   node benchmarks/premise2/energy-logger.js --out <path> \
//     [--lhm-url http://localhost:8085/data.json] \
//     [--gpu-ms 100] [--cpu-ms 1000] [--nvidia-smi nvidia-smi.exe]
//
// GPU power comes from `nvidia-smi -lms <gpu-ms>` (kept running, drained on
// both stdout and stderr, carry-buffered across chunk boundaries — the same
// pattern benchmarks/premiseBenchmark.js's startPowerMonitor uses, and for
// the same reason: an unread stderr pipe fills its buffer and nvidia-smi
// blocks on write, silently stalling sampling). CPU package power comes from
// LibreHardwareMonitor's built-in web server, with a Windows `typeperf`
// "Energy Meter" fallback when LHM is unreachable.
//
// Every line written to --out is one JSON object with `t` (epoch ms, float)
// and `wall` (ISO string), plus a `src`-specific payload. This process is
// long-running and unattended: every operation below is wrapped so a
// transient failure (a missing binary, a dead HTTP server, a malformed
// sensor tree) turns into a status line, never a crash.

import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { spawn } from "node:child_process"
import { findCpuPackageSensor, parseLhmValue, parseNvidiaSmiLine } from "./energy-integrate.js"

const GPU_MAX_RESTARTS = 20
const GPU_RESTART_DELAY_MS = 5_000
const HEARTBEAT_MS = 30_000
const LHM_TIMEOUT_MS = 2_000
const LHM_UNREACHABLE_THRESHOLD_MS = 10_000
const LHM_RETRY_WHILE_FALLBACK_MS = 30_000
const TYPEPERF_PROBE_TIMEOUT_MS = 10_000
const IMPLAUSIBLE_WARN_INTERVAL_MS = 60_000
const CPU_WATTS_MIN = 0.5
const CPU_WATTS_MAX = 400

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
    return "Usage: node benchmarks/premise2/energy-logger.js --out <path> [--lhm-url http://localhost:8085/data.json] [--gpu-ms 100] [--cpu-ms 1000] [--nvidia-smi nvidia-smi.exe]"
}

function parseArgs(argv) {
    const args = {
        out: null,
        lhmUrl: "http://localhost:8085/data.json",
        gpuMs: 100,
        cpuMs: 1000,
        nvidiaSmi: process.platform === "win32" ? "nvidia-smi.exe" : "nvidia-smi",
    }
    for (let index = 0; index < argv.length; index++) {
        const flag = argv[index]
        const value = () => argv[++index]
        switch (flag) {
            case "--out": args.out = value(); break
            case "--lhm-url": args.lhmUrl = value(); break
            case "--gpu-ms": args.gpuMs = Number(value()); break
            case "--cpu-ms": args.cpuMs = Number(value()); break
            case "--nvidia-smi": args.nvidiaSmi = value(); break
            default: throw new Error(`Unknown argument "${flag}"\n${usage()}`)
        }
    }
    if (!args.out) throw new Error(usage())
    if (!Number.isFinite(args.gpuMs) || args.gpuMs <= 0) throw new Error(`--gpu-ms must be a positive number\n${usage()}`)
    if (!Number.isFinite(args.cpuMs) || args.cpuMs <= 0) throw new Error(`--cpu-ms must be a positive number\n${usage()}`)
    return args
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function writeLine(stream, fields) {
    const t = performance.timeOrigin + performance.now()
    const record = { t, wall: new Date(t).toISOString(), ...fields }
    try {
        stream.write(`${JSON.stringify(record)}\n`)
    } catch {
        // The stream is in a bad state (e.g. EPIPE). Nothing useful to do
        // from a logger whose whole job is writing lines; drop and continue.
    }
}

// ---------------------------------------------------------------------------
// One-shot child process helper (typeperf probes/samples only — the
// persistent nvidia-smi -lms stream below is never awaited or unref'd).
// ---------------------------------------------------------------------------

function runOnce(command, args, { timeoutMs = 10_000 } = {}) {
    return new Promise((resolve) => {
        let child
        try {
            child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
        } catch (error) {
            resolve({ code: null, stdout: "", stderr: "", error })
            return
        }
        let stdout = ""
        let stderr = ""
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            try { child.kill() } catch { /* already gone */ }
            resolve({ code: null, stdout, stderr, timedOut: true })
        }, timeoutMs)

        child.stdout?.setEncoding("utf8")
        child.stdout?.on("data", (chunk) => { stdout += chunk })
        child.stderr?.setEncoding("utf8")
        child.stderr?.on("data", (chunk) => { stderr += chunk })
        child.on("error", (error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({ code: null, stdout, stderr, error })
        })
        child.on("close", (code) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({ code, stdout, stderr })
        })
    })
}

function splitCsvLine(line) {
    return line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""))
}

// Best-effort parse of `typeperf "\Energy Meter(*)\Power" -sc 1` CSV output.
// Not verifiable off Windows; see the assumptions note in the final report.
function parseTypeperfPower(csvText) {
    if (typeof csvText !== "string") return null
    const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length < 2) return null
    const header = splitCsvLine(lines[0])
    const data = splitCsvLine(lines[1])
    if (header.length < 2 || data.length < 2) return null

    const totalIndex = header.findIndex((cell, index) => index > 0 && /_total/i.test(cell))
    if (totalIndex >= 0) {
        const value = Number(data[totalIndex])
        return Number.isFinite(value) ? value : null
    }
    let sum = 0
    let any = false
    for (let index = 1; index < data.length; index++) {
        const value = Number(data[index])
        if (Number.isFinite(value)) {
            sum += value
            any = true
        }
    }
    return any ? sum : null
}

function findNodeBySensorId(root, sensorId) {
    if (!root || typeof root !== "object" || !sensorId) return null
    if (root.SensorId === sensorId) return root
    const children = Array.isArray(root.Children) ? root.Children : []
    for (const child of children) {
        const found = findNodeBySensorId(child, sensorId)
        if (found) return found
    }
    return null
}

// ---------------------------------------------------------------------------
// GPU monitor: spawn-and-drain nvidia-smi -lms, field-list retry, restart
// with a cap. The child is never awaited and never unref'd — this process
// IS the long-running work, and awaiting a -lms child would block forever.
// ---------------------------------------------------------------------------

function startGpuMonitor({ binary, gpuMs, out, log, onSample }) {
    const state = {
        useInstant: true,
        instantRetried: false,
        restartCount: 0,
        stopped: false,
        disabled: false,
        child: null,
        restartTimer: null,
    }

    const fieldsFor = (useInstant) => (useInstant
        ? "power.draw.instant,power.draw,utilization.gpu,memory.used"
        : "power.draw,utilization.gpu,memory.used")

    function spawnChild(useInstant) {
        let child
        try {
            child = spawn(binary, [
                `--query-gpu=${fieldsFor(useInstant)}`,
                "--format=csv,noheader,nounits",
                "-lms", String(gpuMs),
            ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
        } catch (error) {
            log("warn", `${binary} failed to start (${error.code ?? error.message}); continuing with CPU only`)
            state.disabled = true
            return null
        }

        let carryOut = ""
        let carryErr = ""
        let gotData = false
        let sawFieldError = false
        let enoentSeen = false

        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk) => {
            carryOut += chunk
            const lines = carryOut.split("\n")
            carryOut = lines.pop() ?? ""
            for (const rawLine of lines) {
                const line = rawLine.trim()
                if (!line) continue
                const parsed = parseNvidiaSmiLine(line, useInstant)
                if (!parsed) continue
                gotData = true
                writeLine(out, { src: "gpu", ...parsed })
                onSample()
            }
        })

        // A pipe nobody reads fills its OS buffer; nvidia-smi then blocks on
        // write() and sampling silently stalls. Always drain stderr too.
        child.stderr.setEncoding("utf8")
        child.stderr.on("data", (chunk) => {
            carryErr += chunk
            if (/field/i.test(chunk) && /(unknown|invalid)/i.test(chunk)) sawFieldError = true
            if (carryErr.length > 8192) carryErr = carryErr.slice(-4096)
        })

        child.on("error", (error) => {
            if (error?.code === "ENOENT") {
                enoentSeen = true
                log("warn", `${binary} not found; continuing with CPU only`)
                state.disabled = true
                return
            }
            log("warn", `nvidia-smi process error: ${error.message}`)
        })

        child.on("close", (code) => {
            if (state.stopped || enoentSeen || state.disabled) return

            if (useInstant && !state.instantRetried && (code !== 0 || sawFieldError) && !gotData) {
                state.instantRetried = true
                log("warn", `nvidia-smi rejected the power.draw.instant field (exit ${code}); retrying without it`)
                state.useInstant = false
                state.child = spawnChild(false)
                return
            }

            if (state.restartCount >= GPU_MAX_RESTARTS) {
                log("warn", `nvidia-smi exited ${state.restartCount} times; giving up on GPU monitoring`)
                state.disabled = true
                return
            }
            state.restartCount++
            log("warn", `nvidia-smi exited unexpectedly (code ${code}); restarting in 5s (attempt ${state.restartCount}/${GPU_MAX_RESTARTS})`)
            state.restartTimer = setTimeout(() => {
                if (state.stopped) return
                state.child = spawnChild(state.useInstant)
            }, GPU_RESTART_DELAY_MS)
        })

        return child
    }

    state.child = spawnChild(true)

    return {
        stop() {
            state.stopped = true
            if (state.restartTimer) clearTimeout(state.restartTimer)
            if (state.child && !state.child.killed) {
                try { state.child.kill() } catch { /* already gone */ }
            }
        },
    }
}

// ---------------------------------------------------------------------------
// CPU monitor: LibreHardwareMonitor primary, typeperf "Energy Meter" fallback.
// ---------------------------------------------------------------------------

function createCpuMonitor({ lhmUrl, cpuMs, out, log, onSample }) {
    const state = {
        mode: "lhm", // "lhm" | "typeperf" | "none"
        cachedSensorId: null,
        cachedSensorPath: null,
        sensorAnnounced: false,
        lastLhmSuccessAt: Date.now(),
        lastImplausibleWarnAt: 0,
        typeperfAvailable: null,
        typeperfProbing: false,
        typeperfAnnounced: false,
        noCpuWarned: false,
        stopped: false,
    }
    let tickTimer = null
    let lhmRetryTimer = null

    function reportImplausible(source, watts) {
        const now = Date.now()
        if (now - state.lastImplausibleWarnAt < IMPLAUSIBLE_WARN_INTERVAL_MS) return
        state.lastImplausibleWarnAt = now
        log("warn", `${source} CPU power reading ${watts}W outside the plausible 0.5-400W range; dropped`)
    }

    async function pollLhmOnce() {
        try {
            const response = await fetch(lhmUrl, { signal: AbortSignal.timeout(LHM_TIMEOUT_MS) })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const tree = await response.json()

            let sensor = null
            if (state.cachedSensorId) {
                const node = findNodeBySensorId(tree, state.cachedSensorId)
                if (node) sensor = { path: state.cachedSensorPath, sensorId: node.SensorId, text: node.Text, value: node.Value }
            }
            sensor ??= findCpuPackageSensor(tree)
            if (!sensor) throw new Error("no CPU package sensor found in the LHM tree")

            const watts = parseLhmValue(sensor.value)
            if (watts == null) throw new Error(`unparseable LHM sensor value "${sensor.value}"`)
            if (watts < CPU_WATTS_MIN || watts > CPU_WATTS_MAX) {
                reportImplausible("LHM", watts)
                state.lastLhmSuccessAt = Date.now()
                return true
            }

            state.cachedSensorId = sensor.sensorId
            state.cachedSensorPath = sensor.path
            if (!state.sensorAnnounced) {
                state.sensorAnnounced = true
                log("info", `CPU package sensor: ${sensor.path}${sensor.sensorId ? ` (${sensor.sensorId})` : ""}`)
            }
            writeLine(out, { src: "cpu", watts, sensor: sensor.path, source: "lhm" })
            onSample()
            state.lastLhmSuccessAt = Date.now()
            if (state.mode !== "lhm") {
                state.mode = "lhm"
                log("info", "LHM reachable again; switched CPU source back to lhm")
            }
            return true
        } catch {
            return false
        }
    }

    async function probeTypeperf() {
        if (state.typeperfProbing) return
        state.typeperfProbing = true
        try {
            const result = await runOnce("typeperf", ["-qx", "Energy Meter"], { timeoutMs: TYPEPERF_PROBE_TIMEOUT_MS })
            const combined = `${result.stdout}\n${result.stderr}`
            state.typeperfAvailable = !result.error && !result.timedOut && combined.includes("\\Energy Meter(")
        } catch {
            state.typeperfAvailable = false
        } finally {
            state.typeperfProbing = false
        }
    }

    async function pollTypeperfOnce() {
        try {
            const result = await runOnce("typeperf", ["\\Energy Meter(*)\\Power", "-sc", "1"], { timeoutMs: Math.max(5_000, cpuMs + 3_000) })
            if (result.error || result.timedOut || result.code !== 0) return false
            const watts = parseTypeperfPower(result.stdout)
            if (watts == null) return false
            if (watts < CPU_WATTS_MIN || watts > CPU_WATTS_MAX) {
                reportImplausible("typeperf", watts)
                return true
            }
            writeLine(out, { src: "cpu", watts, sensor: "\\Energy Meter(_Total)\\Power", source: "typeperf" })
            onSample()
            return true
        } catch {
            return false
        }
    }

    function scheduleLhmRetryWhileFallback() {
        if (lhmRetryTimer || state.stopped) return
        lhmRetryTimer = setInterval(() => {
            if (state.stopped || state.mode === "lhm") return
            pollLhmOnce().catch(() => {})
        }, LHM_RETRY_WHILE_FALLBACK_MS)
    }

    async function tick() {
        if (state.stopped) return
        if (state.mode === "lhm") {
            const ok = await pollLhmOnce()
            if (!ok && Date.now() - state.lastLhmSuccessAt >= LHM_UNREACHABLE_THRESHOLD_MS) {
                if (state.typeperfAvailable === null && !state.typeperfProbing) await probeTypeperf()
                if (state.typeperfAvailable === true) {
                    state.mode = "typeperf"
                    if (!state.typeperfAnnounced) {
                        state.typeperfAnnounced = true
                        log("info", "LHM unreachable for 10s; switched CPU source to typeperf Energy Meter")
                    }
                    scheduleLhmRetryWhileFallback()
                } else if (state.typeperfAvailable === false) {
                    if (!state.noCpuWarned) {
                        state.noCpuWarned = true
                        log("warn", "LHM unreachable and no typeperf Energy Meter counters available; emitting no CPU samples")
                    }
                    state.mode = "none"
                    scheduleLhmRetryWhileFallback()
                }
            }
        } else if (state.mode === "typeperf") {
            await pollTypeperfOnce()
        }
        // mode === "none": nothing to poll; the 30s LHM retry timer covers recovery.
    }

    const effectiveIntervalMs = () => (state.mode === "typeperf" ? Math.max(cpuMs, 2_000) : cpuMs)

    function loop() {
        if (state.stopped) return
        tickTimer = setTimeout(() => {
            tick()
                .catch((error) => log("warn", `CPU monitor tick failed: ${error.message}`))
                .finally(loop)
        }, effectiveIntervalMs())
    }
    loop()

    return {
        stop() {
            state.stopped = true
            if (tickTimer) clearTimeout(tickTimer)
            if (lhmRetryTimer) clearInterval(lhmRetryTimer)
        },
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let log = () => {}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    try {
        await mkdir(dirname(args.out), { recursive: true })
    } catch {
        // createWriteStream below will surface anything that actually matters.
    }

    const out = createWriteStream(args.out, { flags: "a" })
    out.on("error", (error) => {
        process.stderr.write(`[energy-logger] output stream error: ${error.message}\n`)
    })

    const counters = { gpuSamples: 0, cpuSamples: 0 }
    log = (level, message) => writeLine(out, { src: "status", level, message })

    log("info", `energy-logger starting: out=${args.out} lhmUrl=${args.lhmUrl} gpuMs=${args.gpuMs} cpuMs=${args.cpuMs} nvidiaSmi=${args.nvidiaSmi}`)

    const gpuMonitor = startGpuMonitor({
        binary: args.nvidiaSmi,
        gpuMs: args.gpuMs,
        out,
        log,
        onSample: () => { counters.gpuSamples++ },
    })
    const cpuMonitor = createCpuMonitor({
        lhmUrl: args.lhmUrl,
        cpuMs: args.cpuMs,
        out,
        log,
        onSample: () => { counters.cpuSamples++ },
    })

    const heartbeatTimer = setInterval(() => {
        writeLine(out, { src: "heartbeat", gpuSamples: counters.gpuSamples, cpuSamples: counters.cpuSamples })
    }, HEARTBEAT_MS)

    let shuttingDown = false
    const shutdown = (signal) => {
        if (shuttingDown) return
        shuttingDown = true
        log("info", `received ${signal}; shutting down`)
        clearInterval(heartbeatTimer)
        cpuMonitor.stop()
        gpuMonitor.stop()
        out.end(() => process.exit(0))
        // Belt and suspenders: don't let a stuck stream hang shutdown forever.
        setTimeout(() => process.exit(0), 2_000).unref()
    }

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))
    if (process.platform === "win32") process.on("SIGBREAK", () => shutdown("SIGBREAK"))

    process.on("uncaughtException", (error) => {
        try { log("warn", `uncaught exception: ${error?.stack ?? error?.message ?? String(error)}`) } catch { /* nothing left to do */ }
    })
    process.on("unhandledRejection", (reason) => {
        try { log("warn", `unhandled rejection: ${reason?.stack ?? reason?.message ?? String(reason)}`) } catch { /* nothing left to do */ }
    })
}

main().catch((error) => {
    process.stderr.write(`[energy-logger] fatal: ${error.stack ?? error.message}\n`)
    process.exit(1)
})
