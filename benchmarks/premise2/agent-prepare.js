// Builds agent-items.json: the agent arm's question order (PREREG-AGENT.md).
//
// The questions are the 600 TEST questions the 31b answered (P-B items 0..599), so
// P-B and P-oracle already exist for every model on all of them. A question is a
// "miss" when the gold email is not in the BM25 top 5 of P-B. The first 200 hold
// every miss spread evenly among seeded-random hits; the other hits follow. Every
// prefix therefore keeps a known stratum mix, and estimates are re-weighted to the
// true shares among the 600.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { keyedRandom, shuffleInPlace, sha256 } from "./text.js"
import { readJsonl } from "./store.js"

export const AGENT_QUESTIONS = 600
export const AGENT_CORE = 200
export const AGENT_SEED = 20260922

export function orderAgentItems(items, { core = AGENT_CORE, seed = AGENT_SEED } = {}) {
    const misses = items.filter((item) => item.stratum === "miss")
    const hits = items.filter((item) => item.stratum === "hit")
    shuffleInPlace(hits, keyedRandom(seed, "agent:hits"))
    const coreHits = Math.min(hits.length, Math.max(0, core - misses.length))
    const coreSize = misses.length + coreHits
    const ordered = []
    // Miss i goes to slot floor((i + 0.5) * coreSize / misses), so they spread evenly.
    const missSlots = new Set(misses.map((_, index) => Math.floor(((index + 0.5) * coreSize) / misses.length)))
    let nextMiss = 0
    let nextHit = 0
    for (let slot = 0; slot < misses.length + coreHits; slot++) {
        if (missSlots.has(slot) && nextMiss < misses.length) ordered.push(misses[nextMiss++])
        else ordered.push(hits[nextHit++])
    }
    while (nextMiss < misses.length) ordered.push(misses[nextMiss++])
    ordered.push(...hits.slice(nextHit))
    return ordered.map((item, order) => ({ ...item, order }))
}

export function agentPrepare({ dataDir, out = new URL("./agent-items.json", import.meta.url), log = console.log }) {
    const { cells } = JSON.parse(readFileSync(join(dataDir, "cells.json"), "utf8"))
    const pb = cells.find((cell) => cell.id === "P-B")
    if (!pb) throw new Error("cells.json has no P-B cell")
    const ranks = new Map(readJsonl(join(dataDir, "retrieval.jsonl")).records.map((row) => [row.questionKey, row.ranks?.["bm25|global|questions"] ?? null]))
    const base = pb.items.slice(0, AGENT_QUESTIONS).map((item) => {
        const rank = ranks.get(item.questionKey)
        return {
            questionKey: item.questionKey,
            stratum: item.goldInContext ? "hit" : "miss",
            bm25GoldRank: rank?.strict ?? null,
            bm25AnswerRank: rank?.answer ?? null,
        }
    })
    const items = orderAgentItems(base)
    const counts = { miss: base.filter((item) => item.stratum === "miss").length, hit: base.filter((item) => item.stratum === "hit").length }
    const result = {
        version: "premise2-agent-items-v1",
        seed: AGENT_SEED,
        source: `P-B items 0..${AGENT_QUESTIONS - 1}`,
        core: AGENT_CORE,
        counts,
        trueShares: { miss: counts.miss / base.length, hit: counts.hit / base.length },
        hash: sha256(items.map((item) => item.questionKey).join("\n")),
        items,
    }
    writeFileSync(out, JSON.stringify(result, null, 1) + "\n")
    log(`[agent-prepare] ${items.length} questions (${counts.miss} misses, ${counts.hit} hits); core ${AGENT_CORE} holds ${items.slice(0, AGENT_CORE).filter((item) => item.stratum === "miss").length} misses; hash ${result.hash.slice(0, 12)}`)
    return result
}

// Design weights for a set of rows: true stratum share / share among the rows used.
// All weights are 1 when the rows cover the 600 in their true proportions.
export function stratumWeights(rows, strataOf, trueShares) {
    const counts = {}
    for (const row of rows) {
        const stratum = strataOf(row)
        counts[stratum] = (counts[stratum] ?? 0) + 1
    }
    const n = rows.length
    return rows.map((row) => {
        const stratum = strataOf(row)
        return counts[stratum] ? (trueShares[stratum] ?? 0) / (counts[stratum] / n) : 0
    })
}
