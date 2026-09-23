// The agent arm's Windows run (PREREG-AGENT.md): one supervised, resumable queue
// of agent episodes against a stop time.
//
// Isolation: everything this run writes lives under the agent directory
// (default .data/premise2/agent/). It never writes the main run's files; it only
// reads run-state.json (the probe's frozen num_predict and the main run's
// provenance), pools.json, the BM25 index and the corpus parquet.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { chat, generationOptions, version, tags, ps, unload, load, compareVersions } from "./ollama.js"
import { AnswerStore, appendJsonl, generationKey, optionsHash, writeJsonAtomic, MAX_FAILED_ATTEMPTS } from "./store.js"
import { MODELS, SMOKE, capItems, AGENT_ARMS, AGENT_THINK_NUM_PREDICT, AGENT_BLOCK } from "./cells.js"
import { openBm25 } from "./bm25.js"
import { loadRaw } from "./dataset.js"
import { runEpisode, episodeSha, firstMessage, PROTOCOL_HASH, STOP_SEQUENCES, TRANSIENT_STATUSES } from "./agent.js"
import { gitCommit, windowsBuild, nvidiaSnapshot, startWakeLock } from "./run.js"
import { sha256 } from "./text.js"

const now = () => performance.timeOrigin + performance.now()
const iso = () => new Date().toISOString()
const mean = (values) => (values && values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

// Fallback per-episode estimates for the stop-time projection before an arm has
// its own timings (ms).
const FALLBACK_EPISODE_MS = { tiny: 3_000, small: 5_000, mid: 8_000, large: 60_000 }
const THINK_FALLBACK_MS = { small: 20_000, mid: 30_000 }

export const agentDirOf = (dataDir) => resolve(process.env.POC2_AGENT_DIR ?? join(dataDir, "agent"))

// The addendum's fingerprint covers the text above the deviation log only, so a
// logged deviation never blocks a resume (unlike the main run's PREREG hash).
export function preregAgentHash(text) {
    return sha256(String(text ?? "").split(/^## Deviation log/m)[0])
}

export function armOptions(arm, numPredict) {
    const think = Boolean(arm.think)
    const options = generationOptions({ num_predict: think ? AGENT_THINK_NUM_PREDICT : numPredict, ...(think ? {} : { stop: STOP_SEQUENCES }) })
    return { options, think, optsHash: optionsHash({ ...options, think, protocol: PROTOCOL_HASH }) }
}

// path -> R0 email text, built once from the shipped parquet so restarts are fast
// and the corpus never sits in the heap next to a large model.
export async function ensureEmailStore(dataDir, agentDir, log) {
    const path = join(agentDir, "emails.sqlite")
    if (!existsSync(path)) {
        log("[agent] building emails.sqlite from the corpus parquet (once)")
        const raw = await loadRaw(join(dataDir, "hf"))
        const temporary = `${path}.${process.pid}.tmp`
        rmSync(temporary, { force: true })
        const db = new DatabaseSync(temporary)
        db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; CREATE TABLE emails (path TEXT PRIMARY KEY, email TEXT NOT NULL)")
        const insert = db.prepare("INSERT INTO emails VALUES (?, ?)")
        db.exec("BEGIN")
        for (const row of raw.corpus) insert.run(row.path, row.email)
        db.exec("COMMIT")
        db.close()
        renameSync(temporary, path)
    }
    const db = new DatabaseSync(path, { readOnly: true })
    const get = db.prepare("SELECT email FROM emails WHERE path = ?")
    const cache = new Map()
    return {
        emailOf(emailPath) {
            if (!cache.has(emailPath)) {
                if (cache.size > 20_000) cache.clear()
                cache.set(emailPath, get.get(emailPath)?.email ?? "")
            }
            return cache.get(emailPath)
        },
        close: () => db.close(),
    }
}

export async function runAgent({ dataDir, stopAt, ollamaUrl = "http://localhost:11434", log = console.log }) {
    const agentDir = agentDirOf(dataDir)
    mkdirSync(agentDir, { recursive: true })
    const inAgentDir = (name) => {
        const path = resolve(agentDir, name)
        if (!path.startsWith(agentDir + sep)) throw new Error(`refusing to write outside the agent directory: ${path}`)
        return path
    }
    const stopTime = new Date(stopAt ?? "").getTime()
    if (!Number.isFinite(stopTime)) throw new Error(`POC2_STOP_AT must be set to a valid local time such as 2026-09-24T18:00 (got ${JSON.stringify(stopAt ?? null)})`)
    if (stopTime <= Date.now()) throw new Error(`POC2_STOP_AT (${stopAt}) is in the past`)

    const itemsFile = JSON.parse(readFileSync(new URL("./agent-items.json", import.meta.url), "utf8"))
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const recordByKey = new Map([...pools.dev, ...pools.test].map((record) => [record.questionKey, record]))
    const mainState = JSON.parse(readFileSync(join(dataDir, "run-state.json"), "utf8"))
    const numPredict = mainState.probe?.numPredict ?? 160
    const items = capItems(itemsFile.items)
    const preregText = existsSync(new URL("./PREREG-AGENT.md", import.meta.url)) ? readFileSync(new URL("./PREREG-AGENT.md", import.meta.url), "utf8") : null
    if (!preregText && !SMOKE) throw new Error("PREREG-AGENT.md is missing: the addendum must be committed before the agent run")

    // ---- preflight: the same models and software as the main run ----
    const ollamaVersion = await version(ollamaUrl)
    const installed = new Map((await tags(ollamaUrl)).map((model) => [model.name, model]))
    const aliases = [...new Set(AGENT_ARMS.map((arm) => arm.alias))]
    const missing = aliases.map((alias) => MODELS[alias].tag).filter((tag) => !installed.has(tag))
    if (missing.length) throw new Error(`Missing Ollama models: ${missing.join(", ")}`)
    const digests = Object.fromEntries(aliases.map((alias) => [alias, `${installed.get(MODELS[alias].tag).digest}${SMOKE ? `#${alias}` : ""}`]))
    if (!SMOKE && process.env.POC2_AGENT_ALLOW_MISMATCH !== "1") {
        const main = mainState.provenance ?? {}
        const changed = aliases.filter((alias) => main.digests?.[alias] && main.digests[alias] !== digests[alias])
        if (changed.length) throw new Error(`Model digests differ from the main run for ${changed.join(", ")}; the agent arm must use the same weights (set POC2_AGENT_ALLOW_MISMATCH=1 only to override deliberately)`)
        if (main.ollamaVersion && main.ollamaVersion !== ollamaVersion) throw new Error(`Ollama ${ollamaVersion} differs from the main run's ${main.ollamaVersion}; reinstall that version or set POC2_AGENT_ALLOW_MISMATCH=1 to override deliberately`)
    }
    if (compareVersions(ollamaVersion, "0.34.0") < 0) log(`[agent] WARNING Ollama ${ollamaVersion} < 0.34: cached prompt counts will be missing`)
    if (SMOKE) log(`[agent] SMOKE run: every model is ${SMOKE.model}, at most ${SMOKE.maxItems} questions per arm. Not for results.`)

    const statePath = inAgentDir("state.json")
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
    const saveState = () => writeJsonAtomic(statePath, state)
    const optionsByArm = Object.fromEntries(AGENT_ARMS.map((arm) => [`${arm.cell}|${arm.alias}`, armOptions(arm, numPredict).optsHash]))
    const fingerprint = sha256(JSON.stringify({ prereg: preregAgentHash(preregText), protocol: PROTOCOL_HASH, items: itemsFile.hash, digests, optionsByArm, ollamaVersion }))
    if (state.fingerprint && state.fingerprint !== fingerprint && process.env.POC2_ALLOW_NEW_FINGERPRINT !== "1") {
        throw new Error("The agent run's settings differ from the existing agent state (protocol, addendum, items, model digests, options or Ollama version changed). Refusing to mix incomparable episodes.")
    }
    const commit = gitCommit()
    state.fingerprint = fingerprint
    state.provenance = {
        startedAt: state.provenance?.startedAt ?? iso(), resumedAt: iso(), commit, node: process.version,
        platform: `${process.platform} ${process.arch}`, windowsBuild: windowsBuild(), ollamaVersion, digests,
        numPredict, thinkNumPredict: AGENT_THINK_NUM_PREDICT, protocolHash: PROTOCOL_HASH, itemsHash: itemsFile.hash,
        preregAgentHash: preregAgentHash(preregText), nvidiaSmi: nvidiaSnapshot(),
        declaredServerEnv: Object.fromEntries(["OLLAMA_NUM_PARALLEL", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_FLASH_ATTENTION", "OLLAMA_KV_CACHE_TYPE"].map((name) => [name, process.env[name] ?? null])),
    }
    saveState()

    const store = new AnswerStore(inAgentDir("answers.jsonl"))
    if (store.recovered) log(`[agent] recovered ${store.recovered} torn line(s) in agent/answers.jsonl`)
    const markersPath = inAgentDir("markers.jsonl")
    const marker = (kind, extra = {}) => appendJsonl(markersPath, { t: now(), wall: iso(), kind, ...extra })
    const emails = await ensureEmailStore(dataDir, agentDir, log)
    const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
    const search = async (query, k) => bm25.search(query, k)

    let resident = null
    const recent = new Map()
    let heartbeatAt = 0
    const ensureModel = async (alias) => {
        if (resident === alias) return
        for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
        marker("load-start", { model: alias })
        const loaded = await load(ollamaUrl, MODELS[alias].tag)
        marker("load-end", { model: alias, ...loaded })
        const warmup = firstMessage(recordByKey.get(items[0].questionKey)?.question ?? "What is this about?")
        for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: warmup, options: generationOptions({ num_predict: 32 }), attempts: 2 })
        const snapshot = (await ps(ollamaUrl)).map((model) => ({ name: model.name, size: model.size, sizeVram: model.size_vram, contextLength: model.context_length, digest: model.digest }))
        if (snapshot.length !== 1) log(`[agent] WARNING ${snapshot.length} models resident: ${snapshot.map((model) => model.name).join(", ")}`)
        marker("ps", { model: alias, snapshot })
        const blockId = `idle:${alias}:${iso()}`
        marker("idle-start", { blockId, model: alias })
        await new Promise((done) => setTimeout(done, SMOKE ? 1_000 : 30_000))
        marker("idle-end", { blockId, model: alias })
        resident = alias
        log(`[agent] ${alias} (${MODELS[alias].tag}) resident; GPU share ${snapshot[0]?.size ? (snapshot[0].sizeVram / snapshot[0].size * 100).toFixed(0) : "?"}%`)
    }

    const episodeFor = async (arm, question) => {
        const { options, think } = armOptions(arm, numPredict)
        // gemma3:1b has no thinking; a smoke run exercises the thinking arm's code path without it.
        const useThink = think && !SMOKE
        const chatTurn = (messages) => chat({ url: ollamaUrl, model: MODELS[arm.alias].tag, messages, options, think: useThink })
        return runEpisode({ question, chatTurn, search, emailOf: emails.emailOf, variant: arm.variant, rawFirst: arm.rawFirst })
    }

    const wakeLock = startWakeLock(log)
    try {
        // ---- determinism pilot: 10 DEV questions twice on e2b, once per agent state ----
        if (!state.pilot) {
            const pilotArm = AGENT_ARMS[0]
            await ensureModel(pilotArm.alias)
            const pilot = pools.dev.slice(0, SMOKE ? 2 : 10)
            let matches = 0
            let compared = 0
            for (const record of pilot) {
                const first = await episodeFor(pilotArm, record.question)
                const second = await episodeFor(pilotArm, record.question)
                if (TRANSIENT_STATUSES.has(first.status) || TRANSIENT_STATUSES.has(second.status)) continue
                compared++
                if (first.transcriptSha === second.transcriptSha) matches++
            }
            state.pilot = { at: iso(), alias: pilotArm.alias, compared, identicalTranscripts: matches }
            saveState()
            log(`[agent] determinism pilot: ${matches}/${compared} DEV episodes reproduced exactly`)
        }

        // Up to MAX_FAILED_ATTEMPTS passes: an episode that failed for a technical
        // reason (not final in the store) is retried on the next pass.
        for (let pass = 1; pass <= MAX_FAILED_ATTEMPTS; pass++) {
        let pendingAny = false
        for (const arm of AGENT_ARMS) {
            const { optsHash } = armOptions(arm, numPredict)
            const keyOf = (item) => generationKey(digests[arm.alias], optsHash, episodeSha(recordByKey.get(item.questionKey).question, arm.variant, arm.rawFirst))
            const pending = items.filter((item) => !store.has(keyOf(item)))
            const label = `${arm.cell}|${arm.alias}`
            if (!pending.length) continue
            pendingAny = true
            await ensureModel(arm.alias)
            log(`[agent] ${label}: ${pending.length} episodes pending`)
            const bucket = recent.get(label) ?? []
            recent.set(label, bucket)
            for (let start = 0; start < pending.length; start += AGENT_BLOCK) {
                const block = pending.slice(start, start + AGENT_BLOCK)
                const blockId = `${label}:${iso()}`
                marker("block-start", { blockId, model: arm.alias, cell: arm.cell })
                let lastAt = now()
                for (const item of block) {
                    const typical = mean(bucket) ?? (arm.think ? THINK_FALLBACK_MS[arm.alias] : FALLBACK_EPISODE_MS[arm.alias]) ?? 10_000
                    if (now() + typical > stopTime) {
                        marker("block-end", { blockId, model: arm.alias, cell: arm.cell, stopped: "time" })
                        return finish("time", label)
                    }
                    const record = recordByKey.get(item.questionKey)
                    const gapMs = now() - lastAt
                    const startedAt = iso()
                    const episode = await episodeFor(arm, record.question)
                    lastAt = now()
                    if (episode.wallMs && !TRANSIENT_STATUSES.has(episode.status)) bucket.push(episode.wallMs)
                    store.add({
                        key: keyOf(item), model: arm.alias, tag: MODELS[arm.alias].tag, digest: digests[arm.alias], cellId: arm.cell,
                        variant: arm.variant ?? "standard", rawFirst: Boolean(arm.rawFirst), think: Boolean(arm.think && !SMOKE),
                        questionKey: item.questionKey, stratum: item.stratum, order: item.order, optionsHash: optsHash,
                        // A real reload takes seconds; resident calls report 2-50 ms on
                        // the eval box (up to ~130 ms on older Ollama builds).
                        ...episode, reloaded: episode.maxLoadMs > 1_000, timingSuspect: gapMs > 120_000,
                        startedAt, finishedAt: iso(), blockId, commit,
                    })
                    if (Date.now() - heartbeatAt > 60_000) {
                        heartbeatAt = Date.now()
                        marker("heartbeat", { model: arm.alias, cell: arm.cell })
                    }
                }
                marker("block-end", { blockId, model: arm.alias, cell: arm.cell })
                const done = items.filter((item) => store.has(keyOf(item))).length
                log(`[agent] ${label}: ${done}/${items.length} (mean ${Math.round(mean(bucket) ?? 0)} ms/episode)`)
            }
        }
        if (!pendingAny) break
        }
        return finish("complete", null)
    } finally {
        wakeLock?.kill()
        emails.close()
        bm25.close()
    }

    function finish(reason, arm) {
        state.lastStop = { reason, arm, at: iso() }
        saveState()
        marker("run-stop", { reason, arm })
        log(`[agent] stopped: ${reason}${arm ? ` (during ${arm})` : ""}. Rerun the same command to resume.`)
        return state.lastStop
    }
}
