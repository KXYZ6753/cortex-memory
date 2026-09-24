// One Windows GPU owner, crash restart, energy logging, and hard cutoff.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import { hostname } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { appendJsonl, writeJsonAtomic } from "./store.js"
import { startWakeLock } from "./run.js"
import { agentOverlapDir, overlapStatus, OVERLAP_CUTOFF } from "./agent-overlap.js"

export async function agentOverlapController({ dataDir, log = console.log }) {
    const dir = agentOverlapDir(dataDir)
    mkdirSync(dir, { recursive: true })
    if (process.platform === "win32") {
        const script = "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'benchmarks[\\\\/]premise2[\\\\/]cli\\.js\\s+(agent|agent-once|agent-overlap|agent-overlap-once|run|run-once|simple-once|overnight)(?:\\s|$)' } | Select-Object -ExpandProperty ProcessId"
        const running = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000 }).trim().split(/\s+/).filter((pid) => pid && Number(pid) !== process.pid).join(", ")
        if (running) throw new Error(`another premise2 generator is running (PID ${running.replace(/\s+/g, ", ")})`)
    }
    const lockPath = join(dataDir, "generation-owner.json")
    if (existsSync(lockPath)) {
        const owner = JSON.parse(readFileSync(lockPath, "utf8"))
        let alive = owner.host !== hostname()
        if (!alive) try { process.kill(owner.pid, 0); alive = true } catch { /* stale */ }
        if (alive) throw new Error(`another generation controller owns ${lockPath}`)
        unlinkSync(lockPath)
    }
    const fd = openSync(lockPath, "wx")
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }) + "\n")
    closeSync(fd)
    const wake = startWakeLock(log)
    let energy = null
    const energyError = (reason) => {
        log(`[agent-overlap] energy logger unavailable: ${reason}`)
        appendJsonl(join(dir, "markers.jsonl"), { kind: "energy-logger-error", at: new Date().toISOString(), reason })
    }
    if (process.env.POC2_ENERGY !== "off") {
        energy = spawn(process.execPath, [fileURLToPath(new URL("./energy-logger.js", import.meta.url)), "--out", join(dir, "energy.jsonl"), ...(process.env.POC2_LHM_URL ? ["--lhm-url", process.env.POC2_LHM_URL] : [])], { stdio: "ignore", windowsHide: true })
        energy.on("error", (error) => energyError(error.message))
        energy.on("exit", (code) => { if (code) energyError(`exit ${code}`) })
    }
    try {
        let failed = 0
        const cutoff = new Date(OVERLAP_CUTOFF).getTime()
        while (Date.now() < cutoff && overlapStatus({ dataDir, quiet: true }).next) {
            const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "agent-overlap-once"], { stdio: "inherit", windowsHide: true, env: { ...process.env, POC2_DATA_DIR: dataDir, POC2_STOP_AT: OVERLAP_CUTOFF, POC2_AGENT_OVERLAP_CHILD: "1" } })
            const timer = setTimeout(() => {
                log("[agent-overlap] cutoff reached; terminating generator")
                if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
                else child.kill("SIGTERM")
            }, Math.max(1, cutoff - Date.now()))
            const code = await new Promise((resolve) => { child.on("exit", resolve); child.on("error", () => resolve(1)) })
            clearTimeout(timer)
            if (!overlapStatus({ dataDir, quiet: true }).next) break
            if (++failed >= 3) { log(`[agent-overlap] incomplete after ${failed} child exits (last ${code}); rerun the command to resume`); break }
            log(`[agent-overlap] child exited ${code}; resuming in 30 s`)
            await delay(Math.min(30_000, Math.max(1, cutoff - Date.now())))
        }
        if (Date.now() >= cutoff) {
            const statePath = join(dir, "state.json")
            const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
            state.active = null
            state.lastStop = { at: new Date().toISOString(), reason: "time", next: overlapStatus({ dataDir, quiet: true }).next }
            writeJsonAtomic(statePath, state)
        }
        return overlapStatus({ dataDir, log })
    } finally {
        energy?.kill()
        wake?.kill()
        try { const owner = JSON.parse(readFileSync(lockPath, "utf8")); if (owner.pid === process.pid && owner.host === hostname()) unlinkSync(lockPath) } catch { /* gone */ }
    }
}
