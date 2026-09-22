// Reciprocal-rank fusion used by search(). Kept free of database imports so
// benchmarks can use it without loading Prisma.
export function fuseResults(wordResults, vectorResults) {
    const results = new Map()
    const add = (items, weight, rankName) => items.forEach((result, index) => {
        const existing = results.get(result.id) ?? {}
        results.set(result.id, {
            ...existing,
            ...result,
            [rankName]: index + 1,
            score: (existing.score ?? 0) + weight / (10 + index + 1),
        })
    })

    // BM25 was much stronger on EnronQA. Dense retrieval stays as recovery evidence.
    add(wordResults, 1, "wordRank")
    add(vectorResults, 0.25, "vectorRank")
    return [...results.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}
