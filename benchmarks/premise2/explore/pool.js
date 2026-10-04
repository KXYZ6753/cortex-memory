// Exploration pool (docs/premise-study/explore-plan.md §6): every answerable
// question of the 30 tuning mailboxes, both EnronQA splits, minus the 397 DEV
// questions, frozen once with hashes. Nothing here touches TEST: the guard below
// refuses any question from an evaluation mailbox, and any whose gold email, twins
// or near-duplicates overlap a TEST, retrieval-only or bridge email or its twins.
//
// Reuses the frozen modules read-only; the one piece of dataset.js logic that is not
// exported (questionRecord) is mirrored here with the same filters.

import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs"
import { join } from "node:path"
import { cpus } from "node:os"
import { loadRaw, buildCorpus, splitMailboxes, loadV1Pilot } from "../dataset.js"
import { Bm25Pool, mapLimit } from "../bm25.js"
import { EvidenceCache, documentFrequency, findTwins } from "../evidence.js"
import { ranksFor, LIST_DEPTH } from "../retrieve.js"
import { buildPrompt, TOKEN_CAP, tokenUpperBound } from "../prompts.js"
import { UNANSWERABLE_GOLD, questionType, sha256 } from "../text.js"

export const EXPLORE_VERSION = "premise2-explore-v1"
export const SEED = 20260922
export const exploreDirOf = (dataDir) => join(dataDir, "explore")

// ---- the TEST guard ----

// Everything the exploration may never touch, from the main study's frozen pools.
export function loadGuard(dataDir) {
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const tuning = new Set(pools.dev.map((record) => record.user))
    const forbiddenPaths = new Set()
    for (const pool of ["test", "retrieval", "bridge"]) {
        for (const record of pools[pool] ?? []) {
            forbiddenPaths.add(record.path)
            for (const path of [...(record.twins ?? []), ...(record.nearDups ?? [])]) forbiddenPaths.add(path)
        }
    }
    const evaluationUsers = new Set([...pools.test, ...pools.retrieval].map((record) => record.user))
    for (const user of tuning) if (evaluationUsers.has(user)) throw new Error(`guard: mailbox ${user} is both tuning and evaluation`)
    const devKeys = new Set(pools.dev.map((record) => record.questionKey))
    const devPaths = new Set(pools.dev.flatMap((record) => [record.path, ...(record.twins ?? [])]))
    return { tuning, forbiddenPaths, evaluationUsers, devKeys, devPaths }
}

// Throws unless `record` is safe to explore on. Called when the pool is built, when
// a set is drawn and before every generation.
export function assertExplorable(record, guard) {
    if (!guard.tuning.has(record.user)) throw new Error(`guard: ${record.questionKey} is from mailbox ${record.user}, not a tuning mailbox`)
    if (record.path.split("/")[0] !== record.user) throw new Error(`guard: ${record.questionKey} path/user mismatch`)
    for (const path of [record.path, ...(record.twins ?? []), ...(record.nearDups ?? [])]) {
        if (guard.forbiddenPaths.has(path)) throw new Error(`guard: ${record.questionKey} touches evaluation email ${path}`)
        if (guard.evaluationUsers.has(path.split("/")[0]) && path === record.path) throw new Error(`guard: ${record.questionKey} gold is in an evaluation mailbox`)
    }
    if (guard.devKeys.has(record.questionKey)) throw new Error(`guard: ${record.questionKey} is one of the 397 DEV reference questions`)
    return true
}

// ---- candidates ----

// Mirrors dataset.js questionRecord (not exported there).
export function questionRecord(row, split, questionIndex, fields) {
    const question = fields.questions?.[questionIndex]
    const gold = fields.gold_answers?.[questionIndex]
    if (typeof question !== "string" || !question.trim() || typeof gold !== "string" || !gold.trim()) return null
    return {
        questionKey: `${split}:${row.path}#${questionIndex}`,
        split,
        path: row.path,
        user: row.user,
        questionIndex,
        question: question.trim(),
        rephrased: (fields.rephrased_questions?.[questionIndex] ?? "").trim() || null,
        gold: gold.trim(),
        alternates: (fields.alternate_answers?.[questionIndex] ?? []).filter((answer) => typeof answer === "string" && answer.trim()),
        type: questionType(question),
        unanswerable: UNANSWERABLE_GOLD.test(gold),
    }
}

// Pool record -> the P-B prompt (BM25 global top 5, R0, T2, rank order), exactly as
// the main study builds it.
export const pbPaths = (record, k = 5) => record.lists.global.slice(0, k)

export async function buildPool({ dataDir, log = console.log }) {
    const outDir = exploreDirOf(dataDir)
    mkdirSync(outDir, { recursive: true })
    const poolPath = join(outDir, "pool.jsonl")
    const manifestPath = join(outDir, "pool-manifest.json")
    if (existsSync(manifestPath)) throw new Error(`${manifestPath} exists: the pool is frozen. Delete it deliberately to rebuild.`)
    const t0 = performance.now()
    const raw = await loadRaw(join(dataDir, "hf"))
    const { docs } = buildCorpus(raw.corpus)
    const corpusPaths = new Set(docs.map((doc) => doc.path))
    const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
    const guard = loadGuard(dataDir)
    const mailboxes = splitMailboxes(raw.test, SEED)
    const same = guard.tuning.size === mailboxes.tuning.size && [...guard.tuning].every((user) => mailboxes.tuning.has(user))
    if (!same) throw new Error("guard: pools.json dev users differ from splitMailboxes(seed) tuning set")
    const v1Paths = loadV1Pilot(new URL("../v1-pilot-questions.json", import.meta.url))
    log(`[pool] loaded in ${Math.round(performance.now() - t0)} ms; ${guard.tuning.size} tuning mailboxes, ${guard.forbiddenPaths.size} forbidden paths`)

    const exclusions = { unanswerable: 0, notInCorpus: 0, devQuestion: 0, devEmail: 0, v1Email: 0, forbiddenEmail: 0, forbiddenTwin: 0, v1Twin: 0, devTwin: 0, tokenCap: 0 }
    const counts = { emails: 0, devSplit: 0, testSplit: 0 }
    let candidates = []
    for (let index = 0; index < raw.test.length; index++) {
        const row = raw.test[index]
        if (!guard.tuning.has(row.user)) continue
        counts.emails++
        for (const [split, fields] of [["dev", raw.dev[index]], ["test", raw.test[index]]]) {
            for (let q = 0; q < (fields.questions ?? []).length; q++) {
                const record = questionRecord(row, split, q, fields)
                if (!record) continue
                counts[split === "dev" ? "devSplit" : "testSplit"]++
                if (record.unanswerable) { exclusions.unanswerable++; continue }
                if (!corpusPaths.has(record.path)) { exclusions.notInCorpus++; continue }
                if (guard.devKeys.has(record.questionKey)) { exclusions.devQuestion++; continue }
                if (guard.devPaths.has(record.path)) { exclusions.devEmail++; continue }
                if (v1Paths.has(record.path)) { exclusions.v1Email++; continue }
                if (guard.forbiddenPaths.has(record.path)) { exclusions.forbiddenEmail++; continue }
                candidates.push(record)
            }
        }
    }
    log(`[pool] ${counts.emails} emails, ${counts.devSplit} dev-split + ${counts.testSplit} test-split questions; ${candidates.length} candidates after row filters`)

    const workers = Math.max(1, Math.min(8, cpus().length - 2))
    const bm25 = new Bm25Pool(join(dataDir, "corpus.sqlite"), workers)
    const evidence = new EvidenceCache(emailByPath)
    const t1 = performance.now()
    const df = documentFrequency(docs)
    log(`[pool] document frequency in ${Math.round((performance.now() - t1) / 1000)} s`)

    // Twins per email (shared by all of its questions), as in prepare.js.
    const paths = [...new Set(candidates.map((record) => record.path))]
    const twinsByPath = new Map()
    await mapLimit(paths, workers * 2, async (path) => {
        twinsByPath.set(path, await findTwins(path, { cache: evidence, df, search: (query, k) => bm25.search(query, k) }))
    }, (done, total) => { if (done % 2000 === 0 || done === total) log(`[pool] twins ${done}/${total}`) })
    candidates = candidates.filter((record) => {
        const { twins, nearDups } = twinsByPath.get(record.path)
        const related = [...new Set([...twins, ...nearDups])]
        if (related.some((path) => guard.forbiddenPaths.has(path) || guard.evaluationUsers.has(path.split("/")[0]))) return exclusions.forbiddenTwin++, false
        if (related.some((path) => v1Paths.has(path))) return exclusions.v1Twin++, false
        if (related.some((path) => guard.devPaths.has(path))) return exclusions.devTwin++, false
        record.twins = twins
        record.nearDups = nearDups
        return true
    })

    // Frozen BM25 lists: global (the main study's P-B list) and per-mailbox, top 20.
    await mapLimit(candidates, workers * 2, async (record) => {
        const [global, user] = await Promise.all([bm25.search(record.question, LIST_DEPTH), bm25.search(record.question, LIST_DEPTH, record.user)])
        record.lists = { global: global.map((hit) => hit.path), user: user.map((hit) => hit.path) }
    }, (done, total) => { if (done % 5000 === 0 || done === total) log(`[pool] retrieval ${done}/${total}`) })
    await bm25.close()

    const records = []
    for (const record of candidates) {
        const text = buildPrompt({ question: record.question, paths: pbPaths(record), representation: "R0", template: "T2", emailByPath, record })
        record.tokensUpper = tokenUpperBound(text)
        if (record.tokensUpper > TOKEN_CAP) { exclusions.tokenCap++; continue }
        assertExplorable(record, guard)
        const listed = (list) => list.map((path) => ({ path }))
        const global = ranksFor(record, listed(record.lists.global), evidence)
        const user = ranksFor(record, listed(record.lists.user), evidence)
        record.ranks = { global, user }
        record.stratum = global.answer !== null && global.answer <= 5 ? "hit" : "miss"
        record.quintile = mailboxes.quintileOf.get(record.user)
        delete record.unanswerable
        records.push(record)
    }
    const misses = records.filter((record) => record.stratum === "miss").length
    const out = createWriteStream(poolPath)
    for (const record of records) out.write(JSON.stringify(record) + "\n")
    await new Promise((resolve) => out.end(resolve))
    const poolSha = sha256(readFileSync(poolPath))
    const codeSha = sha256(["pool.js"].map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")).join("\n"))
    const userRecall = records.filter((record) => record.ranks.user.answer !== null && record.ranks.user.answer <= 5).length / records.length
    const manifest = {
        version: EXPLORE_VERSION,
        createdAt: new Date().toISOString(),
        seed: SEED,
        tuningMailboxes: [...guard.tuning].sort(),
        counts: { ...counts, candidatesAfterRowFilters: paths.length, emailsInPool: new Set(records.map((record) => record.path)).size, questions: records.length },
        exclusions,
        strata: { hit: records.length - misses, miss: misses, missShare: misses / records.length },
        answerRecallAt5: { global: 1 - misses / records.length, user: userRecall },
        perSplit: Object.fromEntries(["dev", "test"].map((split) => [split, records.filter((record) => record.split === split).length])),
        tokenCap: TOKEN_CAP,
        hashes: { pool: poolSha, code: codeSha, poolsJson: sha256(readFileSync(join(dataDir, "pools.json"))) },
        seconds: Math.round((performance.now() - t0) / 1000),
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    log(`[pool] frozen: ${records.length} questions, miss share ${(manifest.strata.missShare * 100).toFixed(2)}%, ${manifest.seconds} s`)
    return manifest
}

export function loadPool(dataDir) {
    const dir = exploreDirOf(dataDir)
    const manifest = JSON.parse(readFileSync(join(dir, "pool-manifest.json"), "utf8"))
    const text = readFileSync(join(dir, "pool.jsonl"))
    if (sha256(text) !== manifest.hashes.pool) throw new Error("pool.jsonl does not match its frozen hash")
    const records = String(text).split("\n").filter(Boolean).map((line) => JSON.parse(line))
    return { manifest, records, byKey: new Map(records.map((record) => [record.questionKey, record])) }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("pool.js")) {
    const dataDir = process.argv[2] ?? ".data/premise2"
    buildPool({ dataDir }).catch((error) => { console.error(error); process.exit(1) })
}
