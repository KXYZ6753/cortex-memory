// Retrieval stage: every method runs once per question and the ranked lists are
// frozen, so every generator later sees exactly the same retrieved emails.
//
// List keys are "<method>|<scope>|<field>", e.g. "bm25|global|questions".
// Methods: bm25, dense, rrf60 (equal-weight RRF, constant 60), hybv1 (V1's weighted
// fusion, tuned on test-split questions, so exploratory only), and "+rr" variants
// (MiniLM rerank of the union of bm25/dense/rrf60 top-20).

import { fuseResults } from "../../src/fusion.js"
import { embedBatch, denseSearch, QUERY_PREFIX } from "./dense.js"
import { rerankText, rerankOrder } from "./rerank.js"
import { mapLimit } from "./bm25.js"

export const LIST_DEPTH = 20
export const DISTRACTOR_DEPTH = 100
export const FUSION_DEPTH = 100
export const R_STAR_CANDIDATES = ["bm25", "dense", "rrf60", "bm25+rr", "rrf60+rr"]

export function rrf(lists, constant = 60, depth = LIST_DEPTH) {
    const scores = new Map()
    for (const list of lists) list.forEach((hit, index) => scores.set(hit.path, (scores.get(hit.path) ?? 0) + 1 / (constant + index + 1)))
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, depth).map(([path, score]) => ({ path, score }))
}

export function hybridV1(bm25List, denseList, depth = LIST_DEPTH) {
    const fused = fuseResults(bm25List.map((hit) => ({ id: hit.path })), denseList.map((hit) => ({ id: hit.path })))
    return fused.slice(0, depth).map((hit) => ({ path: hit.id, score: hit.score }))
}

const questionText = (record, field) => (field === "rephrased" ? record.rephrased ?? record.question : record.question)

// Runs BM25 and dense for one question field and scope set, and fuses.
export async function retrieveRecords(records, { bm25Pool, dense, field = "questions", scopes = ["global", "user"], log = () => {} }) {
    const out = new Map(records.map((record) => [record.questionKey, {}]))
    const texts = records.map((record) => questionText(record, field))

    const started = performance.now()
    const vectors = []
    for (let start = 0; start < texts.length; start += 64) vectors.push(...await embedBatch(texts.slice(start, start + 64).map((text) => QUERY_PREFIX + text)))
    log(`[retrieve] ${field}: embedded ${texts.length} queries in ${Math.round((performance.now() - started) / 1000)} s`)

    await mapLimit(records, 8, async (record, index) => {
        const lists = out.get(record.questionKey)
        for (const scope of scopes) {
            const user = scope === "user" ? record.user : null
            const depth = scope === "global" && field === "questions" ? DISTRACTOR_DEPTH : FUSION_DEPTH
            const bm25 = await bm25Pool.search(texts[index], depth, user)
            const denseList = denseSearch(dense, vectors[index], FUSION_DEPTH, user)
            lists[`bm25|${scope}|${field}`] = bm25
            lists[`dense|${scope}|${field}`] = denseList.slice(0, LIST_DEPTH)
            lists[`rrf60|${scope}|${field}`] = rrf([bm25.slice(0, FUSION_DEPTH), denseList])
            if (scope === "global") lists[`hybv1|${scope}|${field}`] = hybridV1(bm25.slice(0, FUSION_DEPTH), denseList)
        }
    }, (done, total) => {
        if (done % 250 === 0 || done === total) log(`[retrieve] ${field}: ${done}/${total}`)
    })
    return out
}

// MiniLM over the union of bm25/dense/rrf60 global top-20 for the primary field.
export async function rerankRecords(records, lists, { reranker, emailByPath, log = () => {} }) {
    const started = performance.now()
    let pairs = 0
    for (const [index, record] of records.entries()) {
        const entry = lists.get(record.questionKey)
        const union = [...new Set(["bm25", "dense", "rrf60"].flatMap((method) => (entry[`${method}|global|questions`] ?? []).slice(0, LIST_DEPTH).map((hit) => hit.path)))]
        const scores = await reranker.score(record.question, union.map((path) => rerankText(emailByPath.get(path) ?? "")))
        pairs += union.length
        const scoreOf = new Map(union.map((path, position) => [path, scores[position]]))
        entry.rerankScores = Object.fromEntries(scoreOf)
        for (const method of ["bm25", "rrf60", "dense"]) {
            const base = (entry[`${method}|global|questions`] ?? []).slice(0, LIST_DEPTH).map((hit) => hit.path)
            const { ranked, gateK } = rerankOrder(base, base.map((path) => scoreOf.get(path)))
            entry[`${method}+rr|global|questions`] = ranked
            entry[`${method}+rr|global|questions:gateK`] = gateK
        }
        if ((index + 1) % 100 === 0 || index + 1 === records.length) {
            const seconds = (performance.now() - started) / 1000
            log(`[rerank] ${index + 1}/${records.length} (${pairs} pairs, ${(seconds * 1000 / pairs).toFixed(1)} ms/pair)`)
        }
    }
}

// Strict: the gold email itself. Relaxed: gold or a strong twin (a copy containing
// the gold). Answer: gold, twin, or any email that contains the answer.
export function ranksFor(record, list, evidence) {
    const twins = new Set(record.twins ?? [])
    let strict = null
    let relaxed = null
    let answer = null
    list.forEach((hit, index) => {
        const path = hit.path
        if (strict === null && path === record.path) strict = index + 1
        if (relaxed === null && (path === record.path || twins.has(path))) relaxed = index + 1
        if (answer === null && (path === record.path || twins.has(path) || evidence.answerBearing(path, record) === true)) answer = index + 1
    })
    return { strict, relaxed, answer }
}

// R*: the retrieval pipeline with the highest DEV answer-bearing recall@5, chosen
// before any generation. Ties go to the earlier (simpler) entry of the candidate list.
export function chooseRStar(devRecords, lists, evidence) {
    const results = R_STAR_CANDIDATES.map((method) => {
        let hits = 0
        for (const record of devRecords) {
            const list = lists.get(record.questionKey)[`${method}|global|questions`] ?? []
            const { answer } = ranksFor(record, list.slice(0, LIST_DEPTH), evidence)
            if (answer !== null && answer <= 5) hits++
        }
        return { method, answerRecallAt5: hits / devRecords.length }
    })
    let best = results[0]
    for (const result of results) if (result.answerRecallAt5 > best.answerRecallAt5 + 1e-12) best = result
    return { rStar: best.method, results }
}
