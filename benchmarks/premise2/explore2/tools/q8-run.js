// Worker q8 (round 6): locked runner for the precision diagnostic.
//
//   node benchmarks/premise2/explore2/tools/q8-run.js <set[,set]> <variant[,variant]> --model q8|q4
//        [--hits] [--minutes 12] [--limit N] [--dry]
//
// Reproduces explore2/run2.js runExplore2's loop (same ctx: search / generate / chatRaw /
// resource / embedQuery / emailOf, same generation options, same answer-store record and
// key), with the model chosen by --model instead of a study alias:
//   q4  gemma4:e2b-it-qat (the study's e2b, Q4_0 QAT), alias "small"; digest checked against
//       the main run's provenance (explore/run.js preflight), exactly as run2.js does.
//   q8  gemma4:e2b-it-q8_0 (Q8_0), alias label "small-q8"; its own digest from /api/tags,
//       pinned in .data/premise2/explore/q8-pin.json on first use and required to match after.
//       Also required: the same Ollama build as the main run, quantization Q8_0, family
//       gemma4, and the same TEMPLATE / RENDERER / PARSER / PARAMETER lines as the Q4 model
//       (so the prompts the model sees are rendered identically).
// Answer keys are sha256(digest | variant@version | questionKey) (explore/run.js answerKey),
// so Q8 answers can never collide with or overwrite Q4 answers, and every record carries
// alias "small-q8" and tag.
//
// GPU discipline: every chunk is its own withLock() job (explore2/lock.js) of at most
// --minutes (default 12) of generation, so other workers interleave. Inside the lock:
// unload whatever is resident and load the tag (as run2.js ensureResident does), record
// /api/ps (size vs size_vram = CPU offload), run, and for q8 unload the Q8 model at the end
// (it is only this worker's model). Chunk summaries go to .data/premise2/explore/q8-runs.jsonl.
// --hits sends only hit-stratum questions. --limit caps new answers per variant (smoke tests).
// --dry prints pending counts only (no lock, no GPU). Refuses H6-C, DEMO-*, TEST*, and 31b.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chat, generationOptions, version, tags, ps, unload, load } from "../../ollama.js"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { startWakeLock } from "../../run.js"
import { embedBatch, QUERY_PREFIX } from "../../dense.js"
import { MODELS } from "../../cells.js"
import { exploreDirOf, loadGuard, assertExplorable, loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { ExploreStore, preflight, answerKey, COLD } from "../../explore/run.js"
import { NUM_PREDICT } from "../../explore/variants.js"
import { loadVariants } from "../registry.js"
import { withLock } from "../lock.js"

export const Q8_TAG = "gemma4:e2b-it-q8_0"
export const Q8_ALIAS = "small-q8"
const ollamaUrl = "http://localhost:11434"
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const pinPath = join(dataDir, "explore", "q8-pin.json")
const runsPath = join(dataDir, "explore", "q8-runs.jsonl")

async function showRaw(tag) {
    const response = await fetch(`${ollamaUrl}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: tag }), signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`/api/show ${tag}: HTTP ${response.status}`)
    return response.json()
}
// Modelfile lines that shape the rendered prompt or decoding defaults (everything but FROM).
const renderLines = (data) => String(data.modelfile ?? "").split("\n").map((line) => line.trim()).filter((line) => /^(TEMPLATE|RENDERER|PARSER|PARAMETER|SYSTEM)\b/.test(line)).sort()

export async function preflightQ8() {
    const main = JSON.parse(readFileSync(join(dataDir, "run-state.json"), "utf8")).provenance
    const v = await version(ollamaUrl)
    if (v !== main.ollamaVersion) throw new Error(`Ollama ${v} differs from the main run's ${main.ollamaVersion}`)
    const installed = new Map((await tags(ollamaUrl)).map((model) => [model.name, model.digest]))
    const digest = installed.get(Q8_TAG)
    if (!digest) throw new Error(`${Q8_TAG} is not installed`)
    const [q8, q4] = [await showRaw(Q8_TAG), await showRaw(MODELS.small.tag)]
    if (q8.details?.quantization_level !== "Q8_0") throw new Error(`${Q8_TAG} quantization is ${q8.details?.quantization_level}`)
    if (q8.details?.family !== "gemma4") throw new Error(`${Q8_TAG} family is ${q8.details?.family}`)
    const a = renderLines(q8)
    const b = renderLines(q4)
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${Q8_TAG} modelfile render lines differ from ${MODELS.small.tag}:\n${a.join("\n")}\nvs\n${b.join("\n")}`)
    const facts = {
        tag: Q8_TAG, digest, ollamaVersion: v, details: q8.details, renderLines: a,
        parameterCount: q8.model_info?.["general.parameter_count"] ?? null, fileType: q8.model_info?.["general.file_type"] ?? null,
        q4: { tag: MODELS.small.tag, digest: main.digests.small, details: q4.details, parameterCount: q4.model_info?.["general.parameter_count"] ?? null },
    }
    if (existsSync(pinPath)) {
        const pin = JSON.parse(readFileSync(pinPath, "utf8"))
        if (pin.digest !== digest) throw new Error(`${Q8_TAG} digest ${digest} differs from the pinned ${pin.digest} (${pinPath})`)
    } else writeFileSync(pinPath, JSON.stringify({ ...facts, pinnedAt: new Date().toISOString() }, null, 2))
    return { tag: Q8_TAG, digest, ollamaVersion: v, alias: Q8_ALIAS, facts }
}

async function preflightOf(model) {
    if (model === "q8") return preflightQ8()
    if (model === "q4") return { ...(await preflight({ dataDir, alias: "small", ollamaUrl })), alias: "small" }
    throw new Error(`--model ${model}: use q8 or q4`)
}

async function ensureResident(tag, log) {
    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
    const loaded = await load(ollamaUrl, tag)
    if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status} ${loaded.error ?? ""}`)
    for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: generationOptions({ num_predict: 8 }) })
    const resident = (await ps(ollamaUrl)).map((m) => ({ name: m.name, size: m.size, size_vram: m.size_vram, context_length: m.context_length }))
    log(`[q8-run] ${tag} loaded in ${loaded.coldLoadMs} ms; resident ${JSON.stringify(resident)}`)
    return { coldLoadMs: loaded.coldLoadMs, resident }
}

// One locked chunk: at most `minutes` of generation and `cap` new answers for one variant.
// items: [{ setName, record }] across the requested sets, in order.
async function runChunk({ model, items, id, VARIANTS, minutes, cap, log }) {
    const setNames = [...new Set(items.map((item) => item.setName))]
    return withLock(dataDir, `q8-run ${model} ${setNames.join(",")} ${id}`, async () => {
        const { tag, digest, ollamaVersion, alias } = await preflightOf(model)
        const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
        const variant = { ...VARIANTS[id], version: `${VARIANTS[id].version}${COLD}` }
        const pending = items.filter(({ record }) => !store.done(answerKey({ digest, variant: id, version: variant.version, questionKey: record.questionKey }))).slice(0, cap)
        log(`[q8-run] ${setNames.join(",")} ${id}@${variant.version} ${alias} (${tag}): ${pending.length} to do in this chunk`)
        if (!pending.length) return { made: 0 }
        const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
        const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
        const resources = new Map()
        const wakeLock = startWakeLock(log)
        const chunkStarted = Date.now()
        let count = 0
        let wallSum = 0
        let residency = null
        const perSet = {}
        try {
            residency = await ensureResident(tag, log)
            for (const { setName, record } of pending) {
                if (Date.now() - chunkStarted > minutes * 60_000) break
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
                    variant: id, version: variant.version, alias, digest, tag, set: setName, questionKey: record.questionKey,
                    stratum: record.stratum, user: record.user, wallMs, ...tally, searchMs: Math.round(tally.searchMs), auxMs: Math.round(tally.auxMs),
                    reloaded: tally.maxLoadMs > 1_000, ollamaVersion, phase: 2, worker: "q8", at: new Date().toISOString(), ...result,
                })
                count++
                wallSum += wallMs
                perSet[setName] = (perSet[setName] ?? 0) + 1
                if (count % 50 === 0) log(`[q8-run] ${id} ${model}: ${count}/${pending.length} (mean ${Math.round(wallSum / count)} ms)`)
            }
        } finally {
            wakeLock?.kill()
            bm25.close()
            emails.close()
            for (const resource of resources.values()) resource?.close?.()
            if (model === "q8") await unload(ollamaUrl, tag)
        }
        const summary = { at: new Date().toISOString(), model, tag, digest, alias, sets: perSet, variant: id, version: variant.version, made: count, meanWallMs: Math.round(wallSum / Math.max(count, 1)), chunkSeconds: Math.round((Date.now() - chunkStarted) / 1000), coldLoadMs: residency?.coldLoadMs ?? null, resident: residency?.resident ?? null }
        appendFileSync(runsPath, JSON.stringify(summary) + "\n")
        log(`[q8-run] ${id} ${model}: chunk done ${count} ${JSON.stringify(perSet)} (mean ${summary.meanWallMs} ms, ${summary.chunkSeconds} s in lock)`)
        return summary
    }, { log })
}

async function main() {
    const args = process.argv.slice(2)
    const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
    const [setList, variantList] = args
    const model = opt("model")
    const minutes = Number(opt("minutes", "12"))
    const limit = Number(opt("limit", "Infinity"))
    const hitsOnly = args.includes("--hits")
    const dry = args.includes("--dry")
    const log = (line) => console.log(`${new Date().toISOString()} ${line}`)
    if (!setList || !variantList || !model) throw new Error("usage: q8-run.js <set[,set]> <variant[,variant]> --model q8|q4 [--hits] [--minutes 12] [--limit N] [--dry]")
    if (!["q8", "q4"].includes(model)) throw new Error(`--model ${model}: use q8 or q4 (31b and others are refused)`)
    const VARIANTS = await loadVariants()
    const variants = variantList.split(",").filter(Boolean)
    for (const id of variants) {
        if (!VARIANTS[id]) throw new Error(`unknown variant ${id}`)
        if (!id.startsWith("q8-")) throw new Error(`variant ${id}: this runner only runs worker q8's own variants`)
    }
    const pool = loadPool(dataDir)
    const guard = loadGuard(dataDir)
    // All requested sets' questions in one list, so a chunk spans sets (fewer lock waits).
    const items = []
    for (const setName of setList.split(",").filter(Boolean)) {
        if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(setName)) throw new Error(`set ${setName} is not a development set; refused`)
        const set = loadSet(dataDir, setName, pool)
        const records = set.questionKeys.map((key) => pool.byKey.get(key)).filter((record) => !hitsOnly || record.stratum === "hit")
        for (const record of records) assertExplorable(record, guard)
        items.push(...records.map((record) => ({ setName, record })))
    }
    for (const id of variants) {
        const pendingCount = async () => {
            const { digest } = await preflightOf(model)
            const store = new ExploreStore(join(exploreDirOf(dataDir), "answers.jsonl"))
            const v = `${VARIANTS[id].version}${COLD}`
            const left = items.filter(({ record }) => !store.done(answerKey({ digest, variant: id, version: v, questionKey: record.questionKey })))
            const bySet = {}
            for (const { setName } of left) bySet[setName] = (bySet[setName] ?? 0) + 1
            return { n: left.length, bySet }
        }
        let { n: left, bySet } = await pendingCount()
        log(`[q8-run] ${id} --model ${model}${hitsOnly ? " (hits)" : ""}: ${left} pending of ${items.length} ${JSON.stringify(bySet)}`)
        if (dry) continue
        let budget = limit
        while (left > 0 && budget > 0) {
            const summary = await runChunk({ model, items, id, VARIANTS, minutes, cap: budget, log })
            const after = (await pendingCount()).n
            const made = left - after
            if (made <= 0 && !summary.made) { log(`[q8-run] no progress (technical failures at their retry cap?); stopping ${id}`); break }
            budget -= summary.made ?? made
            left = after
        }
    }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
    main().catch((error) => { console.error(error); process.exitCode = 1 })
}
