// v6 (aux): locked runner for v6's det test. Reproduces explore2/run2.js runExplore2's loop (same ctx,
// same generation options, same answer store, keys and record shape; e2b "small" only, preflight and
// residency exactly as run2.js), with two differences: --hits sends only hit-stratum questions, and
// each withLock() job is time-boxed (--minutes, default 14) across several sets, so the whole test
// needs few queue slots. Refuses H6-C, DEMO-*, TEST*.
//   node benchmarks/premise2/explore2/tools/v6-run.js <set[,set]> <variant> [--hits] [--minutes 14] [--limit N]
import { join } from "node:path"
import { appendFileSync } from "node:fs"
import { chat, generationOptions, version, ps, unload, load } from "../../ollama.js"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { startWakeLock } from "../../run.js"
import { embedBatch, QUERY_PREFIX } from "../../dense.js"
import { exploreDirOf, loadGuard, assertExplorable, loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { ExploreStore, preflight, answerKey, COLD } from "../../explore/run.js"
import { NUM_PREDICT } from "../../explore/variants.js"
import { loadVariants } from "../registry.js"
import { withLock } from "../lock.js"

const ollamaUrl = "http://localhost:11434"
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
const [setsArg, id] = args
const hitsOnly = args.includes("--hits")
const minutes = Number(flag("--minutes", 14))
const limit = Number(flag("--limit", Infinity))
const runLog = join(dataDir, "explore", "v6-runs.jsonl")
const log = (m) => console.log(`${new Date().toISOString()} ${m}`)

const setNames = setsArg.split(",")
for (const s of setNames) if (/^(H6-C|DEMO|TEST)/i.test(s)) throw new Error(`v6-run: set ${s} is off limits`)
const VARIANTS = await loadVariants()
if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)
const pool = loadPool(dataDir)
const guard = loadGuard(dataDir)
const items = []
for (const setName of setNames) {
    const set = loadSet(dataDir, setName, pool)
    for (const key of set.questionKeys) {
        const record = pool.byKey.get(key)
        assertExplorable(record, guard)
        if (hitsOnly && record.stratum !== "hit") continue
        items.push({ setName, record })
    }
}

async function ensureResident(tag) {
    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
    const loaded = await load(ollamaUrl, tag)
    if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status} ${loaded.error ?? ""}`)
    for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
    log(`[v6-run] ${tag} loaded in ${loaded.coldLoadMs} ms`)
}

let made = 0
for (;;) {
    const summary = await withLock(dataDir, `v6-run ${setNames.join(",")} ${id}${hitsOnly ? " hits" : ""}`, async () => {
        const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias: "small", ollamaUrl })
        const alias = "small"
        const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
        const variant = { ...VARIANTS[id], version: `${VARIANTS[id].version}${COLD}` }
        const pending = items.filter(({ record }) => !store.done(answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey }))).slice(0, Math.max(0, limit - made))
        log(`[v6-run] ${id}@${variant.version}: ${pending.length} pending`)
        if (!pending.length) return { count: 0, left: 0 }
        const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
        const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
        const resources = new Map()
        const wakeLock = startWakeLock(log)
        const t0 = Date.now()
        let count = 0, wallSum = 0
        const perSet = {}
        try {
            await ensureResident(tag)
            for (const { setName, record } of pending) {
                if (Date.now() - t0 > minutes * 60_000) break
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
                perSet[setName] = (perSet[setName] ?? 0) + 1
                if (count % 100 === 0) log(`[v6-run] ${id}: ${count}/${pending.length} (mean ${Math.round(wallSum / count)} ms)`)
            }
        } finally {
            wakeLock?.kill()
            bm25.close()
            emails.close()
            for (const resource of resources.values()) resource?.close?.()
        }
        const s = { at: new Date().toISOString(), variant: id, version: variant.version, sets: perSet, count, meanWallMs: Math.round(wallSum / Math.max(1, count)), lockSeconds: Math.round((Date.now() - t0) / 1000), left: pending.length - count }
        appendFileSync(runLog, JSON.stringify(s) + "\n")
        log(`[v6-run] chunk done ${JSON.stringify(s)}`)
        return s
    }, { log })
    made += summary.count
    if (!summary.count || summary.left <= 0 || made >= limit) break
}
log(`[v6-run] finished: ${made} answers`)
