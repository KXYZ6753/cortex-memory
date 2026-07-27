import assert from "node:assert/strict"
import test from "node:test"
import { toBm25Query } from "../src/bm25.js"
import { fuseResults } from "../src/search.js"

test("BM25 drops common words but keeps useful names", () => {
    assert.equal(
        toBm25Query("What is the date of the original email sent by Caroline Emmert?"),
        '"date" OR "original" OR "email" OR "sent" OR "caroline" OR "emmert"',
    )
})

test("fusion favors BM25 while letting dense agreement help", () => {
    const words = [{ id: "word-first" }, { id: "both" }]
    const vectors = [{ id: "both" }, { id: "vector-only" }]
    const results = fuseResults(words, vectors)

    assert.deepEqual(results.map((result) => result.id), ["both", "word-first", "vector-only"])
    assert.equal(results[0].wordRank, 2)
    assert.equal(results[0].vectorRank, 1)
})
