import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AnswerStore, appendJsonl, generationKey, MAX_FAILED_ATTEMPTS } from "../../benchmarks/premise2/store.js"
import { devTable, selectEstar, TIE_MARGIN } from "../../benchmarks/premise2/select.js"
import { BASELINE, engineeredConfigs } from "../../benchmarks/premise2/cells.js"
import { judgeConfig, verdictKey } from "../../benchmarks/premise2/judge.js"

const digests = { small: "d" }
const optsHash = "opts1"
const judge = judgeConfig("j1")
const rStarConfigs = Object.fromEntries(engineeredConfigs("bm25").map((config) => [config.id, config]))

const tempDir = () => mkdtempSync(join(tmpdir(), "premise2-select-test-"))

// A synthetic DEV cell shaped the way prepare.js builds them: id "D-<config id>",
// the retrieval/representation fields distanceFromBaseline (cells.js) reads, and an
// `items` array of { questionKey, promptSha }. questionKey is scoped to the cell by
// default (each cell asks logically distinct questions), which keeps the ordinary
// tests below independent of one another -- the REGRESSION tests further down
// override questionKey deliberately to share it across cells.
function makeCell(id, config, n) {
    return {
        id,
        retrieval: config.retrieval,
        representation: config.representation,
        items: Array.from({ length: n }, (_, i) => ({ questionKey: `${id}-q${i}`, promptSha: `${id}-sha-${i}` })),
    }
}

// recordByKey: questionKey -> { gold, alternates, question }, as select.js expects.
function makeRecordByKey(cells) {
    const map = new Map()
    for (const cell of cells) {
        for (const item of cell.items) {
            if (!map.has(item.questionKey)) map.set(item.questionKey, { gold: `gold for ${item.questionKey}`, alternates: [], question: `question for ${item.questionKey}` })
        }
    }
    return map
}

const answerTextFor = (item) => `answer for ${item.questionKey}`

// Seeds a real AnswerStore with one "ok" answer per item, and appends one verdict
// record per item (up to gradedCount) keyed by verdictKey -- exactly as judgeDevAnswers
// and devTable both compute it: verdictKey({questionKey, references, answer, judge}).
// The first `correctCount` graded items are CORRECT, the rest are INCORRECT.
function seedGraded(dataDir, store, recordByKey, entries) {
    for (const { cell, correctCount, gradedCount = cell.items.length } of entries) {
        cell.items.forEach((item, i) => {
            const answerKey = generationKey(digests.small, optsHash, item.promptSha)
            const text = answerTextFor(item)
            store.add({ key: answerKey, status: "ok", answer: text })
            if (i >= gradedCount) return
            const record = recordByKey.get(item.questionKey)
            const key = verdictKey({ questionKey: item.questionKey, references: [record.gold, ...(record.alternates ?? [])], answer: text, judge })
            appendJsonl(join(dataDir, "verdicts.jsonl"), {
                type: "verdict", tier: "dev", judge: "j1", judgeModel: judge.model,
                verdict: i < correctCount ? "CORRECT" : "INCORRECT", verdictKey: key,
                questionKey: item.questionKey, cellId: cell.id, answerKey,
            })
        })
    }
}

// Like seedGraded, but with an arbitrary per-index predicate instead of a
// "first N correct" prefix, so a specific (full n vs restricted-n) accuracy flip
// can be constructed exactly.
function seedGradedWith(dataDir, store, recordByKey, entries) {
    for (const { cell, isCorrect } of entries) {
        cell.items.forEach((item, i) => {
            const answerKey = generationKey(digests.small, optsHash, item.promptSha)
            const text = answerTextFor(item)
            store.add({ key: answerKey, status: "ok", answer: text })
            const record = recordByKey.get(item.questionKey)
            const key = verdictKey({ questionKey: item.questionKey, references: [record.gold, ...(record.alternates ?? [])], answer: text, judge })
            appendJsonl(join(dataDir, "verdicts.jsonl"), {
                type: "verdict", tier: "dev", judge: "j1", judgeModel: judge.model,
                verdict: isCorrect(i) ? "CORRECT" : "INCORRECT", verdictKey: key,
                questionKey: item.questionKey, cellId: cell.id, answerKey,
            })
        })
    }
}

// ---------------------------------------------------------------------------
// devTable
// ---------------------------------------------------------------------------

test("devTable computes graded count and accuracy per cell from verdicts.jsonl", () => {
    const dataDir = tempDir()
    const cell = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 20)
    const recordByKey = makeRecordByKey([cell])
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [{ cell, correctCount: 12 }])
    const table = devTable({ dataDir, cells: [cell], store, recordByKey, digests, optsHash })
    assert.deepEqual(table["D-k1-rank-R0"], { n: 20, graded: 20, excludedOverflow: 0, accuracy: 0.6 })
})

test("devTable: an ungraded item is excluded from both n's denominator use and accuracy, but not from n", () => {
    const dataDir = tempDir()
    const cell = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 10)
    const recordByKey = makeRecordByKey([cell])
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [{ cell, correctCount: 5, gradedCount: 8 }])
    const table = devTable({ dataDir, cells: [cell], store, recordByKey, digests, optsHash })
    assert.deepEqual(table["D-k1-rank-R0"], { n: 10, graded: 8, excludedOverflow: 0, accuracy: 5 / 8 })
})

test("devTable: the maxItems option restricts n and recomputes accuracy over only that prefix", () => {
    const dataDir = tempDir()
    const cell = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 100)
    // First 50 items are CORRECT, the rest are INCORRECT.
    const recordByKey = makeRecordByKey([cell])
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [{ cell, correctCount: 50 }])
    const full = devTable({ dataDir, cells: [cell], store, recordByKey, digests, optsHash })
    const capped = devTable({ dataDir, cells: [cell], store, recordByKey, digests, optsHash, maxItems: 50 })
    assert.deepEqual(full["D-k1-rank-R0"], { n: 100, graded: 100, excludedOverflow: 0, accuracy: 0.5 })
    assert.deepEqual(capped["D-k1-rank-R0"], { n: 50, graded: 50, excludedOverflow: 0, accuracy: 1 })
})

// ---------------------------------------------------------------------------
// selectEstar: highest-accuracy config wins outright when > 2 pts ahead
// ---------------------------------------------------------------------------

test("selectEstar picks the highest-accuracy candidate when it is more than TIE_MARGIN ahead", () => {
    assert.equal(TIE_MARGIN, 0.02)
    const dataDir = tempDir()
    const B = makeCell("D-B", BASELINE, 100)
    const k1 = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 100)
    const k5r2 = makeCell("D-k5-rank-R2", rStarConfigs["k5-rank-R2"], 100)
    const cells = [B, k1, k5r2]
    const recordByKey = makeRecordByKey(cells)
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [
        { cell: B, correctCount: 60 },
        { cell: k1, correctCount: 70 },
        { cell: k5r2, correctCount: 85 }, // 15 pts ahead of k1 -- far outside TIE_MARGIN
    ])
    const result = selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash })
    assert.equal(result.estar, "k5-rank-R2")
    assert.deepEqual(result.tiedWith, ["D-k5-rank-R2"])
})

// ---------------------------------------------------------------------------
// selectEstar: within TIE_MARGIN, fewest components differing from B wins
// ---------------------------------------------------------------------------

test("selectEstar: within TIE_MARGIN, the config closer to baseline B wins even with slightly lower accuracy", () => {
    const dataDir = tempDir()
    const B = makeCell("D-B", BASELINE, 100)
    // k5-rank-R2 differs from B (bm25, k5, rank, R0) only in representation (R2) -> distance 1.
    const k5r2 = makeCell("D-k5-rank-R2", rStarConfigs["k5-rank-R2"], 100)
    // k3-bestlast-R0 differs from B in both k (3 vs 5) and order (bestlast vs rank) -> distance 2.
    const k3bl = makeCell("D-k3-bestlast-R0", rStarConfigs["k3-bestlast-R0"], 100)
    const cells = [B, k5r2, k3bl]
    const recordByKey = makeRecordByKey(cells)
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [
        { cell: B, correctCount: 60 },
        { cell: k5r2, correctCount: 80 }, // .80
        { cell: k3bl, correctCount: 81 }, // .81 -- strictly higher, but within TIE_MARGIN of .80
    ])
    const result = selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash })
    assert.deepEqual(result.table["D-k5-rank-R2"].accuracy, 0.8)
    assert.deepEqual(result.table["D-k3-bestlast-R0"].accuracy, 0.81)
    assert.deepEqual(new Set(result.tiedWith), new Set(["D-k5-rank-R2", "D-k3-bestlast-R0"]))
    // Despite lower raw accuracy, k5-rank-R2 wins because it differs from B in fewer components.
    assert.equal(result.estar, "k5-rank-R2")
})

// ---------------------------------------------------------------------------
// selectEstar: null when fewer than 95% of a candidate's items are graded
// ---------------------------------------------------------------------------

test("selectEstar returns null when any candidate has fewer than 95% of its items graded", () => {
    const dataDir = tempDir()
    const B = makeCell("D-B", BASELINE, 100)
    const k1 = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 100)
    const k5r2 = makeCell("D-k5-rank-R2", rStarConfigs["k5-rank-R2"], 100)
    const cells = [B, k1, k5r2]
    const recordByKey = makeRecordByKey(cells)
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [
        { cell: B, correctCount: 60 },
        { cell: k1, correctCount: 70, gradedCount: 100 },
        { cell: k5r2, correctCount: 85, gradedCount: 90 }, // only 90% graded, under MIN_GRADED_SHARE (95%)
    ])
    const result = selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash })
    assert.equal(result, null)
})

test("selectEstar: exactly 95% graded is sufficient (boundary)", () => {
    const dataDir = tempDir()
    const B = makeCell("D-B", BASELINE, 100)
    const k1 = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 100)
    const cells = [B, k1]
    const recordByKey = makeRecordByKey(cells)
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    seedGraded(dataDir, store, recordByKey, [
        { cell: B, correctCount: 60 },
        { cell: k1, correctCount: 70, gradedCount: 95 },
    ])
    const result = selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash })
    assert.notEqual(result, null)
    assert.equal(result.estar, "k1-rank-R0")
})

// ---------------------------------------------------------------------------
// selectEstar: the maxItems option restricts n for selection too
// ---------------------------------------------------------------------------

test("selectEstar: maxItems restricts n and can flip the selected winner", () => {
    const dataDir = tempDir()
    const B = makeCell("D-B", BASELINE, 100)
    const k1 = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 100)
    const k5r2 = makeCell("D-k5-rank-R2", rStarConfigs["k5-rank-R2"], 100)
    const cells = [B, k1, k5r2]
    const recordByKey = makeRecordByKey(cells)
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    // k1 is correct only on its first 20 items (1.00 restricted to n=20, but 0.20 over
    // the full 100). k5-rank-R2 is correct on items [20, 90) -- 0 of its first 20, but
    // 0.70 over the full 100. The two configs' rankings must therefore flip depending
    // on whether selection restricts to the first 20 items or uses all 100.
    seedGradedWith(dataDir, store, recordByKey, [
        { cell: B, isCorrect: (i) => i < 50 },
        { cell: k1, isCorrect: (i) => i < 20 },
        { cell: k5r2, isCorrect: (i) => i >= 20 && i < 90 },
    ])
    const full = selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash })
    const capped = selectEstar({ dataDir, cells, store, recordByKey, digests, optsHash, maxItems: 20 })
    assert.equal(full.estar, "k5-rank-R2")
    assert.equal(full.table["D-k5-rank-R2"].accuracy, 0.7)
    assert.equal(full.table["D-k1-rank-R0"].accuracy, 0.2)
    assert.equal(capped.estar, "k1-rank-R0")
    assert.equal(capped.table["D-k1-rank-R0"].accuracy, 1)
    assert.equal(capped.table["D-k5-rank-R2"].accuracy, 0)
})

// ---------------------------------------------------------------------------
// REGRESSION (a): verdicts are looked up by verdict key, so an identical
// (question, answer) pair graded once counts for every DEV cell that produced it,
// even when those cells used different prompts (and so different answer keys).
// This used to be a critical bug: verdicts were looked up by the first cell's
// answerKey only, so a second cell with the same question+answer but a different
// prompt/answerKey would never see the verdict and would stay ungraded forever.
// ---------------------------------------------------------------------------

test("REGRESSION: a single verdict keyed by verdictKey counts as graded for two cells that share a question and answer text but have different promptSha/answerKey", () => {
    const dataDir = tempDir()
    const cellA = makeCell("D-cellA", rStarConfigs["k1-rank-R0"], 3)
    const cellB = makeCell("D-cellB", rStarConfigs["k3-rank-R0"], 3)
    // Force both cells' items to ask the *same* question per index, while each cell
    // still gets its own promptSha (as prepare.js would: same question, different
    // retrieved context per config) -- so answerKey differs but questionKey does not.
    cellA.items.forEach((item, i) => { item.questionKey = `shared-q${i}` })
    cellB.items.forEach((item, i) => { item.questionKey = `shared-q${i}` })
    assert.notEqual(
        generationKey(digests.small, optsHash, cellA.items[0].promptSha),
        generationKey(digests.small, optsHash, cellB.items[0].promptSha),
        "sanity check: the two cells must have distinct answerKeys",
    )

    const recordByKey = makeRecordByKey([cellA, cellB])
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    // Both cells' generation produced the exact same answer text for each shared question.
    for (const cell of [cellA, cellB]) {
        cell.items.forEach((item, i) => {
            const answerKey = generationKey(digests.small, optsHash, item.promptSha)
            store.add({ key: answerKey, status: "ok", answer: `identical answer ${i}` })
        })
    }
    // Only ONE verdict is ever written per question -- as if the judge graded the
    // (question, answer) pair once (deduped by verdictKey) and never saw it again.
    cellA.items.forEach((item, i) => {
        const record = recordByKey.get(item.questionKey)
        const key = verdictKey({ questionKey: item.questionKey, references: [record.gold, ...(record.alternates ?? [])], answer: `identical answer ${i}`, judge })
        appendJsonl(join(dataDir, "verdicts.jsonl"), {
            type: "verdict", tier: "dev", judge: "j1", judgeModel: judge.model,
            verdict: i === 0 ? "INCORRECT" : "CORRECT", verdictKey: key,
        })
    })

    const table = devTable({ dataDir, cells: [cellA, cellB], store, recordByKey, digests, optsHash })
    assert.deepEqual(table["D-cellA"], { n: 3, graded: 3, excludedOverflow: 0, accuracy: 2 / 3 })
    assert.deepEqual(table["D-cellB"], { n: 3, graded: 3, excludedOverflow: 0, accuracy: 2 / 3 })
})

// ---------------------------------------------------------------------------
// REGRESSION (b): failure-exhausted items grade INCORRECT; still-retryable
// items with no answer stay ungraded.
// ---------------------------------------------------------------------------

test("REGRESSION: an item with no answer but MAX_FAILED_ATTEMPTS failures grades INCORRECT; an item with no answer and fewer failures is ungraded", () => {
    assert.equal(MAX_FAILED_ATTEMPTS, 3)
    const dataDir = tempDir()
    const cell = makeCell("D-k1-rank-R0", rStarConfigs["k1-rank-R0"], 2)
    const recordByKey = makeRecordByKey([cell])
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    const [failedItem, retryingItem] = cell.items

    // failedItem: MAX_FAILED_ATTEMPTS failures and no answer -> counts as graded INCORRECT.
    const failedKey = generationKey(digests.small, optsHash, failedItem.promptSha)
    store.add({ key: failedKey, status: "timeout" })
    store.add({ key: failedKey, status: "timeout" })
    store.add({ key: failedKey, status: "http_error" })

    // retryingItem: only MAX_FAILED_ATTEMPTS - 1 failures -> still eligible for retry -> ungraded.
    const retryingKey = generationKey(digests.small, optsHash, retryingItem.promptSha)
    store.add({ key: retryingKey, status: "timeout" })

    assert.equal(store.get(failedKey), null)
    assert.equal(store.get(retryingKey), null)

    // No verdicts.jsonl at all -- neither item ever reached the judge.
    const table = devTable({ dataDir, cells: [cell], store, recordByKey, digests, optsHash })
    assert.deepEqual(table["D-k1-rank-R0"], { n: 2, graded: 1, excludedOverflow: 0, accuracy: 0 })
})
