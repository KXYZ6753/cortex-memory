// Phase-2 exploration runner: explore/run.js's runExplore with the phase-2 variant
// registry, a GPU lock, and a richer ctx for retrieval-side ideas. Answers go to the
// same store (.data/premise2/explore/answers.jsonl, same keys), so explore/grade.js
// and explore/analyze.js work unchanged.
//
// ctx (in addition to explore/run.js's search / generate / emailOf / emailMap):
//   bm25        the raw FTS5 handle (bm25.search(query, k, user) -> [{ path, ... }])
//   resource    resource(name, loader) loads something once per run (a reranker, dense index)
//   embedQuery  nomic-embed-text query vector on the CPU (num_gpu 0), time counted in auxMs
//   chatRaw     chatRaw(body) POSTs { model, stream: false, options, ...body } to /api/chat
//               (for tools, format, logprobs, raw messages) and returns Ollama's JSON;
//               counted as a model call. Default options are the main run's.
//   dataDir, ollamaUrl, tag

import { join } from "node:path"
import { chat, generationOptions, version, ps, unload, load } from "../ollama.js"
import { openBm25 } from "../bm25.js"
import { ensureEmailStore } from "../agent-run.js"
import { startWakeLock } from "../run.js"
import { embedBatch, QUERY_PREFIX } from "../dense.js"
import { exploreDirOf, loadGuard, assertExplorable, loadPool } from "../explore/pool.js"
import { loadSet } from "../explore/sets.js"
import { ExploreStore, preflight, answerKey, COLD } from "../explore/run.js"
import { NUM_PREDICT } from "../explore/variants.js"
import { loadVariants } from "./registry.js"
import { withLock } from "./lock.js"

async function ensureResident({ ollamaUrl, tag, log }) {
    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
    const loaded = await load(ollamaUrl, tag)
    if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status} ${loaded.error ?? ""}`)
    for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
    log(`[explore2] ${tag} loaded in ${loaded.coldLoadMs} ms`)
}

export async function runExplore2({ dataDir, setName, variants, alias = "small", ollamaUrl = "http://localhost:11434", limit = Infinity, log = console.log }) {
    const VARIANTS = await loadVariants()
    for (const id of variants) if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)
    const pool = loadPool(dataDir)
    const set = loadSet(dataDir, setName, pool)
    const guard = loadGuard(dataDir)
    const records = set.questionKeys.map((key) => pool.byKey.get(key))
    for (const record of records) assertExplorable(record, guard)
    return withLock(dataDir, `run ${setName} ${variants.join(",")}`, async () => {
        const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias, ollamaUrl })
        const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
        const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
        const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
        const resources = new Map()
        const wakeLock = startWakeLock(log)
        try {
            for (const id of variants) {
                const variant = { ...VARIANTS[id], version: `${VARIANTS[id].version}${COLD}` }
                const pending = records.filter((record) => !store.done(answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey }))).slice(0, limit)
                log(`[explore2] ${setName} ${id}@${variant.version} ${alias}: ${pending.length} pending of ${records.length}`)
                if (!pending.length) continue
                await ensureResident({ ollamaUrl, tag, log })
                let count = 0
                let wallSum = 0
                for (const record of pending) {
                    if (count % 25 === 0 && (await version(ollamaUrl)) !== ollamaVersion) throw new Error(`Ollama version changed from ${ollamaVersion} during the run`)
                    const tally = { calls: 0, genMs: 0, promptTokens: 0, outputTokens: 0, maxLoadMs: 0, searchMs: 0, searches: 0, auxMs: 0, statuses: [] }
                    const ctx = {
                        alias, tag, dataDir, ollamaUrl, bm25,
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
                        stratum: record.stratum, user: record.user, wallMs, ...tally, searchMs: Math.round(tally.searchMs), auxMs: Math.round(tally.auxMs),
                        reloaded: tally.maxLoadMs > 1_000, ollamaVersion, phase: 2, at: new Date().toISOString(), ...result,
                    })
                    count++
                    wallSum += wallMs
                    if (count % 50 === 0) log(`[explore2] ${id}: ${count}/${pending.length} (mean ${Math.round(wallSum / count)} ms)`)
                }
                log(`[explore2] ${id}: done ${count} (mean ${Math.round(wallSum / Math.max(count, 1))} ms)`)
            }
        } finally {
            wakeLock?.kill()
            bm25.close()
            emails.close()
            for (const resource of resources.values()) resource?.close?.()
        }
    }, { log })
}
