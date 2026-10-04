// A machine-wide lock so parallel workers never share the GPU (or append to the
// shared answer/verdict stores at the same time). Exclusive-create of a lock file;
// a lock whose holder process is gone is taken over.

import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export const lockPathOf = (dataDir) => join(dataDir, "explore", "gpu.lock")

const alive = (pid) => {
    try { process.kill(pid, 0); return true } catch (error) { return error.code === "EPERM" }
}

export async function withLock(dataDir, label, task, { log = console.log, pollMs = 3000 } = {}) {
    const path = lockPathOf(dataDir)
    let waited = false
    for (;;) {
        try {
            const fd = openSync(path, "wx")
            writeSync(fd, JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() }))
            closeSync(fd)
            break
        } catch (error) {
            if (error.code !== "EEXIST") throw error
            let holder = null
            try { holder = JSON.parse(readFileSync(path, "utf8")) } catch {}
            if (holder && !alive(holder.pid)) { try { unlinkSync(path) } catch {} ; continue }
            if (!waited) { log(`[lock] waiting for ${holder?.label ?? "?"} (pid ${holder?.pid ?? "?"})`); waited = true }
            await delay(pollMs)
        }
    }
    const release = () => { try { if (JSON.parse(readFileSync(path, "utf8")).pid === process.pid) unlinkSync(path) } catch {} }
    process.once("exit", release)
    try { return await task() } finally { release() }
}

export const lockHolder = (dataDir) => (existsSync(lockPathOf(dataDir)) ? readFileSync(lockPathOf(dataDir), "utf8") : null)
