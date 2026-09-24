// One GPU owner, staged checkpoints, and a hard Eastern-local finish time.
// Run from the Windows checkout after simple-prepare has been copied over.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import { hostname } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { simpleDirOf, simpleStatus } from "./simple.js"
import { appendJsonl, writeJsonAtomic } from "./store.js"
import { startWakeLock } from "./run.js"
import { agentDirOf, armOptions, armKey, newIndexOf } from "./agent-run.js"
import { agentQueue } from "./cells.js"
import { readJsonl } from "./store.js"

export const AGENT_CUTOFF = "2026-09-24T12:00:00-04:00"
export const GENERATION_CUTOFF = "2026-09-24T18:00:00-04:00"
export const REPORT_CUTOFF = "2026-09-24T19:00:00-04:00"
export const PHASE_ORDER = ["small600", "mid600", "large200", "agent", "large600", "small955", "mid955"]
const here = fileURLToPath(new URL(".", import.meta.url))
const cli = join(here, "cli.js")
const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const deadlineFor = (phase) => phase === "agent" ? AGENT_CUTOFF : GENERATION_CUTOFF

export function phaseComplete(phase, { dataDir }) {
    if (phase === "agent") {
        const dir = agentDirOf(dataDir)
        const path = join(dir, "state.json")
        if (!existsSync(path)) return false
        const state = read(path)
        const items = read(new URL("./agent-items.json", import.meta.url)).items
        const records = read(join(dataDir, "pools.json")).test
        const recordOf = new Map(records.map((record) => [record.questionKey, record]))
        const done = new Set(readJsonl(join(dir, "answers.jsonl")).records.filter((row) => row.type === "answer" && ["ok", "output_limit", "empty"].includes(row.status)).map((row) => row.key))
        return agentQueue(state.provenance?.newIndex ?? newIndexOf()).every((arm) => {
            const digest = state.provenance?.digests?.[arm.alias]
            if (!digest) return false
            const { optsHash } = armOptions(arm, state.provenance?.numPredict ?? 160)
            const selected = arm.maxItems ? items.slice(0, arm.maxItems) : items
            return selected.every((item) => {
                const key = armKey(arm, recordOf.get(item.questionKey), digest, optsHash)
                return key && done.has(key)
            })
        })
    }
    const arm = simpleStatus({ dataDir, quiet: true }).arms[phase]
    return arm.done === arm.target
}

async function childPhase({ phase, dataDir, ollamaUrl, log }) {
    const stopAt = deadlineFor(phase)
    const stage = phase === "agent" ? "agent" : "simple-once"
    const args = phase === "agent" ? [cli, stage] : [cli, stage, phase]
    const child = spawn(process.execPath, args, {
        cwd: process.cwd(), stdio: "inherit", windowsHide: true,
        env: { ...process.env, POC2_DATA_DIR: dataDir, POC2_STOP_AT: stopAt, OLLAMA_URL: ollamaUrl },
    })
    let energy = null
    if (phase !== "agent" && process.env.POC2_ENERGY !== "off") {
        energy = spawn(process.execPath, [join(here, "energy-logger.js"), "--out", join(simpleDirOf(dataDir), "energy.jsonl"), ...(process.env.POC2_LHM_URL ? ["--lhm-url", process.env.POC2_LHM_URL] : [])], { stdio: "ignore", windowsHide: true })
        const recordEnergyFailure = (reason) => {
            log(`[overnight] energy logger unavailable: ${reason}`)
            appendJsonl(join(simpleDirOf(dataDir), "markers.jsonl"), { kind: "energy-logger-error", phase, at: new Date().toISOString(), reason })
        }
        energy.on("error", (error) => recordEnergyFailure(error.message))
        energy.on("exit", (code) => { if (code && code !== 0) recordEnergyFailure(`exit ${code}`) })
    }
    const cutoffMs = new Date(stopAt).getTime()
    const timer = setTimeout(() => {
        log(`[overnight] ${phase} reached its cutoff; stopping process tree`)
        if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
        else child.kill("SIGTERM")
    }, Math.max(1, cutoffMs - Date.now()) + 60_000)
    try {
        return await new Promise((resolve) => {
            child.on("exit", (code, signal) => resolve({ code, signal }))
            child.on("error", (error) => resolve({ code: 1, error: error.message }))
        })
    } finally {
        clearTimeout(timer)
        energy?.kill()
    }
}

export async function overnight({ dataDir, ollamaUrl = "http://localhost:11434", log = console.log }) {
    // This state is informational; completion always comes from the answer store or
    // the agent's own frozen queue state, never from a child's exit code.
    const dir = simpleDirOf(dataDir)
    mkdirSync(dir, { recursive: true })
    if (process.platform === "win32") {
        const script = "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'benchmarks[\\\\/]premise2[\\\\/]cli\\.js\\s+(agent|run|simple-once)' } | Select-Object -ExpandProperty ProcessId"
        const existing = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000 }).trim()
        if (existing) throw new Error(`another premise2 generator is running (PID ${existing.replace(/\s+/g, ", ")}); stop it before overnight`)
    }
    const lockPath = join(dataDir, "generation-owner.json")
    if (existsSync(lockPath)) {
        const owner = read(lockPath)
        let alive = owner.host !== hostname()
        if (!alive) try { process.kill(owner.pid, 0); alive = true } catch { /* stale lock */ }
        if (alive) throw new Error(`another generation controller owns ${lockPath}; stop it before starting overnight`)
        unlinkSync(lockPath)
    }
    const lockFd = openSync(lockPath, "wx")
    const owner = { pid: process.pid, host: hostname(), at: new Date().toISOString() }
    writeFileSync(lockFd, JSON.stringify(owner) + "\n")
    closeSync(lockFd)
    const wakeLock = startWakeLock(log)
    const statePath = join(dir, "overnight-state.json")
    const state = existsSync(statePath) ? read(statePath) : { startedAt: new Date().toISOString(), phases: {} }
    try {
    for (const phase of PHASE_ORDER) {
        if (phaseComplete(phase, { dataDir })) {
            log(`[overnight] ${phase} already complete; skipping`)
            continue
        }
        if (Date.now() >= new Date(deadlineFor(phase)).getTime()) {
            log(`[overnight] ${phase} deadline passed; preserving partial results and continuing`)
            continue
        }
        state.active = phase
        state.updatedAt = new Date().toISOString()
        writeJsonAtomic(statePath, state)
        let failures = 0
        while (!phaseComplete(phase, { dataDir }) && Date.now() < new Date(deadlineFor(phase)).getTime()) {
            const result = await childPhase({ phase, dataDir, ollamaUrl, log })
            if (phaseComplete(phase, { dataDir })) break
            failures++
            state.phases[phase] = { at: new Date().toISOString(), failures, lastExit: result }
            writeJsonAtomic(statePath, state)
            if (failures >= 3) {
                log(`[overnight] ${phase} stopped after three incomplete child exits; moving to the next independent checkpoint`)
                break
            }
            log(`[overnight] ${phase} incomplete after child exit; resuming in 60 s`)
            await delay(60_000)
        }
        state.phases[phase] = { ...state.phases[phase], at: new Date().toISOString(), complete: phaseComplete(phase, { dataDir }) }
        writeJsonAtomic(statePath, state)
    }
    state.active = null
    state.finishedAt = new Date().toISOString()
    writeJsonAtomic(statePath, state)
    log("[overnight] generation queue stopped; copy a snapshot for grading and reporting")
    return state
    } finally {
        wakeLock?.kill()
        try { if (read(lockPath).pid === process.pid && read(lockPath).host === hostname()) unlinkSync(lockPath) } catch { /* already removed */ }
    }
}

export function overnightStatus({ dataDir, log = console.log }) {
    const dir = simpleDirOf(dataDir)
    const path = join(dir, "overnight-state.json")
    const state = existsSync(path) ? read(path) : null
    log(`[overnight-status] active ${state?.active ?? "none"}; next ${PHASE_ORDER.find((phase) => !phaseComplete(phase, { dataDir })) ?? "none"}; cutoff ${GENERATION_CUTOFF}`)
    simpleStatus({ dataDir, log })
    return state
}
