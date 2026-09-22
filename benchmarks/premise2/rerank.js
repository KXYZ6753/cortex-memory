// MiniLM cross-encoder reranking (Xenova/ms-marco-MiniLM-L-6-v2 via transformers.js).
//
// V1's reranker scored 64-token BM25 snippets, or summaries that were null for 99%
// of the corpus, so its "rerankers do not help" conclusion never tested reranking.
// Here each email is scored on Subject + Sender + the start of its body.

import { env, AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers"
import { splitFile, parseFileHeader } from "./text.js"

export const RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"
export const RERANK_MAX_TOKENS = 512
export const RERANK_BODY_CHARS = 1600

export function rerankText(email) {
    const { header, body } = splitFile(email)
    const parsed = parseFileHeader(header)
    return [parsed.subject && `Subject: ${parsed.subject}`, parsed.sender && `Sender: ${parsed.sender}`, body.slice(0, RERANK_BODY_CHARS)]
        .filter(Boolean)
        .join("\n")
}

export async function loadReranker(cacheDir) {
    env.cacheDir = cacheDir
    const tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL)
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: "q8" })
    return {
        async score(query, documents, batchSize = 16) {
            const scores = []
            for (let start = 0; start < documents.length; start += batchSize) {
                const batch = documents.slice(start, start + batchSize)
                const output = await model(tokenizer(Array(batch.length).fill(query), {
                    text_pair: batch,
                    padding: true,
                    truncation: true,
                    max_length: RERANK_MAX_TOKENS,
                }))
                scores.push(...Array.from(output.logits.data))
                output.logits.dispose?.()
            }
            return scores
        },
        dispose: () => model.dispose(),
    }
}

// Reranked order for a candidate list, plus the adaptive-k cut: keep items up to
// the largest score gap within the top 5 (at least 1).
export function rerankOrder(candidates, scores) {
    const ranked = candidates.map((path, index) => ({ path, score: scores[index] })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    let gateK = 1
    let largest = -Infinity
    for (let index = 0; index < Math.min(5, ranked.length) - 1; index++) {
        const gap = ranked[index].score - ranked[index + 1].score
        if (gap > largest) {
            largest = gap
            gateK = index + 1
        }
    }
    return { ranked, gateK }
}
