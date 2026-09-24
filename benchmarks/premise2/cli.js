// premise2 command line.
//
//   Mac (generation-free):   npm run premise2 -- embed      build the dense index
//                            npm run premise2 -- prepare    pools, retrieval, contexts, prompts
//   Windows (one command):   npm run premise2 -- run        supervised continuous run
//   Either:                  npm run premise2 -- status     progress per cell and model
//                            npm run premise2 -- verify-data
//
// Settings come from .env or the environment (see benchmarks/premise2/README.md):
//   POC2_DATA_DIR   data directory (default .data/premise2)
//   POC2_STOP_AT    ISO time by which the run must stop (e.g. 2026-09-23T18:00)
//   OLLAMA_URL      default http://localhost:11434
//   POC2_ENERGY     "off" disables the energy logger
//   POC2_LHM_URL    LibreHardwareMonitor data.json URL

import { existsSync, mkdirSync, readFileSync, createReadStream } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"

try {
    process.loadEnvFile()
} catch {
    // No .env is fine.
}

const stage = process.argv[2]
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const ollamaUrl = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/+$/, "")
const log = (message) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`)
const USAGE = "Usage: npm run premise2 -- embed | prepare | run | run-once | latency | grade | report | status | verify-data | agent-prepare | agent | agent-once | agent-status | agent-grade | index-build | index-eval | simple-prepare | simple-once <phase> | simple-status | simple-grade | simple-report | overnight | overnight-status"

async function main() {
    if (stage === "embed") {
        const { loadRaw, buildCorpus } = await import("./dataset.js")
        const { buildDenseIndex, writeJson } = await import("./dense.js")
        const raw = await loadRaw(join(dataDir, "hf"))
        const { docs } = buildCorpus(raw.corpus)
        writeJson(join(dataDir, "dense-docs.json"), { model: "nomic-embed-text", count: docs.length, paths: docs.map((doc) => doc.path), users: docs.map((doc) => doc.user) })
        let last = 0
        await buildDenseIndex(docs, join(dataDir, "dense.f32"), {
            textOf: (doc) => doc.email,
            batchSize: 64,
            ollamaUrl,
            onProgress: (done, total, seconds) => {
                if (done - last >= 4096 || done === total) {
                    last = done
                    log(`[embed] ${done}/${total} (${(done / total * 100).toFixed(1)}%), eta ${Math.round(seconds / done * (total - done) / 60)} min`)
                }
            },
        })
        log("[embed] complete")
        return
    }
    if (stage === "prepare") {
        const { prepare } = await import("./prepare.js")
        await prepare({ dataDir, log })
        return
    }
    if (stage === "run-once") {
        // Exit codes for the supervisor: 0 finished or stopped by the clock, 3 E* not
        // selectable yet, 1 crash. process.exit also abandons any in-flight DEV judge
        // call (verdicts are appended synchronously, so nothing is lost).
        const { run } = await import("./run.js")
        const result = await run({ dataDir, stopAt: process.env.POC2_STOP_AT, ollamaUrl, log })
        process.exit(result?.reason === "complete" || result?.reason === "time" ? 0 : result?.reason === "no-estar" ? 3 : 1)
    }
    const loadCorpus = async () => {
        const { loadRaw } = await import("./dataset.js")
        const { EvidenceCache } = await import("./evidence.js")
        const raw = await loadRaw(join(dataDir, "hf"))
        const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
        return { emailByPath, evidence: new EvidenceCache(emailByPath) }
    }
    if (stage === "grade") {
        const { grade } = await import("./grade.js")
        const summary = await grade({ dataDir, ollamaUrl, log, stopAt: process.env.POC2_STOP_AT, loadCorpus })
        log(`[grade] ${JSON.stringify(summary)}`)
        if (summary.paused) log("[grade] a judge hit a usage limit; rerun `npm run premise2 -- grade` later to finish (nothing is re-judged)")
        return
    }
    if (stage === "report") {
        const { report } = await import("./report.js")
        await report({ dataDir, log, outDir: process.env.POC2_REPORT_DIR ?? "benchmarks/results/premise2", loadCorpus })
        return
    }
    if (stage === "latency") {
        const { measureLatency } = await import("./latency.js")
        await measureLatency({ dataDir, ollamaUrl, log, n: Number(process.env.POC2_LATENCY_N ?? (process.env.POC2_SMOKE_MODEL ? 10 : 100)) })
        return
    }
    if (stage === "index-build") {
        const { loadRaw, buildCorpus } = await import("./dataset.js")
        const { buildAllVariants } = await import("./indexes.js")
        const raw = await loadRaw(join(dataDir, "hf"))
        const { docs } = buildCorpus(raw.corpus)
        buildAllVariants(docs, dataDir, log)
        log("[index] all variant indexes present")
        return
    }
    if (stage === "index-eval") {
        const { evaluateIndexes, writeIndexEval } = await import("./indexes.js")
        const { evidence } = await loadCorpus()
        const out = await evaluateIndexes({ dataDir, evidence, log })
        writeIndexEval(out, process.env.POC2_REPORT_DIR ?? "benchmarks/results/premise2")
        log(`[index-eval] DEV choice: ${out.choice}; wrote index-eval.md and index-eval.json`)
        return
    }
    if (stage === "agent-prepare") {
        const { agentPrepare } = await import("./agent-prepare.js")
        agentPrepare({ dataDir, log })
        return
    }
    if (stage === "agent-once") {
        const { runAgent } = await import("./agent-run.js")
        const result = await runAgent({ dataDir, stopAt: process.env.POC2_STOP_AT, ollamaUrl, log })
        process.exit(result?.reason === "complete" || result?.reason === "time" ? 0 : 1)
    }
    if (stage === "agent") {
        const { agentDirOf } = await import("./agent-run.js")
        const agentDir = agentDirOf(dataDir)
        mkdirSync(agentDir, { recursive: true })
        return supervise("agent-once", join(agentDir, "energy.jsonl"))
    }
    if (stage === "agent-status") return agentStatus()
    if (stage === "agent-grade") {
        const { grade } = await import("./grade.js")
        const summary = await grade({ dataDir, ollamaUrl, log, stopAt: process.env.POC2_STOP_AT, loadCorpus, agent: true })
        log(`[agent-grade] ${JSON.stringify(summary)}`)
        return
    }
    if (stage === "simple-prepare") {
        const { prepareSimple } = await import("./simple.js")
        await prepareSimple({ dataDir, log })
        return
    }
    if (stage === "simple-once") {
        const { runSimple } = await import("./simple.js")
        const result = await runSimple({ dataDir, phase: process.argv[3], stopAt: process.env.POC2_STOP_AT, ollamaUrl, log })
        if (result.reason === "incomplete") process.exitCode = 1
        return
    }
    if (stage === "simple-status") {
        const { simpleStatus } = await import("./simple.js")
        simpleStatus({ dataDir, log })
        return
    }
    if (stage === "simple-grade") {
        const { grade } = await import("./grade.js")
        const summary = await grade({ dataDir, ollamaUrl, log, stopAt: process.env.POC2_SIMPLE_GRADE_STOP_AT, loadCorpus, simple: true })
        log(`[simple-grade] ${JSON.stringify(summary)}`)
        return
    }
    if (stage === "simple-report") {
        const { simpleReport } = await import("./simple-report.js")
        await simpleReport({ dataDir, outDir: process.env.POC2_REPORT_DIR ?? "benchmarks/results/premise2", loadCorpus, log })
        return
    }
    if (stage === "overnight") {
        const { overnight } = await import("./overnight.js")
        await overnight({ dataDir, ollamaUrl, log })
        return
    }
    if (stage === "overnight-status") {
        const { overnightStatus } = await import("./overnight.js")
        overnightStatus({ dataDir, log })
        return
    }
    if (stage === "run") return supervise()
    if (stage === "status") return status()
    if (stage === "verify-data") return verifyData()
    throw new Error(USAGE)
}

// Watchdog: the energy logger runs as its own process for the whole session; the
// generation process is restarted after a crash (non-zero exit) up to 10 times.
// Everything is resumable, so a restart continues where the crash left off.
async function supervise(childStage = "run-once", energyOut = join(dataDir, "energy.jsonl")) {
    const here = fileURLToPath(new URL(".", import.meta.url))
    let logger = null
    if (process.env.POC2_ENERGY !== "off") {
        const args = [join(here, "energy-logger.js"), "--out", energyOut]
        if (process.env.POC2_LHM_URL) args.push("--lhm-url", process.env.POC2_LHM_URL)
        logger = spawn(process.execPath, args, { stdio: "ignore", windowsHide: true })
        logger.on("error", (error) => log(`[run] energy logger failed to start: ${error.message}`))
        log(`[run] energy logger started (pid ${logger.pid})`)
    }
    const stopLogger = () => {
        try {
            logger?.kill()
        } catch {
            // already gone
        }
    }
    process.on("SIGINT", () => {
        stopLogger()
        process.exit(130)
    })
    try {
        // Crashes restart up to 10 times in a row (the count resets after 30 min of
        // healthy running); "E* not selectable" restarts at most twice, since a restart
        // retries the failed DEV verdicts.
        let crashes = 0
        let noEstar = 0
        for (;;) {
            const started = Date.now()
            const code = await new Promise((resolve) => {
                const child = spawn(process.execPath, [fileURLToPath(import.meta.url), childStage], { stdio: "inherit", env: process.env })
                child.on("exit", (exitCode) => resolve(exitCode))
                child.on("error", () => resolve(1))
            })
            if (code === 0) {
                log("[run] finished")
                return
            }
            if (Date.now() > new Date(process.env.POC2_STOP_AT ?? 0).getTime()) {
                log("[run] stop time passed; not restarting")
                return
            }
            if (code === 3) {
                if (++noEstar > 2) {
                    log("[run] E* still not selectable (DEV grading incomplete); stopping. Rerun this command later to resume.")
                    return
                }
            } else {
                if (Date.now() - started > 30 * 60_000) crashes = 0
                if (++crashes > 10) {
                    log("[run] giving up after 10 crashes in a row; rerun the command to resume")
                    return
                }
            }
            log(`[run] generation process exited with code ${code}; restarting in 60 s`)
            await delay(60_000)
        }
    } finally {
        stopLogger()
    }
}

async function status() {
    const { readJsonl, generationKey, optionsHash } = await import("./store.js")
    const { cells } = JSON.parse(readFileSync(join(dataDir, "cells.json"), "utf8"))
    const answers = readJsonl(join(dataDir, "answers.jsonl")).records.filter((record) => record.type === "answer")
    const statePath = join(dataDir, "run-state.json")
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
    const doneKeys = new Set(answers.filter((answer) => answer.status === "ok" || answer.status === "output_limit" || answer.status === "empty").map((answer) => answer.key))
    const failures = new Map()
    for (const answer of answers) if (!doneKeys.has(answer.key)) failures.set(answer.key, (failures.get(answer.key) ?? 0) + 1)
    const digests = state.provenance?.digests ?? {}
    const optsHash = state.provenance ? optionsHash(state.provenance.options) : null
    const shown = cells.filter((cell) => cell.role !== "estar-candidate")
    if (state.estar) {
        const source = cells.find((cell) => cell.id === `E-${state.estar.estar}`)
        if (source) shown.push({ ...source, id: "P-Estar", models: { tiny: null, small: null, mid: null, large: 600 } })
    }
    const byCellModel = new Map()
    for (const cell of shown) {
        for (const [alias, n] of Object.entries(cell.models ?? {})) {
            if (!digests[alias]) continue
            const items = n == null ? cell.items : cell.items.slice(0, n)
            let ok = 0
            let failed = 0
            for (const item of items) {
                const key = generationKey(digests[alias], optsHash, item.promptSha)
                if (doneKeys.has(key)) ok++
                else if (failures.has(key)) failed++
            }
            byCellModel.set(`${cell.id}|${alias}`, { ok, failed })
        }
    }
    console.log(`E*: ${state.estar?.estar ?? "not selected"} | last stop: ${JSON.stringify(state.lastStop ?? null)}`)
    for (const cell of shown) {
        const rows = Object.entries(cell.models ?? {}).map(([alias, n]) => {
            const entry = byCellModel.get(`${cell.id}|${alias}`) ?? { ok: 0, failed: 0 }
            const target = n ?? cell.nMax
            return `${alias} ${entry.ok}/${target}${entry.failed ? ` (${entry.failed} failed)` : ""}`
        })
        console.log(`${cell.id.padEnd(22)} ${rows.join("  ")}`)
    }
    const statuses = {}
    for (const answer of answers) statuses[answer.status] = (statuses[answer.status] ?? 0) + 1
    console.log(`answers: ${answers.length} ${JSON.stringify(statuses)}`)
}

async function verifyData() {
    const { HF_FILES } = await import("./dataset.js")
    for (const [name, spec] of Object.entries(HF_FILES)) {
        const path = join(dataDir, "hf", spec.file)
        if (!existsSync(path)) {
            console.log(`${name}: MISSING ${path}`)
            continue
        }
        const hash = await new Promise((resolve, reject) => {
            const digest = createHash("sha256")
            createReadStream(path).on("data", (chunk) => digest.update(chunk)).on("end", () => resolve(digest.digest("hex"))).on("error", reject)
        })
        console.log(`${name}: ${hash === spec.sha256 ? "ok" : `MISMATCH (${hash})`}`)
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

async function agentStatus() {
    const { agentDirOf, armOptions, armKey, newIndexOf } = await import("./agent-run.js")
    const { readJsonl } = await import("./store.js")
    const { agentQueue, MODELS } = await import("./cells.js")
    const agentDir = agentDirOf(dataDir)
    const statePath = join(agentDir, "state.json")
    if (!existsSync(statePath)) return console.log("No agent run yet.")
    const state = JSON.parse(readFileSync(statePath, "utf8"))
    const items = JSON.parse(readFileSync(new URL("./agent-items.json", import.meta.url), "utf8")).items
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const recordOf = new Map(pools.test.map((record) => [record.questionKey, record]))
    const records = readJsonl(join(agentDir, "answers.jsonl")).records.filter((record) => record.type === "answer")
    const byKey = new Map()
    for (const record of records) if (record.status === "ok" || record.status === "output_limit" || record.status === "empty") byKey.set(record.key, record)
    const numPredict = state.provenance?.numPredict ?? 160
    console.log(`last stop: ${JSON.stringify(state.lastStop ?? null)} | pilot: ${JSON.stringify(state.pilot ?? null)} | dense check: ${JSON.stringify(state.denseCheck ?? null)}`)
    for (const arm of agentQueue(state.provenance?.newIndex ?? newIndexOf() ?? undefined)) {
        const digest = state.provenance?.digests?.[arm.alias]
        if (!digest || !MODELS[arm.alias]) continue
        const { optsHash } = armOptions(arm, numPredict)
        const keys = (arm.maxItems ? items.slice(0, arm.maxItems) : items).map((item) => armKey(arm, recordOf.get(item.questionKey), digest, optsHash)).filter(Boolean)
        const done = keys.map((key) => byKey.get(key)).filter(Boolean)
        const label = `${arm.id}|${arm.alias}`.padEnd(30)
        if (!done.length) {
            console.log(`${label} 0/${keys.length}`)
            continue
        }
        const avg = (field) => done.reduce((sum, record) => sum + (record[field] ?? 0), 0) / done.length
        const outcomes = {}
        for (const record of done) outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1
        console.log(`${label} ${done.length}/${keys.length} | ${(avg("wallMs") / 1000).toFixed(1)} s/episode | rounds ${avg("rounds").toFixed(2)} | protocol errors/episode ${avg("protocolErrors").toFixed(2)} | ${JSON.stringify(outcomes)}`)
    }
}
