// Exploration runner: one resumable pass of (variant × set question) for one model.
//
// Same weights, Ollama build and generation options as the main study (checked
// against run-state.json provenance). Every answer is appended to
// .data/premise2/explore/answers.jsonl under a key of model digest, variant id and
// version, and question; a rerun skips finished keys and retries technical failures.
// Wall time per question covers the whole pipeline (live BM25 search included).

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chat, generationOptions, version, tags, ps, unload, load } from "../ollama.js"
import { openBm25 } from "../bm25.js"
import { ensureEmailStore } from "../agent-run.js"
import { MODELS } from "../cells.js"
import { startWakeLock } from "../run.js"
import { sha256 } from "../text.js"
import { exploreDirOf, loadGuard, assertExplorable, loadPool } from "./pool.js"
import { loadSet } from "./sets.js"
import { VARIANTS, NUM_PREDICT } from "./variants.js"

export const FINAL_STATUSES = new Set(["ok", "output_limit", "empty", "context_overflow"])
const MAX_ATTEMPTS = 3

// Ollama reuses cached prompt prefixes across requests, and a cached evaluation can
// change a temperature-0 answer (about 1-4 in 100 here). Since answer-store version
// "+cold", the model is reloaded before every variant so no variant sees another's
// cached prompts; the suffix keeps those answers apart from earlier ones.
export const COLD = "+cold"
export const answerKey = ({ digest, variant, version: v, questionKey }) => sha256(`${digest}|${variant}@${v}|${questionKey}`)

export function readJsonl(path) {
    if (!existsSync(path)) return []
    return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)] } catch { return [] }
    })
}

export class ExploreStore {
    constructor(path) {
        this.path = path
        this.byKey = new Map()
        this.attempts = new Map()
        for (const record of readJsonl(path)) {
            if (FINAL_STATUSES.has(record.status)) this.byKey.set(record.key, record)
            else this.attempts.set(record.key, (this.attempts.get(record.key) ?? 0) + 1)
        }
    }
    done(key) { return this.byKey.has(key) || (this.attempts.get(key) ?? 0) >= MAX_ATTEMPTS }
    add(record) {
        appendFileSync(this.path, JSON.stringify(record) + "\n")
        if (FINAL_STATUSES.has(record.status)) this.byKey.set(record.key, record)
        else this.attempts.set(record.key, (this.attempts.get(record.key) ?? 0) + 1)
    }
}

export async function preflight({ dataDir, alias, ollamaUrl }) {
    const main = JSON.parse(readFileSync(join(dataDir, "run-state.json"), "utf8")).provenance
    const v = await version(ollamaUrl)
    if (v !== main.ollamaVersion) throw new Error(`Ollama ${v} differs from the main run's ${main.ollamaVersion}`)
    const installed = new Map((await tags(ollamaUrl)).map((model) => [model.name, model.digest]))
    const tag = MODELS[alias].tag
    const digest = installed.get(tag)
    if (!digest) throw new Error(`${tag} is not installed`)
    if (digest !== main.digests[alias]) throw new Error(`${tag} digest ${digest} differs from the main run's ${main.digests[alias]}`)
    return { tag, digest, ollamaVersion: v }
}

async function ensureResident({ ollamaUrl, tag, log, fresh = false }) {
    const resident = await ps(ollamaUrl)
    if (!fresh && resident.length === 1 && resident[0].name === tag && resident[0].context_length === generationOptions().num_ctx) return
    for (const model of resident) await unload(ollamaUrl, model.name)
    const loaded = await load(ollamaUrl, tag)
    if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status} ${loaded.error ?? ""}`)
    for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
    log(`[explore] ${tag} loaded in ${loaded.coldLoadMs} ms`)
}

export async function runExplore({ dataDir, setName, variants, alias = "small", ollamaUrl = "http://localhost:11434", limit = Infinity, log = console.log }) {
    for (const id of variants) if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)
    const pool = loadPool(dataDir)
    const set = loadSet(dataDir, setName, pool)
    const guard = loadGuard(dataDir)
    const records = set.questionKeys.map((key) => pool.byKey.get(key))
    for (const record of records) assertExplorable(record, guard)
    const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias, ollamaUrl })
    const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
    const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
    const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
    const wakeLock = startWakeLock(log)
    try {
        for (const id of variants) {
            const variant = { ...VARIANTS[id], version: `${VARIANTS[id].version}${COLD}` }
            const pending = records.filter((record) => !store.done(answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey }))).slice(0, limit)
            log(`[explore] ${setName} ${id}@${variant.version} ${alias}: ${pending.length} pending of ${records.length}`)
            if (pending.length) await ensureResident({ ollamaUrl, tag, log, fresh: true })
            let count = 0
            let wallSum = 0
            for (const record of pending) {
                // An Ollama update restarts the server mid-run; never generate on another build.
                if (count % 25 === 0 && (await version(ollamaUrl)) !== ollamaVersion) throw new Error(`Ollama version changed from ${ollamaVersion} during the run`)
                const tally = { calls: 0, genMs: 0, promptTokens: 0, outputTokens: 0, maxLoadMs: 0, searchMs: 0, searches: 0, statuses: [] }
                const ctx = {
                    alias, tag,
                    emailOf: emails.emailOf,
                    emailMap: { get: emails.emailOf },
                    search: async (query, k, user = null) => {
                        const started = performance.now()
                        const paths = bm25.search(query, k, user).map((hit) => hit.path)
                        tally.searchMs += performance.now() - started
                        tally.searches++
                        return paths
                    },
                    generate: async ({ prompt, messages, options, think = false }) => {
                        const result = await chat({ url: ollamaUrl, model: tag, prompt, messages, options: options ?? generationOptions({ num_predict: NUM_PREDICT }), think })
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
                    key: answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey }),
                    variant: id, version: variant.version, alias, digest, set: setName, questionKey: record.questionKey,
                    stratum: record.stratum, user: record.user, wallMs, ...tally, searchMs: Math.round(tally.searchMs),
                    reloaded: tally.maxLoadMs > 1_000, ollamaVersion, at: new Date().toISOString(), ...result,
                })
                count++
                wallSum += wallMs
                if (count % 25 === 0) log(`[explore] ${id}: ${count}/${pending.length} (mean ${Math.round(wallSum / count)} ms)`)
            }
        }
    } finally {
        wakeLock?.kill()
        bm25.close()
        emails.close()
    }
}
