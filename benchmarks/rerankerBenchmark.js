import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
    env,
    AutoModelForCausalLM,
    AutoModelForSequenceClassification,
    AutoTokenizer,
} from "@huggingface/transformers"
import { prisma } from "../src/db/client.js"
import { search } from "../src/search.js"

const modelName = process.argv[2] ?? "minilm"
if (!["minilm", "qwen"].includes(modelName)) throw new Error('Model must be "minilm" or "qwen"')
const casesFile = process.argv[3] ?? "benchmarks/enronqaCases.json"
const limit = Number(process.argv[4] ?? 50)
const seed = Number(process.argv[5] ?? 42)
const candidateCount = Number(process.argv[6] ?? (modelName === "qwen" ? 5 : 20))
const outputFile = process.argv[7] ?? `benchmarks/${modelName}RerankerResults.json`
if (![limit, seed, candidateCount].every(Number.isInteger) || limit < 1 || seed < 0 || candidateCount < 1) {
    throw new Error("Limit and candidate count must be positive integers; seed must be a non-negative integer")
}

env.cacheDir = ".data/models"
const MODEL_IDS = {
    minilm: "Xenova/ms-marco-MiniLM-L-6-v2",
    qwen: "onnx-community/Qwen3-Reranker-0.6B-ONNX",
}

const inputCases = JSON.parse(await readFile(casesFile, "utf8"))
let randomState = seed
const random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 2 ** 32)
for (let index = inputCases.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[inputCases[index], inputCases[swapIndex]] = [inputCases[swapIndex], inputCases[index]]
}
const cases = inputCases.slice(0, limit)

const emailText = (result) => [
    result.author && `From: ${result.author}`,
    result.recipients && `To: ${result.recipients}`,
    result.date && `Date: ${result.date}`,
    result.title && `Subject: ${result.title}`,
    result.snippet ?? result.summary,
].filter(Boolean).join("\n")

const loadStarted = performance.now()
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_IDS[modelName])
const model = modelName === "minilm"
    ? await AutoModelForSequenceClassification.from_pretrained(MODEL_IDS.minilm, { dtype: "q8" })
    : await AutoModelForCausalLM.from_pretrained(MODEL_IDS.qwen, { dtype: "q4", device: "cpu" })
const modelLoadMs = performance.now() - loadStarted

async function miniLmScores(query, documents) {
    const output = await model(tokenizer(Array(documents.length).fill(query), {
        text_pair: documents,
        padding: true,
        truncation: true,
        max_length: 256,
    }))
    const scores = Array.from(output.logits.data)
    output.logits.dispose?.()
    return scores
}

const YES = modelName === "qwen" ? tokenizer.convert_tokens_to_ids("yes") : null
const NO = modelName === "qwen" ? tokenizer.convert_tokens_to_ids("no") : null
const SYSTEM = 'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".'
const qwenPrompt = (query, document) =>
    `<|im_start|>system\n${SYSTEM}<|im_end|>\n` +
    `<|im_start|>user\n<Instruct>: Retrieve the email that answers the question\n\n` +
    `<Query>: ${query}\n\n<Document>: ${document}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>\n\n</think>\n`

async function qwenScores(query, documents) {
    const scores = []
    for (let start = 0; start < documents.length; start += 5) {
        const prompts = documents.slice(start, start + 5).map((document) => qwenPrompt(query, document))
        const output = await model(tokenizer(prompts, { padding: true, truncation: true, max_length: 256 }))
        const [batch, sequence, vocabulary] = output.logits.dims
        for (let index = 0; index < batch; index++) {
            const offset = (index * sequence + sequence - 1) * vocabulary
            const yes = output.logits.data[offset + YES]
            const no = output.logits.data[offset + NO]
            const maximum = Math.max(yes, no)
            scores.push(Math.exp(yes - maximum) / (Math.exp(yes - maximum) + Math.exp(no - maximum)))
        }
        output.logits.dispose?.()
    }
    return scores
}

const cutoffs = [1, 5, 10, candidateCount].filter((value, index, values) =>
    value <= candidateCount && values.indexOf(value) === index)
const metrics = {
    hybrid: { recall: Object.fromEntries(cutoffs.map((k) => [k, 0])), reciprocalRank: 0 },
    reranker: { recall: Object.fromEntries(cutoffs.map((k) => [k, 0])), reciprocalRank: 0 },
}
const details = []
const latencies = []

try {
    for (const [caseIndex, testCase] of cases.entries()) {
        const candidates = await search(testCase.query, candidateCount, "hybrid")
        const started = performance.now()
        const scores = modelName === "minilm"
            ? await miniLmScores(testCase.query, candidates.map(emailText))
            : await qwenScores(testCase.query, candidates.map(emailText))
        const latencyMs = performance.now() - started
        latencies.push(latencyMs)

        const reranked = candidates
            .map((result, index) => ({ ...result, rerankerScore: scores[index] }))
            .sort((a, b) => b.rerankerScore - a.rerankerScore)
        const relevant = new Set(testCase.relevantIds)
        const ranks = {}
        for (const [name, results] of Object.entries({ hybrid: candidates, reranker: reranked })) {
            const rank = results.findIndex((result) => relevant.has(result.id) || relevant.has(result.externalId))
            ranks[name] = rank < 0 ? null : rank + 1
            if (rank >= 0) metrics[name].reciprocalRank += 1 / (rank + 1)
            for (const cutoff of cutoffs) if (rank >= 0 && rank < cutoff) metrics[name].recall[cutoff]++
        }

        details.push({
            case: caseIndex + 1,
            query: testCase.query,
            expectedIds: testCase.relevantIds,
            ranks,
            latencyMs: Math.round(latencyMs),
            results: reranked.map((result) => ({
                id: result.externalId ?? result.id,
                candidateRank: candidates.findIndex((candidate) => candidate.id === result.id) + 1,
                rerankerScore: result.rerankerScore,
            })),
        })
        console.log(`[reranker] ${caseIndex + 1}/${cases.length}`)
    }

    latencies.sort((a, b) => a - b)
    const percentile = (p) => Math.round(latencies[Math.ceil(latencies.length * p) - 1])
    const summary = { model: modelName, modelId: MODEL_IDS[modelName], queries: cases.length, seed, candidateCount, modelLoadMs: Math.round(modelLoadMs) }
    for (const [name, values] of Object.entries(metrics)) {
        summary[name] = {
            recall: Object.fromEntries(cutoffs.map((k) => [k, Number((values.recall[k] / cases.length).toFixed(4))])),
            mrr: Number((values.reciprocalRank / cases.length).toFixed(4)),
        }
    }
    summary.reranker.p50Ms = percentile(0.5)
    summary.reranker.p95Ms = percentile(0.95)

    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, JSON.stringify({ summary, cases: details }, null, 2) + "\n")
    console.log(JSON.stringify(summary, null, 2))
    console.log(`[report] ${outputFile}`)
} finally {
    await model.dispose()
    await prisma.$disconnect()
}
