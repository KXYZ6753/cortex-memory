// TEST runner for one exploration-phase-2 arm (premise2 pre-registration addendum 4; draft:
// docs/premise-study/explore2/PREREG-Q1-DRAFT.md, binding only once it is committed as
// benchmarks/premise2/PREREG-EXPLORE2.md). Modelled on explore/confirm.js (imported, never
// edited); the per-question ctx mirrors explore2/run2.js, so the arm sees exactly the ctx it
// was explored with (same search, resource, chatRaw and generation defaults).
//
//   node benchmarks/premise2/explore2/confirm2.js hash
//        code hash over every file under benchmarks/premise2/explore2/ (fills "Code hash:")
//   node benchmarks/premise2/explore2/confirm2.js check <arm>
//        the pre-registration guards only; reads no TEST data; exit code 1 if TEST would refuse
//   node benchmarks/premise2/explore2/confirm2.js run <arm> [n=600]
//        TEST: the agent's 600 TEST questions (P-B items 0..599, agent-items.json order), the
//        same item list and store layout as addendum 3's confirmation; resumable
//   node benchmarks/premise2/explore2/confirm2.js --dry-run <devSet> [limit=5] [arm=q-det-q1]
//        the same path on a registered EXPLORATION set (never TEST); output under
//        .data/premise2/explore/confirm2-dryrun/
//
// Guard order on `run` (nothing from TEST is read before steps 1-2 pass):
//   1. Pre-registration: PREREG-EXPLORE2.md exists, is tracked, committed and unmodified, and
//      names `Arm: <arm>`, `Verdict key prefix: X-explore2-...|small|<questionKey>` and
//      `Code hash: <sha256>` equal to codeHash2() now. Every file of the arm's import closure
//      (explore2/, explore/, the frozen premise2 modules, src/bm25.js) and everything under
//      benchmarks/premise2/explore2/ is tracked and clean; explore/ still has addendum 3's
//      registered code hash.
//   2. Environment: the arm is an explore2 registry variant; Ollama's version and the e2b
//      digest equal the main run's (explore/run.js preflight); the default generation options
//      equal run-state.json's provenance options (temperature 0, seed 42, num_predict 160...).
//   3. Only then the TEST item list (confirm.js confirmRecords: pools.json + agent-items.json).
//   4. Energy logger (nvidia-smi + LibreHardwareMonitor) and CPU sampler started by this
//      process and verified (GPU samples, LHM package samples, this pid in the sampler's
//      process list) before the model is loaded; stopped (process tree) at the end.
// Dry-run: step 1 is evaluated and recorded in the manifest but not enforced (it would refuse
// until the addendum is committed); the set name may not look like TEST and must be a
// registered exploration development set (not S300-4/5, FULL-2/3, DEMO-*), and every
// question must pass explore/pool.js assertExplorable
// (tuning mailbox; no TEST, retrieval or bridge email, twin or near-duplicate). Steps 2 and 4
// are enforced as on TEST.
//
// Output (TEST: .data/premise2/explore/confirm2/, dry-run: .../confirm2-dryrun/):
//   answers.jsonl   one record per question attempt (explore/run.js ExploreStore semantics)
//   markers.jsonl   load / ps / idle / block markers, as confirm.js (energy-integrate.js format)
//   energy.jsonl    energy-logger.js samples (GPU board power, CPU package power)
//   cpu.jsonl       tools/i-cpusampler.js samples (busy %, CPU seconds per node/ollama/llama-server pid)
//   manifest.jsonl  one session-start and one session-end record per invocation: git HEAD,
//                   PREREG commit and sha256, code hashes, runner / logger / sampler pids,
//                   Ollama build, digest, options, item-list hash, counts, energy check
// Grading and analysis are not part of this file (see docs/premise-study/explore2/p2.md).

import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, statSync } from "node:fs"
import { join, relative, dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { hostname } from "node:os"
import { createHash } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

export const CONFIRM2_VERSION = "premise2-explore2-confirm-v1"
export const PREREG2_PATH = "benchmarks/premise2/PREREG-EXPLORE2.md"
export const PREREG3_PATH = "benchmarks/premise2/PREREG-EXPLORE.md"
export const ALIAS = "small"
export const BLOCK_SIZE = 50
export const IDLE_MS = 30_000
export const DEFAULT_ARM = "q-det-q1"
export const DRY_DEFAULT_LIMIT = 5
const ENERGY_VERIFY_MS = 25_000
// Cell ids for the verdict key prefix in a dry-run (TEST takes it from the addendum).
const DRY_CELLS = { "q-det-q1": "X-explore2-q1", "i-det-x1": "X-explore2-x1", "lite-det-ub": "X-explore2-lite" }

const here = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const posix = (path) => path.split(sep).join("/")
const fromRoot = (abs) => posix(relative(repoRoot, abs))
const iso = () => new Date().toISOString()
const now = () => performance.timeOrigin + performance.now()
const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const normalised = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n")
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean)

// ---- code identity ----

function walk(dir) {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(abs))
        else if (entry.isFile()) out.push(abs)
    }
    return out
}

// sha256 over every file under explore2/ (recursive, sorted by relative path, line endings
// normalised), the same construction as confirm.js codeHash() for explore/.
export function codeHash2() {
    const files = walk(here).map((abs) => [posix(relative(here, abs)), abs]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return sha256(files.map(([name, abs]) => `${name}\n${normalised(abs)}`).join("\n"))
}

// Every local module reachable by static or literal dynamic imports from this file, the
// explore2 registry (which imports every variants/*.js) and the two helper processes.
const IMPORT_RE = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g
export function importClosure() {
    const entries = [
        fileURLToPath(import.meta.url), join(here, "registry.js"),
        ...readdirSync(join(here, "variants")).filter((name) => name.endsWith(".js")).map((name) => join(here, "variants", name)),
        join(here, "..", "energy-logger.js"), join(here, "tools", "i-cpusampler.js"),
    ]
    const seen = new Set()
    const stack = [...entries]
    while (stack.length) {
        const file = stack.pop()
        if (seen.has(file)) continue
        seen.add(file)
        for (const match of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
            const spec = match[1] ?? match[2]
            if (!spec?.startsWith(".")) continue
            const target = resolve(dirname(file), spec)
            if (existsSync(target) && statSync(target).isFile() && target.endsWith(".js")) stack.push(target)
        }
    }
    return [...seen].map(fromRoot).sort()
}

// The pre-registration check. Pure: reads git, the addendum and code files, never TEST data.
export async function preregStatus(arm) {
    const problems = []
    const head = git("rev-parse", "HEAD")
    const codeHash = codeHash2()
    const prereg = { path: PREREG2_PATH, exists: false, tracked: false, commit: null, sha256: null, arm: null, cellId: null, recordedCodeHash: null }
    const preregAbs = join(repoRoot, PREREG2_PATH)
    if (!existsSync(preregAbs)) problems.push(`${PREREG2_PATH} missing: TEST stays closed until addendum 4 is committed`)
    else {
        prereg.exists = true
        const bytes = readFileSync(preregAbs)
        const text = String(bytes)
        prereg.sha256 = sha256(bytes)
        prereg.tracked = git("ls-files", "--", PREREG2_PATH) !== ""
        prereg.commit = git("log", "-1", "--format=%H", "--", PREREG2_PATH) || null
        if (!prereg.tracked || !prereg.commit) problems.push(`${PREREG2_PATH} is not committed`)
        if (git("status", "--porcelain", "--", PREREG2_PATH)) problems.push(`${PREREG2_PATH} has uncommitted changes`)
        prereg.arm = text.match(/^Arm: `([^`]+)`/m)?.[1] ?? null
        if (prereg.arm !== arm) problems.push(`${PREREG2_PATH} names arm ${prereg.arm ?? "(none)"}, not ${arm}`)
        prereg.cellId = text.match(/Verdict key prefix: `(X-explore2-[A-Za-z0-9_-]+)\|small\|<questionKey>`/)?.[1] ?? null
        if (!prereg.cellId) problems.push(`${PREREG2_PATH} has no "Verdict key prefix: \`X-explore2-...|small|<questionKey>\`" line`)
        prereg.recordedCodeHash = text.match(/Code hash: `([0-9a-f]{64})`/)?.[1] ?? null
        if (prereg.recordedCodeHash !== codeHash) problems.push(`explore2 code hash ${codeHash} differs from the pre-registered ${prereg.recordedCodeHash ?? "(not filled)"}`)
    }
    const closure = importClosure()
    const dirty = lines(git("status", "--porcelain", "--untracked-files=all", "--", "benchmarks/premise2/explore2", ...closure))
    if (dirty.length) problems.push(`uncommitted or untracked files in the arm's code (${dirty.length}): ${dirty.slice(0, 6).join("; ")}${dirty.length > 6 ? "; ..." : ""}`)
    const tracked = new Set(lines(git("ls-files", "--", ...closure)))
    const untracked = closure.filter((path) => !tracked.has(path))
    if (untracked.length) problems.push(`import-closure files not tracked by git: ${untracked.slice(0, 6).join(", ")}${untracked.length > 6 ? ", ..." : ""}`)
    const closureHash = sha256(closure.map((path) => `${path}\n${normalised(join(repoRoot, path))}`).join("\n"))
    // explore/ (imported by the arm) must still be addendum 3's frozen code.
    const { codeHash: exploreHash } = await import("../explore/confirm.js")
    const exploreCodeHash = exploreHash()
    const exploreRegistered = existsSync(join(repoRoot, PREREG3_PATH)) ? (readFileSync(join(repoRoot, PREREG3_PATH), "utf8").match(/Code hash: `([0-9a-f]{64})`/)?.[1] ?? null) : null
    if (exploreCodeHash !== exploreRegistered) problems.push(`explore/ code hash ${exploreCodeHash} differs from addendum 3's ${exploreRegistered}`)
    return { ok: problems.length === 0, problems, head, codeHash, prereg, closure: { files: closure.length, hash: closureHash, dirty: dirty.length, untracked: untracked.length }, exploreCodeHash, exploreRegistered }
}

// ---- energy: logger + CPU sampler, started here and verified before any generation ----

function stopTree(child) {
    if (!child?.pid) return
    try {
        if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
        else child.kill("SIGTERM")
    } catch { /* already gone */ }
}

const tailJsonl = (path, sinceT) => {
    if (!existsSync(path)) return []
    return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
        try { const record = JSON.parse(line); return record.t >= sinceT ? [record] : [] } catch { return [] }
    })
}

async function startEnergy({ dir, requireLhm, log }) {
    const energyPath = join(dir, "energy.jsonl")
    const cpuPath = join(dir, "cpu.jsonl")
    const startedAt = now()
    const loggerArgs = [join(here, "..", "energy-logger.js"), "--out", energyPath]
    if (process.env.POC2_LHM_URL) loggerArgs.push("--lhm-url", process.env.POC2_LHM_URL)
    const logger = spawn(process.execPath, loggerArgs, { stdio: "ignore", windowsHide: true })
    const sampler = spawn(process.execPath, [join(here, "tools", "i-cpusampler.js"), "--out", cpuPath], { stdio: "ignore", windowsHide: true })
    const energy = { logger, sampler, loggerPid: logger.pid, samplerPid: sampler.pid, energyPath, cpuPath, startedAt, verified: null }
    const stop = () => { stopTree(logger); stopTree(sampler) }
    const deadline = Date.now() + ENERGY_VERIFY_MS
    let check = null
    while (Date.now() < deadline) {
        await delay(1_000)
        const samples = tailJsonl(energyPath, startedAt)
        const cpuSamples = tailJsonl(cpuPath, startedAt - 2_000)
        const gpu = samples.filter((sample) => sample.src === "gpu").length
        const cpu = samples.filter((sample) => sample.src === "cpu")
        const sources = [...new Set(cpu.map((sample) => sample.source))]
        const runnerSeen = cpuSamples.some((sample) => (sample.procs ?? []).some((p) => p.pid === process.pid))
        check = { gpuSamples: gpu, cpuSamples: cpu.length, cpuSources: sources, cpuSensor: cpu[0]?.sensor ?? null, samplerLines: cpuSamples.length, runnerPidSeen: runnerSeen }
        if (gpu > 0 && cpu.length > 0 && (!requireLhm || sources.includes("lhm")) && runnerSeen) {
            energy.verified = check
            log(`[confirm2] energy verified: logger pid ${logger.pid} (${gpu} GPU, ${cpu.length} CPU samples, ${sources.join("/")}), sampler pid ${sampler.pid} (runner pid ${process.pid} seen)`)
            return { ...energy, stop }
        }
    }
    stop()
    throw new Error(`energy logger / CPU sampler not verified within ${ENERGY_VERIFY_MS / 1000} s: ${JSON.stringify(check)}${requireLhm ? " (LibreHardwareMonitor on port 8085 is required)" : ""}`)
}

// Per-block energy and the runner's own CPU seconds, from this session's files (a check that
// the hooks produced usable data, not the registered analysis).
async function energyCheck({ dir, energy, sessionStart, runnerPid }) {
    const { integrateBlocks, summariseEnergy } = await import("../energy-integrate.js")
    const samples = tailJsonl(energy.energyPath, sessionStart)
    const markers = tailJsonl(join(dir, "markers.jsonl"), sessionStart)
    const blocks = integrateBlocks({ samples, markers })
    const perBlock = {}
    for (const marker of markers) if (marker.kind === "block-end") perBlock[marker.blockId] = marker.answers ?? 0
    const summary = summariseEnergy(blocks, perBlock)
    const cpuSamples = tailJsonl(energy.cpuPath, sessionStart)
    const runnerCpu = cpuSamples.map((sample) => (sample.procs ?? []).find((p) => p.pid === runnerPid)?.cpu).filter((value) => Number.isFinite(value))
    const pidsSeen = {}
    for (const sample of cpuSamples) for (const p of sample.procs ?? []) pidsSeen[p.name] = (pidsSeen[p.name] ?? new Set()).add(p.pid)
    return {
        samples: { gpu: samples.filter((s) => s.src === "gpu").length, cpu: samples.filter((s) => s.src === "cpu").length, status: samples.filter((s) => s.src === "status").map((s) => s.message).slice(-5) },
        blocks: blocks.map((block) => ({ blockId: block.blockId, kind: block.kind, seconds: block.seconds, gpuMeanW: block.gpuMeanW, cpuMeanW: block.cpuMeanW, totalJ: block.totalJ, marginalJ: block.marginalJ ?? null })),
        byModelCell: summary.byModelCell,
        sampler: { lines: cpuSamples.length, runnerPid, runnerCpuSeconds: runnerCpu.length > 1 ? Number((runnerCpu.at(-1) - runnerCpu[0]).toFixed(2)) : null, processes: Object.fromEntries(Object.entries(pidsSeen).map(([name, set]) => [name, [...set]])) },
    }
}

// ---- items ----

// A dry-run may only use a registered exploration set, every question of which passes the
// exploration TEST guard. Names that look like TEST or an item file are refused outright.
function assertDrySetName(setName) {
    if (!setName) throw new Error("--dry-run needs an exploration set name (e.g. S100-0)")
    if (/test|agent-items|pools|items|confirm|\.json|[\\/]/i.test(setName)) throw new Error(`dry-run refuses "${setName}": TEST or an item file, not an exploration set name`)
    if (!/^(S100|S300|FULL)-\d+$/.test(setName)) throw new Error(`dry-run refuses "${setName}": only registered exploration sets (S100-n, S300-n, FULL-n)`)
    if (RESERVED_SETS.has(setName)) throw new Error(`dry-run refuses "${setName}": a round-5 decision or confirmation set, not a development set`)
}
// Round 5's fresh sets (journal, Round 5): decision sets and lead-only confirmation sets.
const RESERVED_SETS = new Set(["S300-4", "S300-5", "FULL-2", "FULL-3"])

async function dryRecords({ dataDir, setName, limit }) {
    assertDrySetName(setName)
    const { loadPool, loadGuard, assertExplorable } = await import("../explore/pool.js")
    const { loadSet, loadRegistry } = await import("../explore/sets.js")
    const registry = loadRegistry(dataDir)
    if (!registry.sets.some((entry) => (entry.name ?? entry) === setName)) throw new Error(`dry-run refuses "${setName}": not in the exploration set registry`)
    const pool = loadPool(dataDir)
    const set = loadSet(dataDir, setName, pool)
    const guard = loadGuard(dataDir)
    const records = set.questionKeys.map((key) => pool.byKey.get(key))
    if (records.some((record) => !record)) throw new Error(`set ${setName} has questions outside the exploration pool`)
    for (const record of records) assertExplorable(record, guard)   // tuning mailbox, no TEST email, twin or near-duplicate
    return { records: records.slice(0, limit), setHash: set.hash, total: records.length }
}

// ---- the run ----

export const confirm2Key = ({ mode, digest, arm, version, questionKey }) => sha256(`${CONFIRM2_VERSION}|${mode}|${digest}|${arm}@${version}|${questionKey}`)

export async function runConfirm2({ mode, arm = DEFAULT_ARM, dataDir, n = 600, setName = null, limit = DRY_DEFAULT_LIMIT, ollamaUrl = "http://localhost:11434", log = console.log }) {
    if (mode !== "test" && mode !== "dry-run") throw new Error(`mode ${mode}`)
    if (mode === "dry-run") assertDrySetName(setName)          // before anything is read
    // 1. pre-registration (enforced on TEST, recorded on a dry-run)
    const guard = await preregStatus(arm)
    if (mode === "test" && !guard.ok) throw new Error(`TEST refused before any TEST data was read:\n  - ${guard.problems.join("\n  - ")}`)
    if (mode === "dry-run") log(`[confirm2] dry-run: pre-registration check reported, not enforced; on TEST it would ${guard.ok ? "PASS" : `REFUSE:\n  - ${guard.problems.join("\n  - ")}`}`)
    const cellId = mode === "test" ? guard.prereg.cellId : `DRY-${guard.prereg.cellId ?? DRY_CELLS[arm] ?? `X-explore2-${arm}`}`

    // 2. environment: registry arm, Ollama build and digest, generation options
    const { loadVariants } = await import("./registry.js")
    const { preflight, ExploreStore } = await import("../explore/run.js")
    const { exploreDirOf } = await import("../explore/pool.js")
    const { NUM_PREDICT } = await import("../explore/variants.js")
    const { chat, generationOptions, version, ps, unload, load } = await import("../ollama.js")
    const VARIANTS = await loadVariants()
    const variant = VARIANTS[arm]
    if (!variant) throw new Error(`unknown arm ${arm}`)
    if (!variant.file) throw new Error(`${arm} is a frozen explore/ variant; this runner is for explore2 arms`)
    const runState = JSON.parse(readFileSync(join(dataDir, "run-state.json"), "utf8"))
    const main = runState.provenance
    const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias: ALIAS, ollamaUrl })
    const options = generationOptions({ num_predict: NUM_PREDICT })
    const sorted = (object) => JSON.stringify(Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1))))
    if (sorted(options) !== sorted(main.options)) throw new Error(`generation options ${sorted(options)} differ from the main run's ${sorted(main.options)}`)
    const armVersion = `${variant.version}`

    // 3. items (TEST data only from here on, and only in mode "test")
    let items
    if (mode === "test") {
        const { confirmRecords } = await import("../explore/confirm.js")
        const records = confirmRecords(dataDir, n)
        if (records.length !== n) throw new Error(`expected ${n} TEST questions, got ${records.length}`)
        items = { records, setName: "TEST-agent-items", setHash: sha256(JSON.stringify(records.map((record) => record.questionKey))), total: records.length }
    } else {
        items = { ...(await dryRecords({ dataDir, setName, limit })), setName }
    }
    const dir = join(exploreDirOf(dataDir), mode === "test" ? "confirm2" : "confirm2-dryrun")
    mkdirSync(dir, { recursive: true })
    const store = new ExploreStore(join(dir, "answers.jsonl"))
    const keyOf = (record) => confirm2Key({ mode, digest, arm, version: armVersion, questionKey: record.questionKey })
    const pending = items.records.filter((record) => !store.done(keyOf(record)))
    const sessionStart = now()
    const sessionId = `${arm}:${mode}:${iso()}`
    const manifestPath = join(dir, "manifest.jsonl")
    const manifest = (record) => appendFileSync(manifestPath, JSON.stringify({ session: sessionId, at: iso(), ...record }) + "\n")
    const start = {
        kind: "session-start", mode, arm, armVersion, armFile: variant.file, describe: variant.describe, cellId, verdictKeyPrefix: `${cellId}|${ALIAS}|<questionKey>`,
        confirmVersion: CONFIRM2_VERSION, git: { head: guard.head, preregCommit: guard.prereg.commit }, prereg: guard.prereg, preregOk: guard.ok, preregProblems: guard.problems,
        codeHash: guard.codeHash, closure: guard.closure, exploreCodeHash: guard.exploreCodeHash, exploreRegistered: guard.exploreRegistered,
        runnerPid: process.pid, node: process.version, host: hostname(), cwd: process.cwd(), ollamaUrl, ollamaVersion, tag, digest, options,
        items: { set: items.setName, setHash: items.setHash, total: items.total, run: items.records.length, pending: pending.length },
    }
    log(`[confirm2] ${mode} ${arm}@${armVersion} (${cellId}) on ${items.setName}: ${pending.length} pending of ${items.records.length}; HEAD ${guard.head.slice(0, 10)}, code ${guard.codeHash.slice(0, 12)}, runner pid ${process.pid}`)
    if (!pending.length) { manifest({ ...start, note: "nothing pending" }); return { pending: 0, dir } }

    // 4. the GPU lock (as cli2 run), energy, model load, idle baseline, blocks
    const { withLock } = await import("./lock.js")
    return withLock(dataDir, `confirm2 ${mode} ${arm} ${items.setName}`, async () => {
        const { openBm25 } = await import("../bm25.js")
        const { ensureEmailStore } = await import("../agent-run.js")
        const { startWakeLock } = await import("../run.js")
        const { embedBatch, QUERY_PREFIX } = await import("../dense.js")
        const energy = await startEnergy({ dir, requireLhm: mode === "test", log })
        manifest({ ...start, energy: { loggerPid: energy.loggerPid, samplerPid: energy.samplerPid, energyPath: energy.energyPath, cpuPath: energy.cpuPath, verified: energy.verified } })
        const markersPath = join(dir, "markers.jsonl")
        const marker = (kind, extra = {}) => appendFileSync(markersPath, JSON.stringify({ t: now(), at: iso(), kind, model: ALIAS, cell: cellId, session: sessionId, ...extra }) + "\n")
        const resources = new Map()
        let emails = null
        let bm25 = null
        let wakeLock = null
        let done = 0
        let wallSum = 0
        const statuses = {}
        try {
            emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
            bm25 = openBm25(join(dataDir, "corpus.sqlite"))
            wakeLock = startWakeLock(log)
            // Fresh load, two warm-up calls, then a 30 s idle baseline with the model resident.
            for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
            marker("load-start")
            const loaded = await load(ollamaUrl, tag)
            marker("load-end", loaded)
            if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status}`)
            for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
            marker("ps", { snapshot: (await ps(ollamaUrl)).map((model) => ({ name: model.name, size: model.size, sizeVram: model.size_vram, contextLength: model.context_length })) })
            const idleId = `idle:${ALIAS}:${iso()}`
            marker("idle-start", { blockId: idleId })
            await delay(IDLE_MS)
            marker("idle-end", { blockId: idleId })
            for (let first = 0; first < pending.length; first += BLOCK_SIZE) {
                const block = pending.slice(first, first + BLOCK_SIZE)
                const blockId = `${cellId}:${ALIAS}:${iso()}`
                if ((await version(ollamaUrl)) !== ollamaVersion) throw new Error(`Ollama version changed from ${ollamaVersion} during the run`)
                marker("block-start", { blockId })
                for (const record of block) {
                    const tally = { calls: 0, genMs: 0, promptTokens: 0, outputTokens: 0, maxLoadMs: 0, searchMs: 0, searches: 0, auxMs: 0, statuses: [] }
                    // explore2/run2.js's ctx, unchanged
                    const ctx = {
                        alias: ALIAS, tag, dataDir, ollamaUrl, bm25,
                        emailOf: emails.emailOf,
                        emailMap: { get: emails.emailOf },
                        search: async (query, k, user = null) => {
                            const started = performance.now()
                            const paths = bm25.search(query, k, user).map((hit) => hit.path)
                            tally.searchMs += performance.now() - started
                            tally.searches++
                            return paths
                        },
                        resource: async (name, loader) => {
                            if (!resources.has(name)) resources.set(name, await loader())
                            return resources.get(name)
                        },
                        embedQuery: async (text) => {
                            const started = performance.now()
                            const [vector] = await embedBatch([`${QUERY_PREFIX}${text}`], { ollamaUrl, options: { num_gpu: 0 } })
                            tally.auxMs += performance.now() - started
                            return vector
                        },
                        chatRaw: async (body) => {
                            const started = performance.now()
                            const response = await fetch(`${ollamaUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: tag, stream: false, think: false, keep_alive: "60m", options: generationOptions({ num_predict: NUM_PREDICT }), ...body }) })
                            const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
                            tally.calls++
                            tally.genMs += Math.round(performance.now() - started)
                            tally.promptTokens += data.prompt_eval_count ?? 0
                            tally.outputTokens += data.eval_count ?? 0
                            tally.statuses.push(data.error ? "http_error" : "ok")
                            return data
                        },
                        generate: async ({ prompt, messages, options: override, think = false }) => {
                            const result = await chat({ url: ollamaUrl, model: tag, prompt, messages, options: override ?? generationOptions({ num_predict: NUM_PREDICT }), think })
                            tally.calls++
                            tally.genMs += result.wallMs ?? 0
                            tally.promptTokens += result.promptEvalCount ?? 0
                            tally.outputTokens += result.evalCount ?? 0
                            tally.maxLoadMs = Math.max(tally.maxLoadMs, result.loadMs ?? 0)
                            tally.statuses.push(result.status)
                            return result
                        },
                    }
                    const started = performance.now()
                    let result
                    try {
                        result = await variant.run(ctx, record)
                    } catch (error) {
                        result = { status: "http_error", answer: "", error: String(error.message).slice(0, 300) }
                    }
                    const wallMs = Math.round(performance.now() - started)
                    store.add({
                        key: keyOf(record), arm, variant: arm, version: armVersion, confirmVersion: CONFIRM2_VERSION, mode, cell: cellId, session: sessionId,
                        alias: ALIAS, digest, set: items.setName, questionKey: record.questionKey, stratum: record.stratum ?? null, user: record.user, blockId, wallMs,
                        ...tally, searchMs: Math.round(tally.searchMs), auxMs: Math.round(tally.auxMs), reloaded: tally.maxLoadMs > 1_000, ollamaVersion, at: iso(), ...result,
                    })
                    done++
                    wallSum += wallMs
                    statuses[result.status] = (statuses[result.status] ?? 0) + 1
                }
                marker("block-end", { blockId, answers: block.length })
                log(`[confirm2] ${Math.min(first + BLOCK_SIZE, pending.length)}/${pending.length} (mean ${Math.round(wallSum / Math.max(done, 1))} ms)`)
            }
        } finally {
            wakeLock?.kill()
            bm25?.close()
            emails?.close()
            for (const resource of resources.values()) resource?.close?.()
            await delay(1_500)                                   // let the logger and sampler cover the last block
            energy.stop()
            let check = null
            try { check = await energyCheck({ dir, energy, sessionStart, runnerPid: process.pid }) } catch (error) { check = { error: error.message } }
            manifest({ kind: "session-end", mode, arm, runnerPid: process.pid, loggerPid: energy.loggerPid, samplerPid: energy.samplerPid, answered: done, statuses, meanWallMs: done ? Math.round(wallSum / done) : null, energyCheck: check })
            log(`[confirm2] session end: ${done} answered ${JSON.stringify(statuses)}; energy ${JSON.stringify(check?.samples ?? check)}; runner CPU ${check?.sampler?.runnerCpuSeconds ?? "?"} s`)
        }
        return { pending: pending.length, answered: done, dir }
    }, { log })
}

// ---- CLI ----

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
    const args = process.argv.slice(2)
    try {
        if (args[0] === "hash") console.log(codeHash2())
        else if (args[0] === "check") {
            const status = await preregStatus(args[1] ?? DEFAULT_ARM)
            console.log(JSON.stringify(status, null, 2))
            if (!status.ok) process.exitCode = 1
        } else if (args[0] === "run") {
            if (!args[1]) throw new Error("usage: confirm2.js run <arm> [n]")
            await runConfirm2({ mode: "test", arm: args[1], dataDir, n: args[2] ? Number(args[2]) : 600 })
        } else if (args[0] === "--dry-run") {
            await runConfirm2({ mode: "dry-run", setName: args[1], limit: args[2] ? Number(args[2]) : DRY_DEFAULT_LIMIT, arm: args[3] ?? DEFAULT_ARM, dataDir })
        } else throw new Error("usage: confirm2.js hash | check <arm> | run <arm> [n] | --dry-run <devSet> [limit] [arm]")
    } catch (error) {
        console.error(error?.message ?? error)
        process.exitCode = 1
    }
}
