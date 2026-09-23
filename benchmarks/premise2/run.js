// The Windows run: one continuous, resumable, unattended session (stages 0-6 of the
// plan). Reads only the prepared cells and prompts, never the corpus.
//
// Stage 0 probe · 1 DEV grid (e2b) · 2 small-model primaries/secondaries while J1
// grades DEV in parallel · 3 select E*, then P-E* for the small models · 4 the 31b:
// floor, then P-oracle/P-B/P-E* interleaved in blocks of 50 · 5 the 31b's
// time-admitted secondaries · 6 e2b grid and exploratory cells.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, execSync } from "node:child_process"
import { chat, generationOptions, version, tags, show, ps, unload, load, renderOnly, compareVersions } from "./ollama.js"
import { AnswerStore, appendJsonl, generationKey, optionsHash, readJsonl, runFingerprint, writeJsonAtomic } from "./store.js"
import { MODELS, LARGE_INTERLEAVE, LARGE_TIME_RULE_ORDER, SMOKE, capItems } from "./cells.js"
import { runProbe } from "./probe.js"
import { judgeDevAnswers, selectEstar } from "./select.js"
import { sha256 } from "./text.js"

const now = () => performance.timeOrigin + performance.now()
const iso = () => new Date().toISOString()

export async function run({ dataDir, stopAt, ollamaUrl = "http://localhost:11434", log = console.log, skipProbe = false }) {
    const manifest = JSON.parse(readFileSync(join(dataDir, "manifest-prepare.json"), "utf8"))
    const { cells } = JSON.parse(readFileSync(join(dataDir, "cells.json"), "utf8"))
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const prompts = new Map()
    for (const record of readJsonl(join(dataDir, "prompts.jsonl")).records) prompts.set(record.sha, record.text)
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const recordByKey = new Map([...pools.dev, ...pools.test, ...pools.bridge].map((record) => [record.questionKey, record]))
    const markersPath = join(dataDir, "markers.jsonl")
    const statePath = join(dataDir, "run-state.json")
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    if (store.recovered) log(`[run] recovered ${store.recovered} torn line(s) in answers.jsonl`)
    // A stop time is required: without one, a lasting judge pause or a stalled
    // queue would never end the run.
    const stopTime = new Date(stopAt ?? "").getTime()
    if (!Number.isFinite(stopTime)) throw new Error(`POC2_STOP_AT must be set to a valid local time such as 2026-09-23T18:00 (got ${JSON.stringify(stopAt ?? null)})`)
    if (stopTime <= Date.now()) throw new Error(`POC2_STOP_AT (${stopAt}) is in the past`)
    const commit = gitCommit()
    const marker = (kind, extra = {}) => appendJsonl(markersPath, { t: now(), wall: iso(), kind, ...extra })

    // ---- preflight and provenance ----
    const ollamaVersion = await version(ollamaUrl)
    if (compareVersions(ollamaVersion, "0.34.0") < 0) log(`[run] WARNING Ollama ${ollamaVersion} < 0.34: prompt_eval_cached_count will be missing`)
    const installed = new Map((await tags(ollamaUrl)).map((model) => [model.name, model]))
    const aliases = Object.keys(MODELS)
    const missing = aliases.map((alias) => MODELS[alias].tag).filter((tag) => !installed.has(tag))
    if (missing.length) throw new Error(`Missing Ollama models: ${missing.join(", ")}. Pull them first (ollama pull <tag>).`)
    // In a smoke run every alias is the same model; the alias suffix keeps their
    // answers apart so every code path still runs.
    const digests = Object.fromEntries(aliases.map((alias) => [alias, `${installed.get(MODELS[alias].tag).digest}${SMOKE ? `#${alias}` : ""}`]))
    if (SMOKE) log(`[run] SMOKE run: every model is ${SMOKE.model}, at most ${SMOKE.maxItems} items per cell. Not for results.`)
    const details = {}
    for (const alias of aliases) details[alias] = await show(ollamaUrl, MODELS[alias].tag)

    let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
    const saveState = () => writeJsonAtomic(statePath, state)

    // ---- stage 0: probe (runs once; its decisions are frozen in the state file) ----
    if (!state.probe && !skipProbe) {
        state.probe = await runProbe({ cells: cellById, prompts, recordByKey, ollamaUrl, log, limits: SMOKE ? { tiny: 4, large: 3, judge: 3 } : undefined })
        saveState()
    }
    // ---- stage 0b: retrieval latency on this machine, in a child process so the
    // corpus, dense matrix and reranker are freed before any generator loads ----
    if (!state.latency && process.env.POC2_SKIP_LATENCY !== "1") {
        const code = await new Promise((resolve) => {
            const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "latency"], { stdio: "inherit", env: process.env })
            child.on("exit", resolve)
            child.on("error", () => resolve(-1))
        })
        state.latency = { at: iso(), ok: code === 0 }
        if (code !== 0) log(`[run] latency sample failed (exit ${code}); continuing without it`)
        saveState()
    }
    const numPredict = state.probe?.numPredict ?? generationOptions().num_predict
    const options = generationOptions({ num_predict: numPredict })
    const optsHash = optionsHash(options)
    const preregHash = existsSync(new URL("./PREREG.md", import.meta.url)) ? sha256(readFileSync(new URL("./PREREG.md", import.meta.url), "utf8")) : null
    const fingerprint = runFingerprint({ prepareManifest: manifest, modelDigests: digests, options, ollamaVersion, preregHash })
    if (state.fingerprint && state.fingerprint !== fingerprint && process.env.POC2_ALLOW_NEW_FINGERPRINT !== "1") {
        throw new Error("This run's generation settings differ from the existing state (model digest, options, Ollama version, PREREG or prepared data changed). Refusing to mix incomparable answers. Set POC2_ALLOW_NEW_FINGERPRINT=1 only if you mean to start a new comparable run in a fresh data directory.")
    }
    state.fingerprint = fingerprint
    state.provenance = {
        startedAt: state.provenance?.startedAt ?? iso(),
        resumedAt: iso(),
        commit,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        windowsBuild: windowsBuild(),
        ollamaVersion,
        digests,
        details: Object.fromEntries(Object.entries(details).map(([alias, value]) => [alias, { details: value.details, capabilities: value.capabilities, parameters: value.parameters, parameterCount: value.parameterCount, contextLength: value.contextLength }])),
        options,
        declaredServerEnv: Object.fromEntries(["OLLAMA_NUM_PARALLEL", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_FLASH_ATTENTION", "OLLAMA_KV_CACHE_TYPE", "OLLAMA_CONTEXT_LENGTH"].map((name) => [name, process.env[name] ?? null])),
        nvidiaSmi: nvidiaSnapshot(),
        preregHash,
    }
    if (!state.templates) {
        state.templates = {}
        for (const alias of aliases) state.templates[alias] = await renderOnly(ollamaUrl, MODELS[alias].tag, "Question: ping")
    }
    saveState()

    // ---- generation machinery ----
    let resident = null
    let lastItemAt = now()
    let judgeActive = false
    const recent = new Map()

    const ensureModel = async (alias) => {
        if (resident === alias) return
        for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
        marker("load-start", { model: alias })
        const loaded = await load(ollamaUrl, MODELS[alias].tag)
        marker("load-end", { model: alias, ...loaded })
        const warmup = cellById.get("PR-oracle").items.slice(0, 2)
        for (const item of warmup) await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: prompts.get(item.promptSha), options, attempts: 2 })
        const snapshot = (await ps(ollamaUrl)).map((model) => ({ name: model.name, size: model.size, sizeVram: model.size_vram, contextLength: model.context_length, digest: model.digest }))
        const residentModels = snapshot.map((model) => model.name)
        if (residentModels.length !== 1) log(`[run] WARNING ${residentModels.length} models resident: ${residentModels.join(", ")}`)
        marker("ps", { model: alias, snapshot })
        // Idle baseline with the model resident: 30 s per model block (marginal energy
        // subtracts it). Per-cell baselines would cost ~15 min of the run for little.
        const blockId = `idle:${alias}:${iso()}`
        marker("idle-start", { blockId, model: alias })
        await new Promise((resolve) => setTimeout(resolve, 30_000))
        marker("idle-end", { blockId, model: alias })
        resident = alias
        log(`[run] ${alias} (${MODELS[alias].tag}) resident; GPU share ${snapshot[0]?.size ? (snapshot[0].sizeVram / snapshot[0].size * 100).toFixed(0) : "?"}%`)
    }

    const outOfTime = (projectedMs = 0) => now() + projectedMs > stopTime
    let stopping = false

    // Typical wall time per item: this session's bucket, else the answers already in
    // the store (a restart keeps its timing knowledge), else the probe's 31b rate.
    const storeMean = (alias, arm = null) => {
        const walls = []
        for (const answer of store.done.values()) {
            if (answer.model !== alias || answer.status !== "ok" || !answer.wallMs) continue
            if (arm && cellById.get(answer.cellId)?.arm !== arm) continue
            walls.push(answer.wallMs)
        }
        return mean(walls)
    }
    const typicalMs = (alias, cell) => mean(recent.get(`${alias}:${cell.arm}:${cell.retrieval?.k ?? ""}`))
        ?? storeMean(alias, cell.arm) ?? storeMean(alias)
        ?? (alias === "large" ? state.probe?.models?.large?.rates?.bWallMsMean ?? 15_000 : 2_000)

    // An http_error/timeout while Ollama itself is down is not the item's fault: wait
    // for the server (up to 30 min), force a reload, and retry without recording it.
    const ollamaAlive = () => version(ollamaUrl).then(() => true, () => false)
    const waitForOllama = async () => {
        for (let waited = 0; waited < 30 * 60_000; waited += 30_000) {
            if (await ollamaAlive()) return true
            if (waited === 0) log("[run] Ollama is not responding; waiting for it (up to 30 min)")
            await new Promise((resolve) => setTimeout(resolve, 30_000))
        }
        return false
    }

    // Generates `items` of `cell` on `alias`. Returns false if stopped by the clock.
    const runItems = async (alias, cell, items, label = cell.id) => {
        // Nothing pending: no model load, no block markers (a resumed run skips
        // finished cells in seconds).
        if (!items.some((item) => !store.has(generationKey(digests[alias], optsHash, item.promptSha)))) return true
        await ensureModel(alias)
        const blockId = `${alias}:${cell.id}:${iso()}`
        marker("block-start", { blockId, model: alias, cell: cell.id, judgeActive })
        // Gaps are measured between consecutive answers inside a block, so model
        // loads and idle baselines never flag an answer; a long gap here means the
        // machine slept or stalled, and that answer's timing is marked suspect.
        lastItemAt = now()
        let done = 0
        let skipped = 0
        for (const item of items) {
            const key = generationKey(digests[alias], optsHash, item.promptSha)
            if (store.has(key)) {
                skipped++
                continue
            }
            if (outOfTime(typicalMs(alias, cell))) {
                marker("block-end", { blockId, model: alias, cell: cell.id, stopped: "time", judgeActive })
                log(`[run] stop time reached during ${label} on ${alias}`)
                return false
            }
            const gapMs = now() - lastItemAt
            const startedAt = iso()
            let result = await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: prompts.get(item.promptSha), options })
            if ((result.status === "http_error" || result.status === "timeout") && !(await ollamaAlive())) {
                if (!(await waitForOllama())) throw new Error("Ollama did not come back within 30 min")
                resident = null
                await ensureModel(alias)
                lastItemAt = now()
                result = await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: prompts.get(item.promptSha), options })
            }
            let reloaded = false
            if (result.status === "ok" && (result.loadMs ?? 0) > 100) {
                reloaded = true
                result = await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: prompts.get(item.promptSha), options })
            }
            lastItemAt = now()
            const bucket = `${alias}:${cell.arm}:${cell.retrieval?.k ?? ""}`
            if (!recent.has(bucket)) recent.set(bucket, [])
            if (result.wallMs) recent.get(bucket).push(result.wallMs)
            store.add({
                key, model: alias, tag: MODELS[alias].tag, digest: digests[alias], cellId: cell.id, questionKey: item.questionKey,
                promptSha: item.promptSha, optionsHash: optsHash, ...result, reloadedAndRetried: reloaded,
                timingSuspect: gapMs > 120_000, startedAt, finishedAt: iso(), blockId, judgeActive, commit,
            })
            done++
            if (done % 25 === 0) log(`[${label}] ${alias} ${done + skipped}/${items.length} (${result.status}, ${result.wallMs} ms)`)
            if (Date.now() - (state.heartbeatAt ?? 0) > 60_000) {
                state.heartbeatAt = Date.now()
                marker("heartbeat", { model: alias, cell: cell.id })
            }
        }
        marker("block-end", { blockId, model: alias, cell: cell.id, judgeActive })
        log(`[${label}] ${alias} done: ${done} generated${skipped ? `, ${skipped} already present` : ""}`)
        return true
    }

    const itemsFor = (cell, alias) => {
        const n = cell.models?.[alias]
        return capItems(n == null ? cell.items : cell.items.slice(0, n))
    }
    const runCell = async (id, alias, override) => {
        const cell = cellById.get(id)
        if (!cell) throw new Error(`unknown cell ${id}`)
        return runItems(alias, cell, override ?? itemsFor(cell, alias))
    }

    // ---- wake lock (Windows) ----
    const wakeLock = startWakeLock(log)
    try {
        // ---- stage 1: DEV grid on e2b ----
        const devCells = cells.filter((cell) => cell.role === "dev")
        for (const cell of devCells) if (!(await runCell(cell.id, "small"))) return finish("time", 1)

        // ---- stage 2: J1 grades DEV in parallel while the small models run ----
        let devJudging = null
        let devSettled = true
        if (!state.estar) {
            judgeActive = true
            devSettled = false
            devJudging = judgeDevAnswers({ dataDir, cells: devCells, store, digests, optsHash, recordByKey, ollamaUrl, log, stopTime, concurrency: state.probe?.judgeConcurrency, shouldStop: () => stopping })
                .catch((error) => {
                    log(`[judge] DEV judging stopped: ${error.message}`)
                    return null
                })
                .finally(() => {
                    judgeActive = false
                    devSettled = true
                })
        }
        const stage2 = cells.filter((cell) => cell.stage === 2 && cell.role !== "probe")
        for (const alias of ["small", "tiny", "mid", "bridge"]) {
            if (alias === "tiny" && state.probe?.tinyDropped) continue
            for (const cell of stage2) if (cell.models?.[alias] !== undefined) if (!(await runCell(cell.id, alias))) return finish("time", 2)
        }

        // Gold-informed selection (E*-independent diagnostic on B's context).
        if (cellById.get("X-goldsel-B") && !(await runCell("X-goldsel-B", "small"))) return finish("time", 2)

        // ---- E* availability. Only P-E* depends on DEV grading; the GPU never waits
        // for it while E*-independent work remains (pre-registered deferral rule). ----
        let estarAs = null
        const estarNow = () => {
            if (!state.estar && devSettled) {
                const selection = selectEstar({ dataDir, cells: devCells, store, recordByKey, digests, optsHash, maxItems: SMOKE?.maxItems })
                if (selection) {
                    state.estar = selection
                    saveState()
                    log(`[select] E* = ${selection.estar} (tied with ${selection.tiedWith.join(", ")})`)
                    marker("estar-selected", { estar: selection.estar })
                }
            }
            if (state.estar && !estarAs) estarAs = { ...cellById.get(`E-${state.estar.estar}`), id: "P-Estar" }
            return Boolean(state.estar)
        }
        const smallEstar = async () => {
            if (state.smallEstarDone) return true
            for (const alias of ["small", "tiny", "mid"]) {
                if (alias === "tiny" && state.probe?.tinyDropped) continue
                if (!(await runItems(alias, estarAs, capItems(estarAs.items), "P-Estar"))) return false
            }
            state.smallEstarDone = true
            saveState()
            return true
        }

        // ---- stage 3: P-E* on the small models (or stage 6 first if E* is late) ----
        if (!estarNow()) {
            log("[select] DEV judging still running; running the E*-independent stage 6 now")
            if (!(await stage6())) return finish("time", 6)
        }
        if (estarNow() && !(await smallEstar())) return finish("time", 3)

        // ---- stage 4: the 31b. P-E* blocks join as soon as E* exists and catch up
        // to the other primaries (the store skips finished items), so every stop
        // still leaves near-equal paired prefixes. ----
        if (!(await runCell("S-floor", "large"))) return finish("time", 4)
        const targets = Object.fromEntries(Object.entries(LARGE_INTERLEAVE.targets).map(([id, n]) => [id, SMOKE ? Math.min(n, SMOKE.maxItems) : n]))
        const largeSource = (id) => (id === "P-Estar" ? estarAs : cellById.get(id))
        for (let start = 0; start < Math.max(...Object.values(targets)); start += LARGE_INTERLEAVE.block) {
            estarNow()
            for (const [id, target] of Object.entries(targets)) {
                if (start >= target) continue
                const cell = largeSource(id)
                if (!cell) continue
                const block = cell.items.slice(0, Math.min(start + LARGE_INTERLEAVE.block, target))
                if (!(await runItems("large", { ...cell, id }, block, `${id}[${start}]`))) return finish("time", 4)
            }
        }
        if (estarNow()) {
            if (!(await runItems("large", estarAs, estarAs.items.slice(0, targets["P-Estar"]), "P-Estar(large)"))) return finish("time", 4)
            if (!(await smallEstar())) return finish("time", 4)
        }

        // ---- stage 5: 31b secondaries admitted by the time rule. While E* is still
        // missing, the pending P-E* work is reserved first. ----
        const perLargeItem = () => mean([...recent.entries()].filter(([key]) => key.startsWith("large:")).flatMap(([, values]) => values)) ?? storeMean("large") ?? state.probe?.models?.large?.rates?.bWallMsMean ?? 15_000
        const pendingEstarMs = () => {
            if (state.estar && state.smallEstarDone) return 0
            const largePending = state.estar ? estarAs.items.slice(0, targets["P-Estar"]).filter((item) => !store.has(generationKey(digests.large, optsHash, item.promptSha))).length : targets["P-Estar"]
            const smallItems = (state.estar ? estarAs.items.length : cellById.get("P-B").items.length) * 3
            return largePending * perLargeItem() + (state.smallEstarDone ? 0 : smallItems * 2_000)
        }
        // Decisions are saved: a skipped cell is never re-admitted after a restart, and
        // an admitted one is resumed without a new projection.
        state.timeRule ??= {}
        for (const { cell: id, n } of LARGE_TIME_RULE_ORDER) {
            const cell = cellById.get(id)
            const items = capItems(cell.items.slice(0, n))
            if (state.timeRule[id]?.decision === "skip") continue
            if (!state.timeRule[id]) {
                const pending = items.filter((item) => !store.has(generationKey(digests.large, optsHash, item.promptSha))).length
                const perItem = mean(recent.get(`large:${cell.arm}:${cell.retrieval?.k ?? ""}`)) ?? storeMean("large", cell.arm) ?? perLargeItem()
                const projected = pending * perItem
                const reserve = pendingEstarMs()
                const decision = outOfTime(projected + reserve) ? "skip" : "admit"
                state.timeRule[id] = { decision, pending, projectedMs: Math.round(projected), reserveMs: Math.round(reserve), at: iso() }
                saveState()
                marker(`time-rule-${decision}`, { cell: id, pending, projectedMs: projected, reserveMs: reserve })
                if (decision === "skip") {
                    log(`[run] time rule: skipping 31b ${id} (${pending} items, projected ${(projected / 3600000).toFixed(2)} h, reserved ${(reserve / 3600000).toFixed(2)} h for P-E*)`)
                    continue
                }
            }
            if (!(await runItems("large", cell, items, `${id}(large)`))) return finish("time", 5)
            if (estarNow() && !state.smallEstarDone) {
                if (!(await runItems("large", estarAs, estarAs.items.slice(0, targets["P-Estar"]), "P-Estar(large)"))) return finish("time", 5)
                if (!(await smallEstar())) return finish("time", 5)
            }
        }

        // ---- E* still missing: wait for DEV grading (bounded by the stop time) ----
        if (!state.estar) {
            log("[select] all E*-independent work is done; waiting for DEV grading to finish")
            if (devJudging) await devJudging
            if (!estarNow()) return finish("no-estar", 5)
            if (!(await runItems("large", estarAs, estarAs.items.slice(0, targets["P-Estar"]), "P-Estar(large)"))) return finish("time", 5)
            if (!(await smallEstar())) return finish("time", 5)
        }

        // ---- stage 6: e2b grid and exploratory ----
        if (!(await stage6())) return finish("time", 6)
        return finish("complete", 6)
    } finally {
        wakeLock?.kill()
    }

    async function stage6() {
        if (state.stage6Done) return true
        for (const cell of cells.filter((c) => c.stage === 6)) if (!(await runCell(cell.id, "small"))) return false
        state.stage6Done = true
        saveState()
        return true
    }

    function finish(reason, stage) {
        stopping = true
        state.lastStop = { reason, stage, at: iso() }
        saveState()
        marker("run-stop", { reason, stage })
        log(`[run] stopped: ${reason} (stage ${stage}). Rerun the same command to resume.`)
        return state.lastStop
    }
}

const mean = (values) => (values && values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

export function gitCommit() {
    try {
        const head = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
        const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== ""
        return `${head}${dirty ? "+dirty" : ""}`
    } catch {
        return null
    }
}

export function windowsBuild() {
    if (process.platform !== "win32") return null
    try {
        return execSync("cmd /c ver", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    } catch {
        return null
    }
}

export function nvidiaSnapshot() {
    try {
        return execSync("nvidia-smi --query-gpu=name,driver_version,memory.total,power.limit --format=csv,noheader", { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString().trim()
    } catch {
        return null
    }
}

// Keeps Windows awake for the run (ES_CONTINUOUS | ES_SYSTEM_REQUIRED), refreshed
// every 30 s by a child PowerShell. No-op elsewhere.
export function startWakeLock(log) {
    if (process.platform !== "win32") return null
    const script = `Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; while ($true) { [W.P]::SetThreadExecutionState(0x80000001) | Out-Null; Start-Sleep -Seconds 30 }`
    try {
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true })
        child.on("error", (error) => log(`[run] wake lock unavailable: ${error.message}`))
        return child
    } catch (error) {
        log(`[run] wake lock unavailable: ${error.message}`)
        return null
    }
}

export { mkdirSync }
