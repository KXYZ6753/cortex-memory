// Generation-free preparation (runs on the Mac). Produces everything the Windows
// run needs: question pools, frozen retrieval lists, contexts, prompts for every
// cell and every E* candidate, and a manifest. Nothing here depends on a generator.

import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs"
import { join } from "node:path"
import { loadRaw, buildCorpus, splitMailboxes, buildPools, loadV1Pilot, HF_FILES, CORPUS_MAX_CHARS } from "./dataset.js"
import { buildBm25Index, Bm25Pool } from "./bm25.js"
import { loadDense, readJson, writeJson, EMBED_MODEL } from "./dense.js"
import { loadReranker, RERANK_MODEL } from "./rerank.js"
import { EvidenceCache, documentFrequency, findTwins } from "./evidence.js"
import { retrieveRecords, rerankRecords, chooseRStar, ranksFor, LIST_DEPTH } from "./retrieve.js"
import { hardDistractors, randomDistractors, distractorContext, retrievalContext } from "./contexts.js"
import { buildPrompt, promptRecord, TOKEN_CAP, TEMPLATE_HASH } from "./prompts.js"
import { REPRESENTATION_VERSION } from "./represent.js"
import { MODELS, RUNTIME, JUDGES, BASELINE, engineeredConfigs, testCells, bridgeCells, LARGE_TIME_RULE_ORDER, LARGE_INTERLEAVE } from "./cells.js"
import { sha256 } from "./text.js"

const QUOTAS = { dev: 400, test: 960, testCapPerMailbox: 8, retrieval: 2000 }
const RERANK_RETRIEVAL_SUBSET = 500

export async function prepare({ dataDir, seed = 20260922, log = console.log }) {
    const hf = join(dataDir, "hf")
    mkdirSync(dataDir, { recursive: true })
    const t0 = performance.now()
    const raw = await loadRaw(hf)
    const { docs, dropped } = buildCorpus(raw.corpus)
    const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
    const corpusPaths = new Set(docs.map((doc) => doc.path))
    log(`[prepare] loaded ${raw.test.length} QA rows and ${raw.corpus.length} corpus emails (${dropped.length} over ${CORPUS_MAX_CHARS} chars dropped) in ${Math.round(performance.now() - t0)} ms`)

    const mailboxes = splitMailboxes(raw.test, seed)
    log(`[prepare] mailboxes: ${mailboxes.tuning.size} tuning, ${mailboxes.evaluation.size} evaluation`)

    const dbPath = join(dataDir, "corpus.sqlite")
    if (!existsSync(dbPath)) {
        buildBm25Index(docs, dbPath)
        log("[prepare] BM25 index built")
    }
    const bm25Pool = new Bm25Pool(dbPath)
    const evidence = new EvidenceCache(emailByPath)
    const df = documentFrequency(docs)
    const v1Paths = loadV1Pilot(new URL("./v1-pilot-questions.json", import.meta.url))

    const twinCache = new Map()
    const twinsOf = async (path) => {
        if (!twinCache.has(path)) twinCache.set(path, await findTwins(path, { cache: evidence, df, search: (query, k) => bm25Pool.search(query, k) }))
        return twinCache.get(path)
    }
    const pools = await buildPools({ raw, corpusPaths, mailboxes, v1Paths, seed, quotas: QUOTAS, twinsOf, emailByPath })
    log(`[prepare] pools: dev ${pools.dev.length}, test ${pools.test.length}, retrieval ${pools.retrieval.length}; exclusions ${JSON.stringify(pools.exclusions)}`)

    // V1's own 100 questions, for the bridge replay only.
    const v1Keys = JSON.parse(readFileSync(new URL("./v1-pilot-questions.json", import.meta.url), "utf8")).questionKeys
    const testByPath = new Map(raw.test.map((row) => [row.path, row]))
    const bridge = v1Keys.map((key) => {
        const [path, index] = key.split("#")
        const row = testByPath.get(path)
        const q = Number(index)
        return {
            questionKey: `v1:${key}`, split: "test", path, user: row.user, questionIndex: q,
            question: row.questions[q], rephrased: row.rephrased_questions?.[q] ?? null, gold: row.gold_answers[q],
            alternates: row.alternate_answers?.[q] ?? [], incorrect: row.incorrect_answers?.[q] ?? [], rationale: row.gold_rationales?.[q] ?? null, twins: [],
        }
    })

    const densePath = join(dataDir, "dense.f32")
    const denseDocs = readJson(join(dataDir, "dense-docs.json"))
    if (!existsSync(densePath)) throw new Error("dense index missing: run the embed stage first")
    const dense = loadDense(densePath, denseDocs.paths, denseDocs.users)

    const generationRecords = [...pools.dev, ...pools.test]
    const allRecords = [...generationRecords, ...pools.retrieval]
    const lists = await retrieveRecords(allRecords, { bm25Pool, dense, field: "questions", scopes: ["global", "user"], log })
    const rephrased = await retrieveRecords(allRecords.filter((record) => record.rephrased), { bm25Pool, dense, field: "rephrased", scopes: ["global"], log })
    for (const [key, entry] of rephrased) Object.assign(lists.get(key), entry)

    const reranker = await loadReranker(join(dataDir, "..", "models"))
    await rerankRecords([...generationRecords, ...pools.retrieval.slice(0, RERANK_RETRIEVAL_SUBSET)], lists, { reranker, emailByPath, log })
    await reranker.dispose()

    const { rStar, results: rStarResults } = chooseRStar(pools.dev, lists, evidence)
    log(`[prepare] R* = ${rStar} ${JSON.stringify(rStarResults)}`)

    // Ranks for every stored list: strict (gold), relaxed (gold or twin), answer-bearing.
    const retrievalOut = createWriteStream(join(dataDir, "retrieval.jsonl"))
    for (const record of allRecords) {
        const entry = lists.get(record.questionKey)
        const ranks = {}
        for (const [key, list] of Object.entries(entry)) {
            if (!Array.isArray(list)) continue
            ranks[key] = ranksFor(record, list.slice(0, LIST_DEPTH), evidence)
        }
        const slim = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, LIST_DEPTH).map((hit) => hit.path) : value]))
        retrievalOut.write(JSON.stringify({ questionKey: record.questionKey, pool: pools.dev.includes(record) ? "dev" : pools.test.includes(record) ? "test" : "retrieval", user: record.user, ranks, lists: slim }) + "\n")
    }
    await new Promise((resolve) => retrievalOut.end(resolve))

    // ---- contexts and prompts ----
    const prompts = new Map()
    const addPrompt = (text) => {
        const record = promptRecord(text)
        if (!prompts.has(record.sha)) prompts.set(record.sha, record)
        return record
    }
    const distractorCache = new Map()
    const distractorsFor = (record, type, count) => {
        const key = `${record.questionKey}|${type}`
        if (!distractorCache.has(key)) {
            distractorCache.set(key, type === "hard"
                ? hardDistractors(record, lists.get(record.questionKey)["bm25|global|questions"], { evidence, emailByPath, count: 9 })
                : { picked: randomDistractors(record, docs, { evidence, seed, count: 4 }), excluded: null })
        }
        const { picked, excluded } = distractorCache.get(key)
        return { picked: picked.slice(0, count), excluded }
    }

    const itemFor = (record, index, spec) => {
        const question = spec.retrieval?.field === "rephrased" ? record.rephrased ?? record.question : record.question
        let paths = []
        const meta = {}
        if (spec.arm === "oracle") paths = [record.path]
        else if (spec.arm === "floor") paths = []
        else if (spec.arm === "dist") {
            const { picked, excluded } = distractorsFor(record, spec.distractor.type, spec.distractor.count)
            if (picked.length < spec.distractor.count) meta.distractorShortfall = spec.distractor.count - picked.length
            // Offset by density, not type: hard-4 and random-4 share gold positions (so the
            // hard-vs-random contrast is position-controlled) while 4 and 9 differ.
            const context = distractorContext(record, index, picked, spec.distractor.count)
            paths = context.paths
            Object.assign(meta, { goldPosition: context.goldPosition, goldBucket: context.goldBucket, distractors: picked, excluded })
        } else if (spec.arm === "retr") {
            const { method, k, order, scope, field } = spec.retrieval
            const entry = lists.get(record.questionKey)
            // The adaptive gate is defined on cross-encoder scores, so a "gate" config
            // always reads the MiniLM-reranked version of its method's list.
            const effective = k === "gate" && !method.endsWith("+rr") ? `${method}+rr` : method
            const listKey = `${effective}|${scope}|${field}`
            const ranked = (entry[listKey] ?? []).map((hit) => (typeof hit === "string" ? hit : hit.path))
            if (!ranked.length) meta.missingList = listKey
            const gateK = entry[`${effective.endsWith("+rr") ? effective : `${effective}+rr`}|global|questions:gateK`] ?? 5
            const context = retrievalContext(ranked, { k, order, gateK })
            paths = context.paths
            const ranks = ranksFor(record, ranked.slice(0, context.k).map((path) => ({ path })), evidence)
            Object.assign(meta, { k: context.k, goldInContext: paths.includes(record.path), ...ranks })
        }
        const text = buildPrompt({ question, paths, representation: spec.representation, template: spec.template, variant: spec.variant, emailByPath, record, goldSelect: spec.goldSelect })
        const prompt = addPrompt(text)
        return { questionKey: record.questionKey, promptSha: prompt.sha, tokensUpper: prompt.tokensUpper, paths, ...meta }
    }

    const buildItems = (records, spec) => records.map((record, index) => itemFor(record, index, spec))

    // Shared token cap: a TEST question is excluded for every model if its P-B
    // context or any E* candidate context would exceed the cap.
    const estarConfigs = engineeredConfigs(rStar)
    const capViolations = (records, specs) => {
        const bad = new Set()
        for (const spec of specs) for (const [index, record] of records.entries()) {
            if (itemFor(record, index, spec).tokensUpper > TOKEN_CAP) bad.add(record.questionKey)
        }
        return bad
    }
    const devCap = capViolations(pools.dev, [BASELINE, ...estarConfigs])
    const testCap = capViolations(pools.test, [BASELINE, ...estarConfigs])
    const dev = pools.dev.filter((record) => !devCap.has(record.questionKey))
    const test = pools.test.filter((record) => !testCap.has(record.questionKey))
    log(`[prepare] token cap ${TOKEN_CAP}: excluded ${devCap.size} DEV and ${testCap.size} TEST questions`)

    const cells = []
    const pushCell = (spec, records, pool) => {
        const items = buildItems(records, spec)
        const overflow = items.filter((item) => item.tokensUpper > TOKEN_CAP).length
        cells.push({ ...spec, pool, nMax: items.length, overflowItems: overflow, items })
    }
    for (const config of [BASELINE, ...estarConfigs]) pushCell({ ...config, id: `D-${config.id}`, role: "dev", stage: 1, models: { small: null } }, dev, "dev")
    for (const spec of testCells()) {
        if (spec.estar) continue
        pushCell(spec, test, "test")
    }
    for (const config of estarConfigs) pushCell({ ...config, id: `E-${config.id}`, role: "estar-candidate", stage: 3, models: { tiny: null, small: null, mid: null, large: 600 } }, test, "test")
    for (const spec of bridgeCells()) pushCell(spec, bridge, "bridge")
    // Probe items come from DEV questions, never TEST.
    pushCell({ id: "PR-oracle", role: "probe", stage: 0, arm: "oracle", representation: "R0", template: "T2", models: { tiny: 50, small: 3, mid: 3, large: 30, bridge: 3 } }, dev.slice(0, 50), "dev")
    pushCell({ ...BASELINE, id: "PR-B", role: "probe", stage: 0, models: { large: 30, mid: 10 } }, dev.slice(0, 30), "dev")

    const ids = cells.map((cell) => cell.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    if (duplicates.length) throw new Error(`duplicate cell ids: ${duplicates.join(", ")}`)

    const promptsOut = createWriteStream(join(dataDir, "prompts.jsonl"))
    for (const record of prompts.values()) promptsOut.write(JSON.stringify(record) + "\n")
    await new Promise((resolve) => promptsOut.end(resolve))

    const strip = (record) => ({ ...record, incorrect: record.incorrect, rationale: record.rationale })
    writeJson(join(dataDir, "pools.json"), { dev: dev.map(strip), test: test.map(strip), retrieval: pools.retrieval.map(strip), bridge: bridge.map(strip) })
    writeJson(join(dataDir, "cells.json"), { cells })

    const hfShas = Object.fromEntries(Object.entries(HF_FILES).map(([key, value]) => [key, { repo: value.repo, revision: value.revision, sha256: value.sha256 }]))
    const questionSetHash = sha256(JSON.stringify({ dev: dev.map((record) => record.questionKey), test: test.map((record) => record.questionKey) }))
    const manifest = {
        createdAt: new Date().toISOString(),
        seed,
        hf: hfShas,
        corpus: { indexed: docs.length, droppedOverChars: dropped.length, maxChars: CORPUS_MAX_CHARS },
        mailboxes: { tuning: [...mailboxes.tuning].sort(), evaluation: mailboxes.evaluation.size },
        pools: { dev: dev.length, test: test.length, retrieval: pools.retrieval.length, bridge: bridge.length },
        exclusions: { ...pools.exclusions, tokenCapDev: devCap.size, tokenCapTest: testCap.size },
        retrieval: { embedModel: EMBED_MODEL, rerankModel: RERANK_MODEL, rStar, rStarResults },
        estarCandidates: estarConfigs.map((config) => config.id),
        tokenCap: TOKEN_CAP,
        runtime: RUNTIME,
        models: MODELS,
        judges: JUDGES,
        largeTimeRule: LARGE_TIME_RULE_ORDER,
        largeInterleave: LARGE_INTERLEAVE,
        hashes: { templates: TEMPLATE_HASH, representation: REPRESENTATION_VERSION, questionSet: questionSetHash },
        prompts: prompts.size,
    }
    writeJson(join(dataDir, "manifest-prepare.json"), manifest)
    await bm25Pool.close()
    log(`[prepare] done: ${cells.length} cells, ${prompts.size} unique prompts, ${Math.round((performance.now() - t0) / 1000)} s`)
    return manifest
}
