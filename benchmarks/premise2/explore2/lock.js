// Machine-wide locks so parallel workers never share the GPU (or append to the shared
// stores at the same time). Exclusive-create of a lock file; a lock whose holder is
// gone is taken over. Waiters queue with ticket files and are served in order of
// (priority, arrival): the lead uses priority 0 (EXPLORE_PRIORITY=0), workers 5.
// Named locks: "gpu" (generation runs) and "grade" (J1 grading, no GPU).

import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export const lockPathOf = (dataDir, name = "gpu") => join(dataDir, "explore", `${name}.lock`)
const queueDirOf = (dataDir, name) => join(dataDir, "explore", `${name}.queue`)

const alive = (pid) => {
    try { process.kill(pid, 0); return true } catch (error) { return error.code === "EPERM" }
}

export async function withLock(dataDir, label, task, { log = console.log, pollMs = 2000, name = "gpu", priority = Number(process.env.EXPLORE_PRIORITY ?? 5) } = {}) {
    const path = lockPathOf(dataDir, name)
    const queueDir = queueDirOf(dataDir, name)
    mkdirSync(queueDir, { recursive: true })
    const ticket = `${String(priority).padStart(2, "0")}-${String(Date.now()).padStart(15, "0")}-${process.pid}`
    const ticketPath = join(queueDir, ticket)
    writeFileSync(ticketPath, label)
    const dropTicket = () => { try { unlinkSync(ticketPath) } catch {} }
    process.once("exit", dropTicket)
    let waited = false
    try {
        for (;;) {
            // Only the first live ticket in the queue may take the lock.
            const tickets = readdirSync(queueDir).sort().filter((name) => {
                const pid = Number(name.split("-")[2])
                if (alive(pid)) return true
                try { unlinkSync(join(queueDir, name)) } catch {}
                return false
            })
            if (tickets[0] === ticket) {
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
                }
            }
            if (!waited) { log(`[lock:${name}] queued (${tickets.indexOf(ticket)} ahead)`); waited = true }
            await delay(pollMs)
        }
    } finally {
        dropTicket()
    }
    const release = () => { try { if (JSON.parse(readFileSync(path, "utf8")).pid === process.pid) unlinkSync(path) } catch {} }
    process.once("exit", release)
    try { return await task() } finally { release() }
}

export const lockHolder = (dataDir, name = "gpu") => (existsSync(lockPathOf(dataDir, name)) ? readFileSync(lockPathOf(dataDir, name), "utf8") : null)
