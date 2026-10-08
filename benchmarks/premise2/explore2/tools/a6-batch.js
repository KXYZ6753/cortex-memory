// Worker a6: several (set, variants) runs under ONE GPU lock (explore2/lock.js withLock), so
// short replay jobs do not each wait a full turn of the shared queue. The per-question
// loop, ctx and store records are run2.js's (same chat call, options, keys, fields); only
// the lock is taken once around all jobs. The a6 replay variants read the set name from
// A6_SET, which is set per job. Keep the whole batch under ~15 min.
// A job with an a6-*-pkg variant runs only if variants/a6-final.json says "go": true at the
// moment the job starts (so a decision-set run can wait in the queue and still be cancelled).
//   node benchmarks/premise2/explore2/tools/a6-batch.js S300-4:a6-rg-dec,a6-rg-plist S300-5:a6-rq-dec ...
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
const jobs = process.argv.slice(2).map((arg) => { const [set, v] = arg.split(":"); return { set, variants: v.split(",") } })
const VARIANTS = await loadVariants()
for (const job of jobs) for (const id of job.variants) if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)
const pool = loadPool(dataDir)
const guard = loadGuard(dataDir)

async function ensureResident(tag) {
    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
    const loaded = await load(ollamaUrl, tag)
    if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status} ${loaded.error ?? ""}`)
    for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
    log(`[a6-batch] ${tag} loaded in ${loaded.coldLoadMs} ms`)
}

await withLock(dataDir, `a6-batch ${process.argv.slice(2).join(" ")}`, async () => {
    const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias, ollamaUrl })
    const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
    const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
    const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
    let resident = false
    try {
        for (const { set: setName, variants } of jobs) {
            process.env.A6_SET = setName
            if (variants.some((id) => id.endsWith("-pkg"))) {
                const cfg = JSON.parse(readFileSync(new URL("../variants/a6-final.json", import.meta.url), "utf8"))
                if (cfg.go !== true) { log(`[a6-batch] ${setName} ${variants.join(",")}: a6-final.json has no "go": true, skipped`); continue }
                log(`[a6-batch] ${setName}: a6-final.json ${JSON.stringify(cfg)}`)
            }
            const set = loadSet(dataDir, setName, pool)
            const records = set.questionKeys.map((key) => pool.byKey.get(key))
            for (const record of records) assertExplorable(record, guard)
            const resources = new Map()
            for (const id of variants) {
                const variant = { ...VARIANTS[id], version: `${VARIANTS[id].version}${COLD}` }
                const pending = records.filter((record) => !store.done(answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey })))
                log(`[a6-batch] ${setName} ${id}@${variant.version}: ${pending.length} pending of ${records.length}`)
                if (!pending.length) continue
                if (!resident) { await ensureResident(tag); resident = true }
                let count = 0, wallSum = 0
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
                        embedQuery: async () => { throw new Error("embedQuery not available in a6-batch") },
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
                log(`[a6-batch] ${setName} ${id}: done ${count} (mean ${Math.round(wallSum / Math.max(count, 1))} ms)`)
            }
        }
    } finally {
        bm25.close()
        emails.close()
    }
}, { log })
