// Separate exploratory agent arm: identical protocol, word-overlap SEARCH only.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { MODELS, SMOKE } from "./cells.js"
import { chat, generationOptions, load, ps, tags, unload, version } from "./ollama.js"
import { runEpisode, firstMessage, PROTOCOL_HASH, TRANSIENT_STATUSES } from "./agent.js"
import { armKey, armOptions, preregAgentHash } from "./agent-run.js"
import { OVERLAP_INDEX, openAgentOverlap, directAgentOverlap } from "./agent-overlap-index.js"
import { AnswerStore, appendJsonl, readJsonl, writeJsonAtomic } from "./store.js"
import { finalSimpleAnswers } from "./simple.js"
import { sha256 } from "./text.js"

export const OVERLAP_CUTOFF = "2026-09-24T18:00:00-04:00"
// Frozen against the reviewed Mac BM25 corpus; row count alone is insufficient.
export const OVERLAP_CORPUS_HASH = "62f735923a0b55dacc05212ff8eec2c590c45d1176efb71548af13ebba3fc3f3"
export const OVERLAP_PHASES = [["small", 600], ["mid", 600], ["large", 200], ["large", 600], ["tiny", 600]]
export const agentOverlapDir = (dataDir) => process.env.POC2_AGENT_OVERLAP_DIR ?? join(dataDir, SMOKE ? "agent-overlap-smoke" : "agent-overlap-run")
export const overlapArm = (alias) => ({ cell: "A-agent", id: "A-agent@overlap", alias, index: OVERLAP_INDEX, field: "questions" })
const iso = () => new Date().toISOString()
const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const portable = (text) => String(text).replace(/\r\n/g, "\n")
const hashFile = (path) => sha256(portable(readFileSync(path, "utf8")))

export function overlapSources({ dataDir, corpusHash }) {
    const prereg = readFileSync(new URL("./PREREG-AGENT-OVERLAP.md", import.meta.url), "utf8")
    return {
        mainFingerprint: read(join(dataDir, "run-state.json")).fingerprint,
        corpusHash,
        agentItems: hashFile(new URL("./agent-items.json", import.meta.url)),
        rankerCode: sha256(hashFile(new URL("./agent-overlap-index.js", import.meta.url)) + hashFile(new URL("./text.js", import.meta.url))),
        protocol: PROTOCOL_HASH,
        prereg: preregAgentHash(portable(prereg)),
    }
}

export function overlapStatus({ dataDir, log = console.log, quiet = false }) {
    const dir = agentOverlapDir(dataDir)
    const state = existsSync(join(dir, "state.json")) ? read(join(dir, "state.json")) : {}
    const items = read(new URL("./agent-items.json", import.meta.url)).items
    const records = new Map(read(join(dataDir, "pools.json")).test.map((row) => [row.questionKey, row]))
    const done = finalSimpleAnswers(readJsonl(join(dir, "answers.jsonl")).records)
    const failures = new Map()
    for (const row of readJsonl(join(dir, "answers.jsonl")).records) if (row.type === "answer" && !["ok", "empty", "output_limit"].includes(row.status)) failures.set(row.key, (failures.get(row.key) ?? 0) + 1)
    const arms = {}
    for (const [alias, target] of OVERLAP_PHASES) {
        const count = SMOKE ? Math.min(target, SMOKE.maxItems) : target
        const digest = state.provenance?.digests?.[alias] ?? read(join(dataDir, "run-state.json")).provenance.digests[alias]
        const optsHash = armOptions(overlapArm(alias), state.provenance?.numPredict ?? read(join(dataDir, "run-state.json")).probe?.numPredict ?? 160).optsHash
        const selected = items.slice(0, count)
        const keys = selected.map((item) => armKey(overlapArm(alias), records.get(item.questionKey), digest, optsHash))
        const rows = keys.map((key) => done.get(key)).filter(Boolean)
        arms[`${alias}${target}`] = { done: rows.length, target: count, failedAttempts: keys.reduce((n, key) => n + (failures.get(key) ?? 0), 0), terminalFailures: rows.filter((row) => row.terminalFailure).length, lastSuccessAt: state.lastSuccessAt?.[alias] ?? null }
    }
    const next = OVERLAP_PHASES.find(([alias, target]) => arms[`${alias}${target}`].done < arms[`${alias}${target}`].target)
    const result = { active: state.active ?? null, next: next ? `${next[0]}${next[1]}` : null, arms, lastStop: state.lastStop ?? null }
    if (!quiet) {
        log(`[agent-overlap-status] active ${result.active ?? "none"}; next ${result.next ?? "none"}; last stop ${result.lastStop?.reason ?? "none"}`)
        for (const [phase, arm] of Object.entries(arms)) log(`[agent-overlap-status] ${phase}: ${arm.done}/${arm.target}; failed attempts ${arm.failedAttempts}; terminal ${arm.terminalFailures}; last success ${arm.lastSuccessAt ?? "none"}`)
    }
    return result
}

function querySample(dataDir, records) {
    const saved = readJsonl(join(dataDir, "agent", "answers.jsonl")).records
        .filter((row) => row.cellId === "A-agent" && row.model === "small")
        .flatMap((row) => row.queries ?? [])
    return [...new Set(saved.length ? saved : records.map((row) => row.question))].slice(0, 100)
}

export function checkOverlapIndex({ dataDir, index, records, log = console.log }) {
    if (index.count !== 103368) throw new Error(`expected 103368 BM25 corpus emails, got ${index.count}`)
    if (index.corpusHash !== OVERLAP_CORPUS_HASH) throw new Error(`BM25 corpus content differs from frozen Mac corpus: ${index.corpusHash}`)
    const dbPath = join(dataDir, "corpus.sqlite")
    const queries = querySample(dataDir, records)
    if (!queries.length) throw new Error("no overlap preflight queries")
    for (const query of queries.slice(0, 5)) {
        const fast = index.search(query, 10)
        const direct = directAgentOverlap(dbPath, query, 10)
        if (JSON.stringify(fast) !== JSON.stringify(direct)) throw new Error(`overlap index differs from direct scan for query hash ${sha256(query).slice(0, 12)}`)
    }
    const times = queries.map((query) => {
        const started = performance.now()
        index.search(query, 10)
        return performance.now() - started
    }).sort((a, b) => a - b)
    const p95 = times[Math.ceil(times.length * 0.95) - 1]
    const rss = process.memoryUsage().rss
    log(`[agent-overlap] index preflight: ${index.count} emails, ${queries.length} queries, p95 ${Math.round(p95)} ms, RSS ${Math.round(rss / 1048576)} MiB`)
    if (rss > 1.5 * 1024 ** 3 || p95 > 500) throw new Error("overlap index exceeds frozen memory or search-latency gate")
    return { checkedAt: iso(), queries: queries.length, direct: Math.min(5, queries.length), p95Ms: p95, rssBytes: rss }
}

export async function runAgentOverlap({ dataDir, ollamaUrl = "http://localhost:11434", log = console.log }) {
    if (SMOKE && !process.env.POC2_AGENT_OVERLAP_DIR) throw new Error("set POC2_AGENT_OVERLAP_DIR for smoke runs")
    const stopTime = new Date(SMOKE ? process.env.POC2_AGENT_OVERLAP_SMOKE_STOP_AT ?? OVERLAP_CUTOFF : OVERLAP_CUTOFF).getTime()
    if (Date.now() >= stopTime) throw new Error("agent-overlap generation cutoff has passed")
    const dir = agentOverlapDir(dataDir)
    mkdirSync(dir, { recursive: true })
    if (!process.env.POC2_AGENT_OVERLAP_CHILD && existsSync(join(dataDir, "generation-owner.json"))) throw new Error("another generator owns the GPU; use agent-overlap controller")
    const statePath = join(dir, "state.json")
    if (existsSync(join(dir, "answers.jsonl")) && !existsSync(statePath)) throw new Error("agent-overlap answers exist without state fingerprint; refuse unsafe resume")
    const state = existsSync(statePath) ? read(statePath) : {}
    if (existsSync(join(dir, "answers.jsonl")) && !state.fingerprint) throw new Error("agent-overlap answers exist without a valid state fingerprint; refuse unsafe resume")
    const save = () => writeJsonAtomic(statePath, state)
    const itemsFile = read(new URL("./agent-items.json", import.meta.url))
    const byKey = new Map(read(join(dataDir, "pools.json")).test.map((row) => [row.questionKey, row]))
    const items = itemsFile.items
    const main = read(join(dataDir, "run-state.json"))
    const numPredict = main.probe?.numPredict ?? 160
    const aliases = ["small", "mid", "large", "tiny"]
    const index = openAgentOverlap(join(dataDir, "corpus.sqlite"))
    const emailDbPath = join(dataDir, "agent", "emails.sqlite")
    if (!existsSync(emailDbPath)) throw new Error("existing agent/emails.sqlite missing; copy it from the completed Windows agent run")
    const { DatabaseSync } = await import("node:sqlite")
    const emailDb = new DatabaseSync(emailDbPath, { readOnly: true })
    const emailStmt = emailDb.prepare("SELECT email FROM emails WHERE path = ?")
    const emailOf = (path) => emailStmt.get(path)?.email ?? ""
    const markersPath = join(dir, "markers.jsonl")
    const marker = (kind, extra = {}) => appendJsonl(markersPath, { kind, at: iso(), t: Date.now(), ...extra })
    try {
        const sources = overlapSources({ dataDir, corpusHash: index.corpusHash })
        const preflight = checkOverlapIndex({ dataDir, index, records: items.map((item) => byKey.get(item.questionKey)), log })
        state.preflight = preflight
        let installed, liveVersion
        while (Date.now() < stopTime) {
            try { liveVersion = await version(ollamaUrl); installed = new Map((await tags(ollamaUrl)).map((row) => [row.name, row])); break }
            catch (error) { log(`[agent-overlap] Ollama unavailable: ${error.message}; retrying in 30 s`); await delay(Math.min(30_000, Math.max(1, stopTime - Date.now()))) }
        }
        if (!installed) {
            state.lastStop = { at: iso(), reason: "time", next: overlapStatus({ dataDir, quiet: true }).next }
            state.active = null; save()
            return state.lastStop
        }
        if (!SMOKE && liveVersion !== main.provenance.ollamaVersion) throw new Error("Ollama version differs from the completed study")
        const digests = {}
        for (const alias of aliases) {
            const tag = MODELS[alias].tag
            const digest = installed.get(tag)?.digest
            if (!digest) throw new Error(`Ollama model ${tag} missing`)
            if (!SMOKE && digest !== main.provenance.digests[alias]) throw new Error(`${alias} model digest differs from the completed study`)
            digests[alias] = SMOKE ? `${digest}#overlap-smoke-${alias}` : digest
        }
        const optsHashes = Object.fromEntries(aliases.map((alias) => [alias, armOptions(overlapArm(alias), numPredict).optsHash]))
        const fingerprint = sha256(JSON.stringify({ sources, items: itemsFile.hash, digests, optsHashes, liveVersion }))
        if (state.fingerprint && state.fingerprint !== fingerprint) throw new Error("agent-overlap fingerprint changed; use a fresh sidecar rather than mixing episodes")
        state.fingerprint = fingerprint
        state.sources = sources
        state.provenance = { digests, optsHashes, ollamaVersion: liveVersion, numPredict, itemsHash: itemsFile.hash, startedAt: state.provenance?.startedAt ?? iso(), resumedAt: iso() }
        state.lastSuccessAt ??= {}
        save()
        const store = new AnswerStore(join(dir, "answers.jsonl"))
        if (store.recovered) log(`[agent-overlap] recovered ${store.recovered} torn answer line(s)`)
        let resident = null
        const alive = () => version(ollamaUrl).then(() => true, () => false)
        const ensureModel = async (alias) => {
            if (resident === alias) return true
            while (Date.now() < stopTime) {
                if (!(await alive())) { await delay(Math.min(30_000, Math.max(1, stopTime - Date.now()))); continue }
                try {
                    const current = new Map((await tags(ollamaUrl)).map((row) => [row.name, row.digest]))
                    if (current.get(MODELS[alias].tag) !== installed.get(MODELS[alias].tag).digest) {
                        throw Object.assign(new Error(`model digest changed during ${alias} phase`), { permanent: true })
                    }
                    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
                    marker("load-start", { model: alias })
                    const result = await load(ollamaUrl, MODELS[alias].tag)
                    marker("load-end", { model: alias, ...result })
                    if (result.status !== "ok") throw new Error(`load ${result.status}`)
                    for (let repeat = 0; repeat < 2; repeat++) {
                        const warmup = await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: firstMessage(byKey.get(items[0].questionKey).question), options: generationOptions({ num_predict: 32 }), attempts: 1, timeoutMs: Math.min(120_000, Math.max(1000, stopTime - Date.now())) })
                        if (warmup.status !== "ok") throw new Error(`warmup ${warmup.status}`)
                    }
                    resident = alias
                    marker("model-ready", { model: alias })
                    return true
                } catch (error) {
                    if (error.permanent) throw error
                    resident = null
                    log(`[agent-overlap] ${alias} load unavailable: ${error.message}; retrying in 30 s`)
                    await delay(Math.min(30_000, Math.max(1, stopTime - Date.now())))
                }
            }
            return false
        }
        let newAnswers = 0
        for (const [alias, limit] of OVERLAP_PHASES) {
            const count = SMOKE ? Math.min(limit, SMOKE.maxItems) : limit
            const arm = overlapArm(alias)
            const { options, optsHash } = armOptions(arm, numPredict)
            const selected = items.slice(0, count)
            const keyOf = (item) => armKey(arm, byKey.get(item.questionKey), digests[alias], optsHash)
            const pending = selected.filter((item) => !store.has(keyOf(item)))
            if (!pending.length) { log(`[agent-overlap] ${alias}${limit} already complete`); continue }
            if (Date.now() >= stopTime) break
            state.active = `${alias}${limit}`; save()
            if (!(await ensureModel(alias))) break
            const blockId = `agent-overlap:${state.active}:${iso()}`
            marker("block-start", { blockId, phase: state.active, model: alias, cell: arm.id })
            for (const item of pending) {
                const key = keyOf(item)
                while (!store.has(key) && Date.now() + 2000 < stopTime) {
                    const record = byKey.get(item.questionKey)
                    const startedAt = iso()
                    const episode = await runEpisode({
                        question: record.question,
                        chatTurn: (messages) => chat({ url: ollamaUrl, model: MODELS[alias].tag, messages, options, think: false, attempts: 1, timeoutMs: Math.min(900_000, Math.max(1000, stopTime - Date.now())) }),
                        search: (query, k) => index.search(query, k), emailOf,
                    })
                    if (Date.now() >= stopTime) break
                    if (TRANSIENT_STATUSES.has(episode.status) && !(await alive())) {
                        resident = null
                        marker("ollama-outage", { model: alias, phase: state.active })
                        if (!(await ensureModel(alias))) break
                        continue
                    }
                    store.add({ key, model: alias, tag: MODELS[alias].tag, digest: digests[alias], cellId: arm.id, index: OVERLAP_INDEX, questionKey: item.questionKey, stratum: item.stratum, order: item.order, optionsHash: optsHash, startedAt, finishedAt: iso(), ...episode })
                    newAnswers++
                    if (["ok", "empty", "output_limit"].includes(episode.status)) state.lastSuccessAt[alias] = iso()
                    if (newAnswers % 25 === 0) { save(); marker("checkpoint", { model: alias, phase: state.active, newAnswers }); log(`[agent-overlap] ${state.active}: ${selected.filter((row) => store.has(keyOf(row))).length}/${count}`) }
                }
                if (Date.now() >= stopTime) break
            }
            marker("block-end", { blockId, phase: state.active, model: alias, cell: arm.id })
            log(`[agent-overlap] ${state.active}: ${selected.filter((item) => store.has(keyOf(item))).length}/${count}`)
        }
        state.active = null
        const status = overlapStatus({ dataDir, quiet: true })
        state.lastStop = { at: iso(), reason: status.next ? Date.now() >= stopTime ? "time" : "incomplete" : "complete", next: status.next }
        save()
        log(`[agent-overlap] stopped: ${state.lastStop.reason}; next ${state.lastStop.next ?? "none"}`)
        return state.lastStop
    } catch (error) {
        state.active = null
        state.lastStop = { at: iso(), reason: "error", message: String(error.message).slice(0, 300) }
        save()
        throw error
    } finally { emailDb.close(); index.close() }
}
