// Worker p6: several (set, variants) runs under ONE GPU lock turn, with a time budget, so p6's
// many short gold-only and end-to-end chunks do not each wait a full turn of the shared queue.
// The per-question loop, ctx and answer-store records are run2.js's (copied as in a6-batch.js:
// same chat call, options, keys, fields, model load/check). Jobs run in the order given; once
// --minutes of work is used, no new question starts (the rest stays pending; the store resumes).
// Exits without queueing when nothing is pending.
//   node benchmarks/premise2/explore2/tools/p6-batch.js [--minutes 14] S300-4:p6-g4,p6-gqa FULL-2:p6-e4 ...
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { chat, generationOptions, version, ps, unload, load } from "../../ollama.js"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { exploreDirOf, loadGuard, assertExplorable, loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { ExploreStore, preflight, answerKey, COLD } from "../../explore/run.js"
import { NUM_PREDICT } from "../../explore/variants.js"
import { loadVariants } from "../registry.js"
import { withLock } from "../lock.js"

if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const alias = "small"
const ollamaUrl = "http://localhost:11434"
const log = console.log
const argv = process.argv.slice(2)
const minutes = argv.includes("--minutes") ? Number(argv[argv.indexOf("--minutes") + 1]) : 14
const jobArgs = argv.filter((a, i) => a.includes(":") && argv[i - 1] !== "--minutes")
const jobs = jobArgs.map((arg) => { const [set, v] = arg.split(":"); return { set, variants: v.split(",") } })
for (const job of jobs) if (/^(H6-C|DEMO|TEST)/i.test(job.set)) throw new Error(`refusing set ${job.set}`)
const VARIANTS = await loadVariants()
for (const job of jobs) for (const id of job.variants) if (!id.startsWith("p6-") || !VARIANTS[id]) throw new Error(`unknown or foreign variant ${id}`)
const pool = loadPool(dataDir)
const guard = loadGuard(dataDir)
const recordsOf = new Map()
for (const { set } of jobs) {
    if (recordsOf.has(set)) continue
    const records = loadSet(dataDir, set, pool).questionKeys.map((key) => pool.byKey.get(key))
    for (const record of records) assertExplorable(record, guard)
    recordsOf.set(set, records)
}

// dry pending count without touching Ollama: the digest preflight() requires is the main run's
const store0 = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
const digest0 = JSON.parse(readFileSync(join(dataDir, "run-state.json"), "utf8")).provenance.digests[alias]
const tag0 = alias
const pendingOf = (store, digest, set, id) => {
    const v = `${VARIANTS[id].version}${COLD}`
    // gold-only arms skip misses without a call: count hits only for them
    return recordsOf.get(set).filter((r) => !store.done(answerKey({ digest, variant: id, version: v, questionKey: r.questionKey })) && !(VARIANTS[id].diagnostic && id.startsWith("p6-g") && r.stratum !== "hit"))
}
const total = jobs.reduce((s, { set, variants }) => s + variants.reduce((t, id) => t + pendingOf(store0, digest0, set, id).length, 0), 0)
log(`[p6-batch] ${total} pending answers in ${jobs.length} jobs (${tag0})`)
if (!total) process.exit(0)

async function ensureResident(tag) {
    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
    const loaded = await load(ollamaUrl, tag)
    if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status} ${loaded.error ?? ""}`)
    for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
    log(`[p6-batch] ${tag} loaded in ${loaded.coldLoadMs} ms`)
}

await withLock(dataDir, `p6-batch ${jobArgs.join(" ")}`, async () => {
    const t0 = performance.now()
    const budget = () => performance.now() - t0 < minutes * 60_000
    const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias, ollamaUrl })
    const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
    const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
    const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
    const resources = new Map()
    let resident = false
    try {
        for (const { set: setName, variants } of jobs) {
            for (const id of variants) {
                if (!budget()) break
                const variant = { ...VARIANTS[id], version: `${VARIANTS[id].version}${COLD}` }
                const pending = recordsOf.get(setName).filter((record) => !store.done(answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey })))
                if (!pending.length) continue
                log(`[p6-batch] ${setName} ${id}@${variant.version}: ${pending.length} pending`)
                if (!resident) { await ensureResident(tag); resident = true }
                let count = 0, wallSum = 0
                for (const record of pending) {
                    if (!budget()) break
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
                        embedQuery: async () => { throw new Error("embedQuery not available in p6-batch") },
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
                }
                log(`[p6-batch] ${setName} ${id}: ${count} answered (mean ${Math.round(wallSum / Math.max(count, 1))} ms)`)
            }
        }
        log(`[p6-batch] used ${Math.round((performance.now() - t0) / 1000)} s`)
    } finally {
        bm25.close()
        emails.close()
        for (const resource of resources.values()) resource?.close?.()
    }
}, { log })
