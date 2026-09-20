// Premise benchmark: does retrieval engineering have anything to offset?
//
// Answers two questions before the full study is built:
//   Kill test A — does a large generator actually beat a small one on EnronQA
//                 answer correctness when both are handed the gold email?
//                 No gap means "retrieval offsets scale" has nothing to offset.
//   Kill test B — does the small generator degrade when the context also holds
//                 wrong emails? No degradation means "retrieval precision
//                 substitutes for parameters" has no mechanism.
//
// Phase 1 (both kill tests, the no-retrieval floor, the representation arm) is
// deliberately DB-free: Ollama plus the HuggingFace datasets-server, nothing
// else. It produces a verdict even with Postgres, pgvector and Docker all down.
// Phase 2 adds a real retrieval arm through src/search.js and is skipped,
// loudly, whenever that stack is unavailable.
//
// Usage:
//   npm run benchmark:premise -- probe            # project the night, commit nothing
//   npm run benchmark:premise -- all 100          # the overnight run
//   npm run benchmark:premise -- judge            # re-grade without regenerating
//   npm run benchmark:premise -- report
//
// Every generated answer is appended to disk before the next one starts, so an
// interrupted run resumes by rerunning the identical command.

import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { dirname } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { BM25_INDEX_PATH, toBm25Query } from "../src/bm25.js"

// ---------------------------------------------------------------------------
// §0  CLI and configuration
// ---------------------------------------------------------------------------

const USAGE = "Usage: npm run benchmark:premise -- [probe|generate|judge|report|all] [limit] [seed] [stateDir] [reportFile]"
const STAGES = ["probe", "generate", "judge", "report", "all"]

const stage = process.argv[2] ?? "all"
if (!STAGES.includes(stage)) throw new Error(`${USAGE}\nUnknown stage "${stage}"`)

const limit = Number(process.argv[3] ?? 100)
if (!Number.isInteger(limit) || limit < 1) throw new Error("Limit must be a positive integer")

const seed = Number(process.argv[4] ?? 42)
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be a 32-bit unsigned integer")

const stateDir = process.argv[5] ?? ".data/premise"
if (!stateDir.trim()) throw new Error("State directory must be a non-empty path")

const reportFile = process.argv[6] ?? "benchmarks/premiseResults.json"
if (!reportFile.trim()) throw new Error("Report file must be a non-empty path")

try {
    process.loadEnvFile()
} catch {
    // No .env is fine; every setting below has a default.
}

const flag = (name, fallback) => (process.env[name] ?? String(fallback)) === "true"
const num = (name, fallback, min = 1) => Math.max(min, Number(process.env[name]) || fallback)
const list = (name, fallback) => (process.env[name] ?? fallback).split(",").map((part) => part.trim()).filter(Boolean)

const config = Object.freeze({
    ollamaUrl: (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/+$/, ""),

    modelSmall: process.env.POC_MODEL_SMALL ?? "gemma4:e2b",
    modelLarge: process.env.POC_MODEL_LARGE ?? "gemma4:31b-it-qat",
    modelAlt: process.env.POC_MODEL_LARGE_ALT ?? "gemma4:31b-nvfp4",
    probeAlt: flag("POC_PROBE_ALT", false),
    probeN: num("POC_PROBE_N", 5),

    poolSize: num("POC_POOL_SIZE", 2000, 100),
    hfSplit: process.env.POC_HF_SPLIT ?? "test",
    questionField: process.env.POC_QUESTION_FIELD ?? "questions",

    representationArm: flag("POC_REPRESENTATION_ARM", true),
    distractorDensities: list("POC_DISTRACTOR_DENSITIES", "4,9").map(Number),
    numPredict: num("POC_NUM_PREDICT", 160, 16),
    answerTimeoutMs: num("OLLAMA_ANSWER_TIMEOUT_MS", 600_000, 10_000),

    deadlineHours: Math.max(0.1, Number(process.env.POC_DEADLINE_HOURS) || 8),
    abortIfOver: flag("POC_ABORT_IF_OVER", false),

    judgeProvider: process.env.POC_JUDGE_PROVIDER ?? "ollama",
    judgeModel: process.env.POC_JUDGE_MODEL ?? "gpt-oss:20b-cloud",
    judgeThink: process.env.POC_JUDGE_THINK ?? "low",
    judgeConcurrency: num("POC_JUDGE_CONCURRENCY", 4),
    judgeTimeoutMs: num("POC_JUDGE_TIMEOUT_MS", 120_000, 5_000),
    validationN: Math.max(0, Number(process.env.POC_VALIDATION_N ?? 60)),

    energy: process.env.POC_ENERGY ?? "auto",
    nvidiaSmi: process.env.POC_NVIDIA_SMI ?? (process.platform === "win32" ? "nvidia-smi.exe" : "nvidia-smi"),
    powerIntervalMs: num("POC_POWER_INTERVAL_MS", 200, 50),
    systemWattsIdle: Number(process.env.POC_SYSTEM_WATTS_IDLE) || null,
    systemWattsBusy: Number(process.env.POC_SYSTEM_WATTS_BUSY) || null,

    phase2: process.env.POC_PHASE2 ?? "auto",
    phase2Methods: list("POC_PHASE2_METHODS", "word,hybrid"),
    phase2K: list("POC_PHASE2_K", "1,5").map(Number),
})

if (config.judgeProvider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
    throw new Error("POC_JUDGE_PROVIDER=openrouter requires OPENROUTER_API_KEY in the environment")
}

const paths = {
    sample: `${stateDir}/sample.json`,
    answers: `${stateDir}/answers.jsonl`,
    verdicts: `${stateDir}/verdicts.jsonl`,
    probe: `${stateDir}/probe.jsonl`,
    calibration: `${stateDir}/calibration.json`,
}

// Decision thresholds, named so the report can quote them.
const GAP_MIN = 0.10
const NULL_MAX = 0.05
const ALPHA = 0.05
const MIN_PAIRED_N = 60
const JUDGE_MIN_RECALL = 0.80
const JUDGE_MAX_FALSE_CORRECT = 0.15

// ---------------------------------------------------------------------------
// §1  Utilities
// ---------------------------------------------------------------------------

const ms = (nanoseconds) => Math.round((nanoseconds || 0) / 1e6)
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
const round = (value, places = 4) => (value == null || Number.isNaN(value) ? null : Number(value.toFixed(places)))

function percentile(sorted, p) {
    if (!sorted.length) return null
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}

function distribution(values) {
    if (!values.length) return { mean: null, p50: null, p95: null, max: null, total: 0 }
    const sorted = [...values].sort((a, b) => a - b)
    return {
        mean: round(mean(values), 1),
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.at(-1),
        total: values.reduce((sum, value) => sum + value, 0),
    }
}

// Same LCG as benchmarks/retrievalBenchmark.js:30-31 and rerankerBenchmark.js:30-31; keep in sync.
const makeRandom = (state) => () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32)

function shuffle(array, random) {
    for (let index = array.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1))
        ;[array[index], array[swapIndex]] = [array[swapIndex], array[index]]
    }
    return array
}

function fnv1a32(text) {
    let hash = 0x811c9dc5
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash >>> 0
}

const sha12 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12)

const nextPowerOfTwo = (value) => 2 ** Math.ceil(Math.log2(Math.max(1, value)))

// Wilson score interval; far better than normal approximation at the extremes.
function wilson(successes, total, z = 1.96) {
    if (!total) return [null, null]
    const proportion = successes / total
    const denominator = 1 + z ** 2 / total
    const centre = proportion + z ** 2 / (2 * total)
    const spread = z * Math.sqrt(proportion * (1 - proportion) / total + z ** 2 / (4 * total ** 2))
    return [round(Math.max(0, (centre - spread) / denominator)), round(Math.min(1, (centre + spread) / denominator))]
}

// Two-sided exact McNemar on the discordant pairs only.
function mcnemarExactP(b, c) {
    const total = b + c
    if (!total) return 1
    const smaller = Math.min(b, c)
    let logFactorial = 0
    const logFactorials = [0]
    for (let index = 1; index <= total; index++) {
        logFactorial += Math.log(index)
        logFactorials.push(logFactorial)
    }
    let tail = 0
    for (let index = 0; index <= smaller; index++) {
        const logChoose = logFactorials[total] - logFactorials[index] - logFactorials[total - index]
        tail += Math.exp(logChoose + total * Math.log(0.5))
    }
    return Math.min(1, 2 * tail)
}

// Rogan-Gladen: undo the judge's own error rate. Needs sensitivity + specificity > 1.
function rogonGladen(observed, sensitivity, specificity) {
    const denominator = sensitivity + specificity - 1
    if (!(denominator > 0.05)) return null
    return round(Math.min(1, Math.max(0, (observed + specificity - 1) / denominator)))
}

let charsPerToken = 3.6
const estimateTokens = (text) => Math.ceil(text.length / charsPerToken)

// ---------------------------------------------------------------------------
// §2  Dataset
// ---------------------------------------------------------------------------

// HuggingFace paging with backoff, lifted from benchmarks/imports/importEnronQA.js:11-36,
// but keeping every field instead of just the email and the first question.
async function fetchPool(count, split) {
    const rows = []
    for (let offset = 0; offset < count; offset += 100) {
        const length = Math.min(100, count - offset)
        const url = new URL("https://datasets-server.huggingface.co/rows")
        url.search = new URLSearchParams({
            dataset: "MichaelR207/enron_qa_0922",
            config: "default",
            split,
            offset: String(offset),
            length: String(length),
        })

        let response
        for (let attempt = 0; attempt < 6; attempt++) {
            response = await fetch(url)
            if (response.status !== 429 && response.status < 500) break
            const waitMs = 5000 * 2 ** attempt
            console.warn(`[download] HTTP ${response.status}; retrying in ${waitMs / 1000}s`)
            await delay(waitMs)
        }
        if (!response.ok) throw new Error(`EnronQA download failed: ${response.status} ${await response.text()}`)
        const page = (await response.json()).rows
        if (!Array.isArray(page) || page.length !== length) throw new Error(`Expected ${length} EnronQA rows at offset ${offset}`)

        for (const { row } of page) {
            if (!row?.email || !row?.path) {
                console.warn(`[skip] malformed row: ${row?.path ?? "unknown path"}`)
                continue
            }
            rows.push({
                path: row.path,
                user: row.user ?? null,
                email: row.email,
                questions: row.questions ?? [],
                rephrasedQuestions: row.rephrased_questions ?? [],
                goldAnswers: row.gold_answers ?? [],
                alternateAnswers: row.alternate_answers ?? [],
                incorrectAnswers: row.incorrect_answers ?? [],
                goldRationales: row.gold_rationales ?? [],
                questionsCount: row.questions_count ?? null,
                includeEmail: row.include_email ?? null,
            })
        }
        console.log(`[download] ${rows.length}/${count}`)
        if (rows.length < count) await delay(1000)
    }
    return rows
}

async function loadPool() {
    if (existsSync(paths.sample)) {
        const cached = JSON.parse(await readFile(paths.sample, "utf8"))
        if (cached.split === config.hfSplit && cached.rows.length >= config.poolSize) {
            console.log(`[pool] ${cached.rows.length} emails from cache (${paths.sample})`)
            return cached.rows.slice(0, config.poolSize)
        }
        console.log("[pool] cache does not match requested split/size; refetching")
    }
    const rows = await fetchPool(config.poolSize, config.hfSplit)
    await mkdir(stateDir, { recursive: true })
    await writeFile(paths.sample, JSON.stringify({ split: config.hfSplit, count: rows.length, rows }) + "\n")
    return rows
}

// One record per (email, question). Prefix-nested sampling: every cell takes
// questions.slice(0, n), so any two cells are paired on min(n_a, n_b) cases and
// trimming a cell mid-run never breaks the pairing.
function buildQuestionSet(rows, count) {
    const records = []
    for (const row of rows) {
        const questions = config.questionField === "rephrased_questions" && row.rephrasedQuestions.length
            ? row.rephrasedQuestions
            : row.questions
        for (const [questionIndex, question] of questions.entries()) {
            const gold = row.goldAnswers[questionIndex]
            if (typeof question !== "string" || !question.trim()) continue
            if (typeof gold !== "string" || !gold.trim()) continue
            records.push({
                questionKey: `${row.path}#${questionIndex}`,
                path: row.path,
                user: row.user,
                questionIndex,
                question: question.trim(),
                gold: gold.trim(),
                alternates: (row.alternateAnswers[questionIndex] ?? []).filter((answer) => typeof answer === "string" && answer.trim()),
                incorrect: (row.incorrectAnswers[questionIndex] ?? []).filter((answer) => typeof answer === "string" && answer.trim()),
                rationale: row.goldRationales[questionIndex] ?? null,
                includeEmail: Array.isArray(row.includeEmail) ? row.includeEmail[questionIndex] ?? null : row.includeEmail,
            })
        }
    }
    shuffle(records, makeRandom(seed))
    console.log(`[pool] ${rows.length} emails, ${records.length} questions, ${Math.min(count, records.length)} sampled (seed ${seed})`)
    return records.slice(0, count)
}

const SEPARATOR = "====================================="

function splitEmail(email) {
    const at = email.indexOf(SEPARATOR)
    if (at < 0) return { header: "", body: email.trim() }
    return { header: email.slice(0, at).trim(), body: email.slice(at + SEPARATOR.length).trim() }
}

// The "preprocessed" representation. Deliberately keeps the quoted reply chain:
// on EnronQA the answer frequently lives in the deepest quoted message, so
// stripping the chain deletes answer-bearing text.
function preprocessEmail(email) {
    const { header, body } = splitEmail(email)
    const keptHeader = header
        .split("\n")
        .filter((line) => !/^File:/i.test(line))
        .map((line) => {
            const recipients = line.match(/^Recipients:\s*\[(.*)\]\s*$/i)
            if (!recipients) return line
            const names = recipients[1].split(",").map((name) => name.trim()).filter(Boolean)
            return names.length > 3
                ? `Recipients: ${names.slice(0, 3).join(", ")} (+${names.length - 3} more)`
                : `Recipients: ${names.join(", ")}`
        })
        .join("\n")

    const cleanedBody = body
        .split("\n")
        .filter((line) => !/^\s*(Sent|Cc|Bcc|X-[\w-]+):/i.test(line))
        .map((line) => line.replace(/^\s*>+\s?/, "").replace(/\s+$/, ""))
        .join("\n")
        .replace(/https?:\/\/\S+/gi, "[link]")
        .replace(/\n{3,}/g, "\n\n")
        .trim()

    return `${keptHeader}\n\n${cleanedBody}`.trim()
}

const renderEmail = (email, representation) => (representation === "preprocessed" ? preprocessEmail(email) : email.trim())

// ---------------------------------------------------------------------------
// §3  Distractors
// ---------------------------------------------------------------------------

// In-memory FTS5 over the sampled pool only, so hard negatives need no Postgres
// and no .data/bm25.sqlite. Schema and tokenizer mirror benchmarks/buildBm25Index.js:15-28.
function buildPoolIndex(rows) {
    const database = new DatabaseSync(":memory:")
    database.exec(`
        PRAGMA journal_mode = OFF;
        CREATE VIRTUAL TABLE pool USING fts5(
            path UNINDEXED,
            subject,
            sender,
            recipients,
            content,
            tokenize='porter unicode61'
        );
    `)
    const insert = database.prepare("INSERT INTO pool VALUES (?, ?, ?, ?, ?)")
    database.exec("BEGIN")
    for (const row of rows) {
        const { header, body } = splitEmail(row.email)
        insert.run(
            row.path,
            header.match(/^Subject:\s*(.*)$/mi)?.[1]?.trim() ?? "",
            header.match(/^Sender:\s*(.*)$/mi)?.[1]?.trim() ?? "",
            header.match(/^Recipients:\s*(.*)$/mi)?.[1]?.trim() ?? "",
            body,
        )
    }
    database.exec("COMMIT")
    const statement = database.prepare(`
        SELECT path, -bm25(pool, 0, 1, 1, 1, 1) AS score
        FROM pool
        WHERE pool MATCH ?
        ORDER BY score DESC
        LIMIT ?
    `)
    return {
        hardNegatives(question, goldPath, count) {
            const match = toBm25Query(question)
            if (!match) return []
            return statement.all(match, count + 3)
                .map((result) => result.path)
                .filter((path) => path !== goldPath)
                .slice(0, count)
        },
        close: () => database.close(),
    }
}

function randomNegatives(sortedPaths, goldPath, count, random) {
    const picked = []
    const seen = new Set([goldPath])
    let guard = 0
    while (picked.length < count && guard++ < count * 50) {
        const candidate = sortedPaths[Math.floor(random() * sortedPaths.length)]
        if (seen.has(candidate)) continue
        seen.add(candidate)
        picked.push(candidate)
    }
    return picked
}

// Per-case RNG derives from the question key, never from loop position, so a case
// gets identical distractors regardless of cell order, trims, or restart point.
function buildContext(record, cell, world) {
    if (cell.arm === "floor") return { paths: [], goldPosition: null, distractorPaths: [] }
    if (cell.arm === "oracle") return { paths: [record.path], goldPosition: 0, distractorPaths: [] }

    const random = makeRandom((seed ^ fnv1a32(record.questionKey)) >>> 0)
    const maxDensity = Math.max(...config.distractorDensities)
    // Draw the maximum density once, then slice, so dist4 is a strict subset of
    // dist9 and the dose-response curve is a within-case escalation.
    const drawn = cell.distractorType === "hard"
        ? world.poolIndex.hardNegatives(record.question, record.path, maxDensity)
        : randomNegatives(world.sortedPaths, record.path, maxDensity, random)
    const distractorPaths = drawn.slice(0, cell.distractorCount)

    // Randomised gold position. Always-first would let a model that only reads the
    // top of the context look robust, producing a false "insensitive" verdict.
    const goldPosition = Math.floor(random() * (distractorPaths.length + 1))
    const paths = [...distractorPaths]
    paths.splice(goldPosition, 0, record.path)
    return { paths, goldPosition, distractorPaths }
}

// ---------------------------------------------------------------------------
// §4  Prompts
// ---------------------------------------------------------------------------

function buildAnswerPrompt(question, emails) {
    const block = emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")
    return `You answer questions about a person's email archive using only the emails below.

Rules:
- Answer with one short sentence. No preamble, no explanation, no restating the question.
- Copy names, dates, numbers and amounts exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: NOT IN EMAILS

Emails:
<<<EMAILS
${block}
EMAILS>>>

Question: ${question}
Answer:`
}

function buildNoContextPrompt(question) {
    return `You answer questions about a person's email archive. You have not been given any emails.

Rules:
- Answer with one short sentence. No preamble, no explanation, no restating the question.
- If you do not know the answer, reply with exactly: NOT IN EMAILS

Question: ${question}
Answer:`
}

function buildJudgePrompt(question, references, candidate) {
    const referenceBlock = references.map((reference, index) => `${index + 1}. ${reference}`).join("\n")
    return `You grade a candidate answer to a question about an email.

Question: ${question}

Reference answers (any one of these counts as fully correct):
${referenceBlock}

Candidate answer: ${candidate}

Grade CORRECT if the candidate states the same fact as any reference answer, even if
it is worded differently, is much longer, or adds extra detail that is also correct.
Grade INCORRECT if it states a different fact, contradicts a reference, omits the
specific detail the question asks for, refuses to answer, or says the information is
not available.
Ignore style, length, formatting and verbosity entirely.

Reply with JSON only: {"verdict": "CORRECT" or "INCORRECT", "reason": "at most 12 words"}`
}

const JUDGE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        verdict: { type: "string", enum: ["CORRECT", "INCORRECT"] },
        reason: { type: "string" },
    },
    required: ["verdict", "reason"],
}

const ABSTAIN = "NOT IN EMAILS"
const answerPromptHash = sha12(JSON.stringify([buildAnswerPrompt("Q", ["E"]), buildNoContextPrompt("Q")]))
const judgePromptHash = sha12(buildJudgePrompt("Q", ["R"], "C"))
const distractorSpecHash = sha12(JSON.stringify({
    densities: config.distractorDensities,
    types: ["hard", "random"],
    goldPosition: "randomised",
    nested: true,
    poolSize: config.poolSize,
}))

// ---------------------------------------------------------------------------
// §5  Model clients
// ---------------------------------------------------------------------------

// Retry/timeout shape copied from src/process/embed.js:15-55.
async function ollamaChat({ model, prompt, numCtx, numPredict, format, think, timeoutMs, maxAttempts = 3 }) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(`${config.ollamaUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages: [{ role: "user", content: prompt }],
                    ...(format ? { format } : {}),
                    stream: false,
                    think: think ?? false,
                    keep_alive: "30m",
                    options: { temperature: 0, top_p: 1, seed, num_ctx: numCtx, num_predict: numPredict },
                }),
                signal: AbortSignal.timeout(timeoutMs),
            })
            if (!response.ok) {
                const body = (await response.text()).slice(0, 500)
                const error = new Error(`Ollama HTTP ${response.status}: ${body}`)
                error.retryable = response.status === 408 || response.status === 429 || response.status >= 500
                if (/out of memory|failed to allocate/i.test(body)) {
                    error.retryable = false
                    error.message += `\nHint: lower num_ctx, or set POC_MODEL_LARGE to a smaller model (e.g. gemma4:12b-it-qat).`
                }
                if (response.status === 401 || response.status === 403) {
                    error.message += `\nHint: a "-cloud" model needs an authenticated Ollama account. Run "ollama signin", or point POC_JUDGE_PROVIDER at openrouter with OPENROUTER_API_KEY, or set POC_JUDGE_MODEL to a local model.`
                }
                throw error
            }
            const data = await response.json()
            const content = data.message?.content
            if (typeof content !== "string") {
                const error = new Error("Ollama returned no message content")
                error.retryable = true
                throw error
            }
            // A reasoning model can spend its whole num_predict budget in the thinking
            // channel and return empty visible content. That is a wrong answer, not a
            // missing datapoint, so the caller needs to see why it was empty.
            return { content, thinkingChars: (data.message?.thinking ?? "").length, data, attempts: attempt }
        } catch (error) {
            const retryable = error.retryable ?? (error.name === "TimeoutError" || error instanceof TypeError)
            if (!retryable || attempt === maxAttempts) throw error
            await delay(500 * 2 ** (attempt - 1))
        }
    }
}

// Evicts a model from memory so the next call measures a real cold load.
async function unload(model) {
    try {
        await fetch(`${config.ollamaUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, keep_alive: 0, stream: false }),
            signal: AbortSignal.timeout(30_000),
        })
    } catch {
        // Unloading is an optimisation, never a reason to fail a run.
    }
}

async function listModels() {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Ollama /api/tags returned ${response.status} at ${config.ollamaUrl}`)
    return ((await response.json()).models ?? []).map((model) => model.name)
}

async function showModel(model) {
    const response = await fetch(`${config.ollamaUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) return {}
    const data = await response.json()
    return {
        quantization: data.details?.quantization_level ?? null,
        parameterSize: data.details?.parameter_size ?? null,
        contextLength: data.model_info?.["general.context_length"]
            ?? Object.entries(data.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1]
            ?? data.details?.context_length
            ?? null,
    }
}

async function preflight(models) {
    let available
    try {
        available = await listModels()
    } catch (error) {
        throw new Error(`Cannot reach Ollama at ${config.ollamaUrl}: ${error.message}`)
    }
    const missing = models.filter((model) => !available.includes(model))
    if (missing.length) {
        throw new Error(`Missing Ollama models: ${missing.join(", ")}\nAvailable: ${available.join(", ") || "(none)"}\nPull them first, e.g. ollama pull ${missing[0]}`)
    }
    const info = {}
    for (const model of models) info[model] = await showModel(model)
    return info
}

// ---------------------------------------------------------------------------
// §6  Power monitoring (optional, non-fatal)
// ---------------------------------------------------------------------------

function startPowerMonitor() {
    const monitor = {
        available: false,
        samples: [],
        capacity: 20_000,
        child: null,
        truncatedAtCase: null,
        reason: null,
    }
    if (config.energy === "off") {
        monitor.reason = "disabled"
        return monitor
    }

    let child
    try {
        child = spawn(config.nvidiaSmi, [
            "--query-gpu=power.draw,utilization.gpu,memory.used,clocks.sm",
            "--format=csv,noheader,nounits",
            "-lms", String(config.powerIntervalMs),
        ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    } catch (error) {
        monitor.reason = error.message
        console.warn(`[energy] ${config.nvidiaSmi} could not start (${error.code ?? error.message}); continuing without GPU power. Set POC_ENERGY=off to silence.`)
        return monitor
    }

    monitor.child = child
    let carry = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
        carry += chunk
        const lines = carry.split("\n")
        carry = lines.pop() ?? ""
        for (const line of lines) {
            const watts = Number(line.split(",")[0])
            if (!Number.isFinite(watts)) continue
            monitor.available = true
            monitor.samples.push({ t: performance.now(), watts })
            // Bounded ring: an 8h run at 5Hz would otherwise hold 144k samples.
            if (monitor.samples.length > monitor.capacity) monitor.samples.splice(0, monitor.samples.length - monitor.capacity)
        }
    })
    // An unread stderr pipe fills its 64KB buffer, nvidia-smi blocks on write, and
    // sampling silently stalls. Drain it.
    child.stderr.resume()
    child.on("error", (error) => {
        monitor.reason = error.message
        monitor.available = false
        console.warn(`[energy] ${config.nvidiaSmi} failed (${error.code ?? error.message}); continuing without GPU power.`)
    })
    child.on("close", () => {
        if (monitor.available) monitor.truncatedAtCase = monitor.truncatedAtCase ?? "closed"
        monitor.available = false
    })
    return monitor
}

function integrate(samples, from, to, idleWatts) {
    const window = samples.filter((sample) => sample.t >= from && sample.t <= to)
    if (window.length < 2) return { gross: null, net: null, meanWatts: null, maxWatts: null, count: window.length }
    let gross = 0
    let net = 0
    for (let index = 0; index + 1 < window.length; index++) {
        const seconds = (window[index + 1].t - window[index].t) / 1000
        const average = (window[index].watts + window[index + 1].watts) / 2
        gross += average * seconds
        net += Math.max(0, average - (idleWatts ?? 0)) * seconds
    }
    const watts = window.map((sample) => sample.watts)
    return { gross: round(gross, 1), net: round(net, 1), meanWatts: round(mean(watts), 1), maxWatts: round(Math.max(...watts), 1), count: window.length }
}

async function measureIdle(monitor, milliseconds = 10_000) {
    if (!monitor.available) return null
    const from = performance.now()
    await delay(milliseconds)
    const window = monitor.samples.filter((sample) => sample.t >= from).map((sample) => sample.watts).sort((a, b) => a - b)
    return window.length ? round(percentile(window, 0.5), 1) : null
}

// ---------------------------------------------------------------------------
// §7  Cell matrix
// ---------------------------------------------------------------------------

function buildCellMatrix() {
    const [lowDensity, highDensity] = config.distractorDensities
    const cells = [
        { id: "floor-small", alias: "small", arm: "floor", n: limit, priority: 1 },
        { id: "oracle-small", alias: "small", arm: "oracle", n: limit, priority: 1 },
        { id: `dist${lowDensity}hard-small`, alias: "small", arm: "dist", distractorType: "hard", distractorCount: lowDensity, n: limit, priority: 2 },
        { id: `dist${highDensity}hard-small`, alias: "small", arm: "dist", distractorType: "hard", distractorCount: highDensity, n: limit, priority: 3 },
        { id: `dist${lowDensity}rand-small`, alias: "small", arm: "dist", distractorType: "random", distractorCount: lowDensity, n: limit, priority: 3 },
    ]
    if (config.representationArm) {
        cells.push({ id: "oraclepre-small", alias: "small", arm: "oracle", representation: "preprocessed", n: limit, priority: 4 })
    }
    cells.push(
        { id: "oracle-large", alias: "large", arm: "oracle", n: limit, priority: 0 },
        { id: "floor-large", alias: "large", arm: "floor", n: limit, priority: 5 },
        // No arbitrary cap on the large distractor cells. They carry the small-vs-large
        // noise-sensitivity interaction, so a fixed n=20 could only ever report
        // UNDERPOWERED. trimToDeadline cuts them from measured rates if the night is
        // genuinely too short, which is a decision based on data rather than a guess.
        { id: `dist${lowDensity}hard-large`, alias: "large", arm: "dist", distractorType: "hard", distractorCount: lowDensity, n: limit, priority: 6 },
        { id: `dist${highDensity}hard-large`, alias: "large", arm: "dist", distractorType: "hard", distractorCount: highDensity, n: limit, priority: 7 },
        { id: `dist${lowDensity}rand-large`, alias: "large", arm: "dist", distractorType: "random", distractorCount: lowDensity, n: limit, priority: 8 },
    )
    for (const method of config.phase2Methods) {
        for (const k of config.phase2K) {
            if (method === "hybrid" && k === 1) continue
            cells.push({
                id: `retr-${method}-k${k}-small`,
                alias: "small",
                arm: "retr",
                retrievalMethod: method,
                retrievalK: k,
                n: limit,
                priority: method === "word" ? 9 : 10,
                phase2: true,
            })
        }
    }
    return cells.map((cell) => ({
        representation: "original",
        distractorType: null,
        distractorCount: 0,
        retrievalMethod: null,
        retrievalK: null,
        phase2: false,
        ...cell,
        model: cell.alias === "small" ? config.modelSmall : config.modelLarge,
    }))
}

// num_ctx is shared per arm signature so context size never confounds the
// size comparison, and sized from real prompts so Ollama never silently truncates.
function assignContextSizes(cells, questions, world, modelInfo) {
    const contextLimit = Math.min(
        ...Object.values(modelInfo).map((info) => info.contextLength || Infinity),
        Number(process.env.POC_MAX_NUM_CTX) || Infinity,
    )
    const byArm = new Map()
    for (const cell of cells) {
        const key = `${cell.arm}:${cell.representation}:${cell.distractorCount}:${cell.retrievalK ?? 0}`
        // Every case, not a sample: one long email late in the set would otherwise
        // exceed num_ctx and be silently truncated by Ollama. Prompt building is
        // string work plus in-memory FTS, so this is cheap.
        const sample = questions.slice(0, cell.n)
        let maxTokens = 0
        for (const record of sample) {
            const prompt = cell.arm === "floor"
                ? buildNoContextPrompt(record.question)
                : buildAnswerPrompt(record.question, renderPaths(proxyContextPaths(record, cell, world), cell.representation, world))
            maxTokens = Math.max(maxTokens, estimateTokens(prompt))
        }
        const wanted = nextPowerOfTwo(maxTokens + config.numPredict + 256)
        byArm.set(key, Math.max(byArm.get(key) ?? 0, Math.min(wanted, contextLimit === Infinity ? wanted : contextLimit)))
    }
    for (const cell of cells) {
        const key = `${cell.arm}:${cell.representation}:${cell.distractorCount}:${cell.retrievalK ?? 0}`
        cell.numCtx = byArm.get(key)
    }
    return cells
}

function renderPaths(pathList, representation, world) {
    return pathList.map((path) => renderEmail(world.emailByPath.get(path) ?? "", representation)).filter(Boolean)
}

// Sizing and projection need a realistic prompt for every arm. A retrieval cell
// returns k documents at run time, so approximate it here with the gold email plus
// k-1 hard negatives rather than the gold alone, which would undersize num_ctx.
function proxyContextPaths(record, cell, world) {
    if (cell.arm === "floor") return []
    if (cell.arm !== "retr") return buildContext(record, cell, world).paths
    const negatives = world.poolIndex.hardNegatives(record.question, record.path, Math.max(0, cell.retrievalK - 1))
    return [record.path, ...negatives]
}

function projectCell(cell, questions, world, rates) {
    const rate = rates[cell.alias]
    const sample = questions.slice(0, Math.min(cell.n, 25))
    let promptTokens = 0
    for (const record of sample) {
        const prompt = cell.arm === "floor"
            ? buildNoContextPrompt(record.question)
            : buildAnswerPrompt(record.question, renderPaths(proxyContextPaths(record, cell, world), cell.representation, world))
        promptTokens += estimateTokens(prompt)
    }
    const meanPromptTokens = sample.length ? promptTokens / sample.length : 0
    const perQuestionMs = (meanPromptTokens / rate.prefill + 45 / rate.decode) * 1000
    return { meanPromptTokens: Math.round(meanPromptTokens), perQuestionMs, totalMs: perQuestionMs * cell.n + rate.loadMs }
}

function trimToDeadline(cells, projections, deadlineMs) {
    const trimLog = []
    const ordered = [...cells].sort((a, b) => b.priority - a.priority)
    const total = () => cells.reduce((sum, cell) => sum + projections.get(cell.id).perQuestionMs * cell.n, 0)
    for (const cell of ordered) {
        if (total() <= deadlineMs) break
        if (cell.priority === 0) continue
        const perQuestion = projections.get(cell.id).perQuestionMs
        const affordable = Math.max(0, Math.floor((deadlineMs - (total() - perQuestion * cell.n)) / perQuestion))
        if (affordable >= cell.n) continue
        if (affordable < MIN_PAIRED_N / 3) {
            trimLog.push(`${cell.id} dropped (deadline)`)
            cell.n = 0
        } else {
            trimLog.push(`${cell.id} ${cell.n}->${affordable}`)
            cell.n = affordable
        }
    }
    return trimLog
}

// ---------------------------------------------------------------------------
// §8  JSONL store
// ---------------------------------------------------------------------------

async function readJsonl(path) {
    if (!existsSync(path)) return { records: [], droppedLines: 0 }
    const text = await readFile(path, "utf8")
    const records = []
    let droppedLines = 0
    for (const line of text.split("\n")) {
        if (!line.trim()) continue
        try {
            records.push(JSON.parse(line))
        } catch {
            droppedLines++
        }
    }
    // A crash mid-append leaves a partial final line; without rewriting, the next
    // append continues mid-line and corrupts that record permanently.
    if (droppedLines) {
        const temporary = `${path}.${process.pid}.tmp`
        await writeFile(temporary, records.map((record) => JSON.stringify(record)).join("\n") + "\n")
        await rename(temporary, path)
        console.warn(`[store] recovered ${path}: dropped ${droppedLines} unparseable line(s)`)
    }
    return { records, droppedLines }
}

const appendRecord = async (path, record) => appendFile(path, JSON.stringify(record) + "\n")

function assertMetaCompatible(existing, current) {
    const blocking = ["seed", "limit", "poolSize", "hfSplit", "questionField", "answerPromptHash", "distractorSpecHash"]
    const differing = blocking.filter((key) => existing[key] !== current[key])
    if (differing.length) {
        throw new Error(
            `Existing state in ${stateDir} was produced with different settings (${differing.join(", ")}).\n` +
            `Delete ${stateDir}, or pass a new stateDir, rather than mixing incomparable runs into one report.`,
        )
    }
    if (existing.modelSmall !== current.modelSmall || existing.modelLarge !== current.modelLarge) {
        console.warn(`[store] model tags changed (${existing.modelSmall}/${existing.modelLarge} -> ${current.modelSmall}/${current.modelLarge}); both will appear in the report`)
        return false
    }
    return true
}

// ---------------------------------------------------------------------------
// §9  Stages
// ---------------------------------------------------------------------------

async function buildWorld() {
    const rows = await loadPool()
    const questions = buildQuestionSet(rows, limit)
    if (!questions.length) throw new Error("No usable questions in the pool; check POC_QUESTION_FIELD")
    return {
        rows,
        questions,
        emailByPath: new Map(rows.map((row) => [row.path, row.email])),
        sortedPaths: rows.map((row) => row.path).sort(),
        poolIndex: buildPoolIndex(rows),
    }
}

async function measureRates(model, questions, world, monitor) {
    await unload(model)
    const cells = {
        oracle: { arm: "oracle", representation: "original", distractorType: null, distractorCount: 0 },
        dense: { arm: "dist", representation: "original", distractorType: "hard", distractorCount: Math.max(...config.distractorDensities) },
    }
    let promptTokens = 0
    let promptNs = 0
    let outputTokens = 0
    let outputNs = 0
    let promptChars = 0
    let loadMs = 0
    const calls = []

    for (const [name, cell] of Object.entries(cells)) {
        const count = name === "oracle" ? config.probeN : Math.max(2, Math.ceil(config.probeN / 2))
        for (const record of questions.slice(0, count)) {
            const emails = renderPaths(buildContext(record, cell, world).paths, cell.representation, world)
            const prompt = buildAnswerPrompt(record.question, emails)
            const numCtx = nextPowerOfTwo(estimateTokens(prompt) + config.numPredict + 256)
            const started = performance.now()
            const { content, data } = await ollamaChat({
                model, prompt, numCtx, numPredict: config.numPredict, timeoutMs: config.answerTimeoutMs,
            })
            const wallMs = performance.now() - started
            promptTokens += data.prompt_eval_count || 0
            promptNs += data.prompt_eval_duration || 0
            outputTokens += data.eval_count || 0
            outputNs += data.eval_duration || 0
            promptChars += prompt.length
            loadMs = Math.max(loadMs, ms(data.load_duration))
            const record_ = {
                type: "probe", model, arm: name, numCtx, promptChars: prompt.length,
                promptEvalCount: data.prompt_eval_count ?? null, promptEvalMs: ms(data.prompt_eval_duration),
                evalCount: data.eval_count ?? null, evalMs: ms(data.eval_duration),
                loadMs: ms(data.load_duration), totalMs: ms(data.total_duration), wallMs: Math.round(wallMs),
                answerPreview: content.trim().slice(0, 120),
            }
            calls.push(record_)
            await appendRecord(paths.probe, record_)
            console.log(`[probe] ${model} ${name} ${Math.round(wallMs)}ms ${data.prompt_eval_count ?? "?"}p/${data.eval_count ?? "?"}o`)
        }
    }
    await unload(model)

    const prefill = promptNs > 0 ? promptTokens / (promptNs / 1e9) : 1
    const decode = outputNs > 0 ? outputTokens / (outputNs / 1e9) : 1
    return {
        prefill: round(prefill, 2),
        decode: round(decode, 2),
        loadMs: Math.round(loadMs),
        observedCharsPerToken: promptTokens ? round(promptChars / promptTokens, 3) : null,
        calls: calls.length,
    }
}

async function runProbe(world, modelInfo, monitor) {
    const rates = {}
    rates.small = await measureRates(config.modelSmall, world.questions, world, monitor)
    rates.large = await measureRates(config.modelLarge, world.questions, world, monitor)
    if (config.probeAlt) {
        rates.alt = await measureRates(config.modelAlt, world.questions, world, monitor)
    }

    // Recalibrate the token estimator from what the model actually tokenised.
    const observed = [rates.small.observedCharsPerToken, rates.large.observedCharsPerToken].filter(Boolean)
    if (observed.length) {
        charsPerToken = round(mean(observed), 3)
        await mkdir(stateDir, { recursive: true })
        await writeFile(paths.calibration, JSON.stringify({ charsPerToken, rates }, null, 2) + "\n")
    }

    for (const [alias, rate] of Object.entries(rates)) {
        console.log(`[probe] rates  ${alias}: prefill ${rate.prefill} tok/s  decode ${rate.decode} tok/s  load ${(rate.loadMs / 1000).toFixed(1)}s`)
    }
    if (rates.alt) {
        const speedup = (rates.alt.prefill / rates.large.prefill + rates.alt.decode / rates.large.decode) / 2
        console.log(`[probe] ${config.modelAlt} is ${speedup.toFixed(2)}x ${speedup >= 1 ? "faster" : "slower"} than ${config.modelLarge}`)
    }

    const cells = assignContextSizes(buildCellMatrix(), world.questions, world, modelInfo)
    const projections = new Map(cells.map((cell) => [cell.id, projectCell(cell, world.questions, world, rates)]))
    let cumulative = 0
    console.log(`[probe] cell                       n   promptTok   numCtx   projMin   cumH`)
    for (const cell of cells) {
        const projection = projections.get(cell.id)
        cumulative += projection.perQuestionMs * cell.n
        console.log(`[probe] ${cell.id.padEnd(24)} ${String(cell.n).padStart(4)} ${String(projection.meanPromptTokens).padStart(11)} ${String(cell.numCtx).padStart(8)} ${(projection.perQuestionMs * cell.n / 60000).toFixed(1).padStart(9)} ${(cumulative / 3600000).toFixed(2).padStart(6)}`)
    }
    const totalHours = cumulative / 3600000
    console.log(`[probe] TOTAL PROJECTED ${totalHours.toFixed(1)}h   DEADLINE ${config.deadlineHours.toFixed(1)}h   ${totalHours > config.deadlineHours ? `OVER BY ${(totalHours - config.deadlineHours).toFixed(1)}h` : "FITS"}`)
    if (totalHours > config.deadlineHours && !config.probeAlt) {
        console.log(`[probe] recommendation: pull ${config.modelAlt} and rerun with POC_PROBE_ALT=true, or accept the auto-trim`)
    }
    return { rates, cells, projections, totalHours }
}

async function phase2Preflight(world) {
    if (config.phase2 === "off") return { available: false, reason: "disabled" }
    if (!existsSync(BM25_INDEX_PATH)) {
        return { available: false, reason: `BM25 index missing at ${BM25_INDEX_PATH}; run "npm run index:bm25"` }
    }
    let searchModule
    let prismaModule
    try {
        // Dynamic import only. A static import would load src/db/client.js and
        // Prisma at module init, breaking the DB-free guarantee for Phase 1.
        searchModule = await import("../src/search.js")
        prismaModule = await import("../src/db/client.js")
        await searchModule.search("test", 1, "word")
        if (config.phase2Methods.includes("hybrid") || config.phase2Methods.includes("embedding")) {
            await searchModule.search("test", 1, "embedding")
        }
    } catch (error) {
        return { available: false, reason: error.message.split("\n")[0] }
    }
    // Retrieval recall is meaningless if the gold emails were never ingested.
    const goldPaths = world.questions.map((record) => record.path)
    const found = await prismaModule.prisma.entry.findMany({
        where: { externalId: { in: goldPaths } },
        select: { externalId: true },
    })
    const coverage = goldPaths.length ? found.length / new Set(goldPaths).size : 0
    if (coverage < 0.5) {
        console.warn(`[phase2] corpus coverage only ${(coverage * 100).toFixed(1)}%; retrieval recall will be computed over covered cases only`)
    }
    return { available: true, reason: null, search: searchModule.search, prisma: prismaModule.prisma, coverage: round(coverage) }
}

async function runGenerate(world, cells, monitor, modelInfo, phase2) {
    await mkdir(stateDir, { recursive: true })
    const { records: existing } = await readJsonl(paths.answers)
    const done = new Set(existing.filter((record) => record.type === "answer").map((record) => record.caseKey))
    const meta = {
        type: "meta", seed, limit, poolSize: config.poolSize, hfSplit: config.hfSplit,
        questionField: config.questionField, answerPromptHash, judgePromptHash, distractorSpecHash,
        modelSmall: config.modelSmall, modelLarge: config.modelLarge,
        nodeVersion: process.version, startedAt: new Date().toISOString(),
    }
    const existingMeta = existing.find((record) => record.type === "meta")
    if (existingMeta) assertMetaCompatible(existingMeta, meta)
    else await appendRecord(paths.answers, meta)
    if (done.size) console.log(`[resume] ${done.size} cases already complete`)

    const startedAt = performance.now()
    const deadlineMs = config.deadlineHours * 3600_000
    // Small model first: all of its cells together cost a fraction of one large
    // cell, so kill test B lands before the night is committed to kill test A.
    const ordered = [...cells].sort((a, b) => (a.alias === b.alias ? a.priority - b.priority : a.alias === "small" ? -1 : 1))
    let currentModel = null
    let idleWatts = null

    for (const cell of ordered) {
        if (!cell.n) continue
        if (cell.phase2 && !phase2.available) {
            console.warn(`[phase2] skipped ${cell.id}: ${phase2.reason}`)
            cell.skipped = phase2.reason
            continue
        }
        if (performance.now() - startedAt > deadlineMs) {
            console.warn(`[deadline] stopping before ${cell.id}`)
            cell.skipped = "deadline"
            continue
        }
        if (cell.model !== currentModel) {
            if (currentModel) await unload(currentModel)
            currentModel = cell.model
            idleWatts = await measureIdle(monitor, 10_000)
            if (idleWatts != null) console.log(`[energy] idle baseline ${idleWatts}W before ${cell.model}`)
        }
        console.log(`[cell] ${cell.id}  n=${cell.n}  numCtx=${cell.numCtx}  model=${cell.model}`)

        const cases = world.questions.slice(0, cell.n)
        let errors = 0
        for (const [index, record] of cases.entries()) {
            const caseKey = `${cell.id}|${record.questionKey}`
            if (done.has(caseKey)) continue

            let contextPaths = []
            let goldPosition = null
            let distractorPaths = []
            let retrievalRank = null
            let retrievalMs = null

            let retrievedEmails = null
            if (cell.arm === "retr") {
                const retrievalStarted = performance.now()
                const results = await phase2.search(record.question, cell.retrievalK, cell.retrievalMethod)
                retrievalMs = Math.round(performance.now() - retrievalStarted)
                contextPaths = results.map((result) => result.externalId ?? result.id)
                const rank = contextPaths.indexOf(record.path)
                retrievalRank = rank >= 0 ? rank + 1 : null
                goldPosition = rank >= 0 ? rank : null
                distractorPaths = contextPaths.filter((path) => path !== record.path)
                // search() returns identifiers, not bodies, and retrieval reaches the whole
                // 50k corpus rather than the sampled pool — so the text has to come from the
                // database, or retrieval cells would silently get an empty context.
                const rows = await phase2.prisma.entry.findMany({
                    where: { id: { in: results.map((result) => result.id) } },
                    select: { id: true, content: true },
                })
                const contentById = new Map(rows.map((row) => [row.id, row.content]))
                retrievedEmails = results
                    .map((result) => contentById.get(result.id) ?? world.emailByPath.get(result.externalId) ?? "")
                    .filter(Boolean)
                    .map((email) => renderEmail(email, cell.representation))
            } else {
                const context = buildContext(record, cell, world)
                contextPaths = context.paths
                goldPosition = context.goldPosition
                distractorPaths = context.distractorPaths
            }

            const emails = retrievedEmails ?? renderPaths(contextPaths, cell.representation, world)
            const prompt = cell.arm === "floor" ? buildNoContextPrompt(record.question) : buildAnswerPrompt(record.question, emails)

            const from = performance.now()
            let result
            let error = null
            try {
                result = await ollamaChat({
                    model: cell.model, prompt, numCtx: cell.numCtx,
                    numPredict: config.numPredict, timeoutMs: config.answerTimeoutMs,
                })
            } catch (caught) {
                error = caught.message.slice(0, 300)
                errors++
            }
            const to = performance.now()
            const power = integrate(monitor.samples, from, to, idleWatts)
            const data = result?.data ?? {}
            const answer = result?.content?.trim() ?? null
            const estimated = estimateTokens(prompt)

            await appendRecord(paths.answers, {
                type: "answer", caseKey, cellId: cell.id, arm: cell.arm,
                modelAlias: cell.alias, modelTag: cell.model,
                quantization: modelInfo[cell.model]?.quantization ?? null,
                questionKey: record.questionKey, path: record.path, user: record.user,
                questionIndex: record.questionIndex, question: record.question, includeEmail: record.includeEmail,
                representation: cell.representation,
                contextPaths, contextCount: contextPaths.length,
                goldInContext: contextPaths.includes(record.path), goldPosition,
                distractorType: cell.distractorType, distractorCount: distractorPaths.length, distractorPaths,
                retrievalMethod: cell.retrievalMethod, retrievalK: cell.retrievalK,
                retrievalRank, retrievalHitAtK: cell.arm === "retr" ? retrievalRank != null : null, retrievalMs,
                numCtx: cell.numCtx, promptChars: prompt.length, promptTokensEstimated: estimated, promptSha: sha12(prompt),
                answer, answerChars: answer?.length ?? 0, abstained: answer ? answer.toUpperCase().includes(ABSTAIN) : null,
                emptyAnswer: !error && !answer, thinkingChars: result?.thinkingChars ?? null,
                outputTruncated: data.done_reason === "length",
                promptEvalCount: data.prompt_eval_count ?? null, promptEvalMs: ms(data.prompt_eval_duration),
                evalCount: data.eval_count ?? null, evalMs: ms(data.eval_duration),
                loadMs: ms(data.load_duration), totalMs: ms(data.total_duration), wallMs: Math.round(to - from),
                // Real truncation means Ollama hit the num_ctx ceiling, not that my
                // chars-per-token estimate was off. Comparing against the estimate flags
                // every short prompt, because estimation error is proportionally largest
                // there — floor prompts of ~100 tokens inside a 1024 context are not
                // truncated by anything.
                truncationSuspected: data.prompt_eval_count
                    ? data.prompt_eval_count >= cell.numCtx - config.numPredict - 8
                    : null,
                promptTokensEstimateError: data.prompt_eval_count ? round(data.prompt_eval_count / estimated, 3) : null,
                doneReason: data.done_reason ?? null,
                gpuJoulesGross: power.gross, gpuJoulesNet: power.net,
                gpuWattsMean: power.meanWatts, gpuWattsMax: power.maxWatts,
                idleWatts, powerSamples: power.count, energyReliable: power.count >= 3,
                attempts: result?.attempts ?? null, error,
                startedAt: new Date(Date.now() - (to - from)).toISOString(), finishedAt: new Date().toISOString(),
            })
            done.add(caseKey)

            const percent = Math.round((index + 1) / cases.length * 100)
            console.log(`[${cell.id}] ${index + 1}/${cases.length} (${percent}%) ${Math.round(to - from)}ms ${data.prompt_eval_count ?? "?"}p/${data.eval_count ?? "?"}o${error ? " ERROR" : ""}`)

            if (errors > cases.length * 0.25 && errors > 3) {
                console.warn(`[${cell.id}] abandoning cell: error rate above 25%`)
                cell.aborted = "errorRate"
                break
            }
        }
        if (currentModel) await unload(currentModel)
    }
}

async function judgeOne(task, formatMode) {
    const prompt = buildJudgePrompt(task.question, task.references, task.candidate)
    if (config.judgeProvider === "openrouter") {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            },
            body: JSON.stringify({
                model: config.judgeModel,
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
                max_tokens: 200,
            }),
            signal: AbortSignal.timeout(config.judgeTimeoutMs),
        })
        if (!response.ok) {
            const error = new Error(`OpenRouter HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
            error.retryable = response.status === 429 || response.status >= 500
            if (response.status === 401 || response.status === 403) error.message += "\nCheck OPENROUTER_API_KEY."
            throw error
        }
        const data = await response.json()
        return { content: data.choices?.[0]?.message?.content ?? "", usage: data.usage ?? {} }
    }
    const { content, data } = await ollamaChat({
        model: config.judgeModel, prompt, numCtx: 4096, numPredict: 200,
        format: formatMode === "json" ? JUDGE_SCHEMA : undefined,
        think: config.judgeThink, timeoutMs: config.judgeTimeoutMs, maxAttempts: 5,
    })
    return { content, usage: { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count } }
}

function parseVerdict(content) {
    try {
        const parsed = JSON.parse(content)
        if (parsed.verdict === "CORRECT" || parsed.verdict === "INCORRECT") {
            return { verdict: parsed.verdict, reason: String(parsed.reason ?? "").slice(0, 120) }
        }
    } catch {
        // Fall through to the text path.
    }
    const upper = content.toUpperCase()
    const incorrect = /\bINCORRECT\b/.test(upper)
    const correct = /\bCORRECT\b/.test(upper)
    if (incorrect) return { verdict: "INCORRECT", reason: "parsed from text" }
    if (correct) return { verdict: "CORRECT", reason: "parsed from text" }
    return null
}

function buildValidationTasks(questions) {
    const tasks = []
    for (const record of questions.slice(0, config.validationN)) {
        const references = [record.gold, ...record.alternates]
        tasks.push({
            caseKey: `validate-gold|${record.questionKey}`,
            question: record.question, references: [record.gold], candidate: record.gold,
            validationItem: { kind: "knownCorrectGold", source: "gold_answers", expected: "CORRECT" },
        })
        if (record.alternates[0]) {
            // The alternate is withheld from the reference list on purpose: if it were
            // both candidate and reference the item would be trivially matched.
            tasks.push({
                caseKey: `validate-alt|${record.questionKey}`,
                question: record.question, references: [record.gold], candidate: record.alternates[0],
                validationItem: { kind: "knownCorrectAlt", source: "alternate_answers[0]", expected: "CORRECT" },
            })
        }
        for (const [index, wrong] of record.incorrect.slice(0, 2).entries()) {
            tasks.push({
                caseKey: `validate-wrong|${record.questionKey}|${index}`,
                question: record.question, references, candidate: wrong,
                validationItem: { kind: "knownWrong", source: `incorrect_answers[${index}]`, expected: "INCORRECT" },
            })
        }
    }
    return tasks
}

async function runJudge(world) {
    const { records: answerRecords } = await readJsonl(paths.answers)
    const generated = answerRecords.filter((record) => record.type === "answer")
    const answers = generated.filter((record) => record.answer)
    if (!answers.length) throw new Error("No answers to judge; run the generate stage first")

    // An empty answer (a model that spent num_predict in its thinking channel, or
    // failed outright) is graded INCORRECT rather than dropped. Dropping it would
    // shrink the denominator and inflate that cell's correctness.
    const { records: priorVerdicts } = await readJsonl(paths.verdicts)
    const alreadyGraded = new Set(priorVerdicts.filter((record) => record.type === "verdict").map((record) => record.caseKey))
    let autoGraded = 0
    for (const record of generated) {
        if (record.answer || alreadyGraded.has(record.caseKey)) continue
        await appendRecord(paths.verdicts, {
            type: "verdict", caseKey: record.caseKey, contentSha: null,
            judgeProvider: "none", judgeModel: "none", judgeFormatMode: "auto",
            verdict: "INCORRECT",
            reason: record.error ? "generation failed" : record.outputTruncated ? "empty answer, output truncated at num_predict" : "empty answer",
            judgeMs: 0, judgePromptTokens: null, judgeEvalTokens: null,
            parseFailed: false, error: null, cacheHit: false, autoGraded: true, validationItem: null,
        })
        alreadyGraded.add(record.caseKey)
        autoGraded++
    }
    if (autoGraded) console.warn(`[judge] ${autoGraded} empty/failed answer(s) auto-graded INCORRECT`)

    const byKey = new Map(world.questions.map((record) => [record.questionKey, record]))
    const realTasks = answers.map((answer) => {
        const record = byKey.get(answer.questionKey)
        return {
            caseKey: answer.caseKey,
            question: answer.question,
            references: [record.gold, ...record.alternates],
            candidate: answer.answer,
            validationItem: null,
        }
    })
    // Validation items share the shuffled stream, so the judge cannot tell them
    // from real answers. That is what makes the validation free of human labels.
    const tasks = shuffle([...realTasks, ...buildValidationTasks(world.questions)], makeRandom(seed ^ 0x5bd1e995))

    const { records: existingVerdicts } = await readJsonl(paths.verdicts)
    const done = new Set(existingVerdicts.filter((record) => record.type === "verdict").map((record) => record.caseKey))
    const pending = tasks.filter((task) => !done.has(task.caseKey))
    if (!pending.length) {
        console.log("[judge] all verdicts already present")
        return
    }
    if (done.size) console.log(`[resume] ${done.size} verdicts already complete`)

    let formatMode = "json"
    if (config.judgeProvider === "ollama") {
        try {
            const canary = await judgeOne({ question: "What colour is the sky described as?", references: ["The sky is blue."], candidate: "Blue." }, "json")
            if (!parseVerdict(canary.content)) {
                formatMode = "text"
                console.warn("[judge] model did not honour the JSON schema; using text mode for the whole stage")
            }
        } catch (error) {
            // Only an actual format rejection justifies downgrading the whole stage to
            // text grading. An auth, network or timeout failure is an infrastructure
            // problem, and silently switching grading method because of one would change
            // how every answer in the run is graded, for a reason unrelated to the model.
            if (!/HTTP 400/.test(error.message)) throw error
            formatMode = "text"
            console.warn(`[judge] model rejected the JSON schema (${error.message.split("\n")[0]}); using text mode for the whole stage`)
        }
    } else {
        formatMode = "text"
    }
    const positive = await judgeOne({ question: "Who sent the notice?", references: ["Ameren sent the notice."], candidate: "Ameren sent it." }, formatMode)
    const negative = await judgeOne({ question: "Who sent the notice?", references: ["Ameren sent the notice."], candidate: "Nobody sent anything." }, formatMode)
    const positiveVerdict = parseVerdict(positive.content)?.verdict
    const negativeVerdict = parseVerdict(negative.content)?.verdict
    if (positiveVerdict !== "CORRECT" || negativeVerdict !== "INCORRECT") {
        throw new Error(`Judge canary failed (obvious-correct => ${positiveVerdict}, obvious-wrong => ${negativeVerdict}). Fix the judge before spending ${pending.length} calls.`)
    }
    console.log(`[judge] canary passed in ${formatMode} mode; ${pending.length} to grade`)

    // Temperature 0 makes identical (question, candidate) pairs deterministic, so
    // caching is lossless. Two models often emit the same short answer.
    const cache = new Map(existingVerdicts
        .filter((record) => record.type === "verdict" && record.contentSha)
        .map((record) => [record.contentSha, record]))

    let completed = 0
    const queue = [...pending]
    const workers = Array.from({ length: Math.min(config.judgeConcurrency, queue.length) }, async () => {
        while (queue.length) {
            const task = queue.shift()
            const contentSha = sha12(JSON.stringify([task.question, task.candidate, task.references]))
            const cached = cache.get(contentSha)
            let record
            if (cached) {
                record = { ...cached, caseKey: task.caseKey, cacheHit: true, judgeMs: 0, validationItem: task.validationItem }
            } else {
                const started = performance.now()
                let parsed = null
                let error = null
                let usage = {}
                try {
                    const response = await judgeOne(task, formatMode)
                    parsed = parseVerdict(response.content)
                    usage = response.usage ?? {}
                } catch (caught) {
                    error = caught.message.slice(0, 200)
                }
                record = {
                    type: "verdict", caseKey: task.caseKey, contentSha,
                    judgeProvider: config.judgeProvider, judgeModel: config.judgeModel, judgeFormatMode: formatMode,
                    verdict: parsed?.verdict ?? null, reason: parsed?.reason ?? null,
                    judgeMs: Math.round(performance.now() - started),
                    judgePromptTokens: usage.prompt_tokens ?? null, judgeEvalTokens: usage.completion_tokens ?? null,
                    parseFailed: !parsed, error, cacheHit: false, validationItem: task.validationItem,
                }
                cache.set(contentSha, record)
            }
            await appendRecord(paths.verdicts, record)
            completed++
            if (completed % 25 === 0 || completed === pending.length) {
                console.log(`[judge] ${completed}/${pending.length} (${Math.round(completed / pending.length * 100)}%)`)
            }
        }
    })
    await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// §9b  Report
// ---------------------------------------------------------------------------

function summariseCell(cellId, answers, verdictByKey) {
    const rows = answers.filter((answer) => answer.cellId === cellId)
    if (!rows.length) return null
    const first = rows[0]
    const judged = rows.filter((row) => verdictByKey.get(row.caseKey)?.verdict)
    const correct = judged.filter((row) => verdictByKey.get(row.caseKey).verdict === "CORRECT")
    const abstained = rows.filter((row) => row.abstained)
    const positionBucket = (row) => {
        if (row.goldPosition == null || row.contextCount <= 1) return null
        if (row.goldPosition === 0) return "first"
        return row.goldPosition === row.contextCount - 1 ? "last" : "middle"
    }
    const byPosition = {}
    for (const bucket of ["first", "middle", "last"]) {
        const inBucket = judged.filter((row) => positionBucket(row) === bucket)
        byPosition[bucket] = inBucket.length
            ? round(inBucket.filter((row) => verdictByKey.get(row.caseKey).verdict === "CORRECT").length / inBucket.length)
            : null
    }
    const reliableEnergy = rows.filter((row) => row.energyReliable && row.gpuJoulesNet != null)
    const wallMs = rows.map((row) => row.wallMs)
    const retrievalHits = rows.filter((row) => row.retrievalHitAtK != null)

    return {
        cellId,
        arm: first.arm,
        modelAlias: first.modelAlias,
        modelTag: first.modelTag,
        quantization: first.quantization,
        representation: first.representation,
        distractorType: first.distractorType,
        distractorCount: first.distractorCount,
        retrievalMethod: first.retrievalMethod,
        retrievalK: first.retrievalK,
        numCtx: first.numCtx,
        completed: rows.length,
        errors: rows.filter((row) => row.error).length,
        judged: judged.length,
        correct: correct.length,
        correctness: judged.length ? round(correct.length / judged.length) : null,
        correctnessCi95: wilson(correct.length, judged.length),
        abstainRate: round(abstained.length / rows.length),
        emptyAnswers: rows.filter((row) => row.emptyAnswer).length,
        outputTruncatedCount: rows.filter((row) => row.outputTruncated).length,
        goldInContextRate: round(rows.filter((row) => row.goldInContext).length / rows.length),
        meanGoldPosition: round(mean(rows.map((row) => row.goldPosition).filter((position) => position != null)), 2),
        correctnessByGoldPosition: byPosition,
        retrievalRecallAtK: retrievalHits.length ? round(retrievalHits.filter((row) => row.retrievalHitAtK).length / retrievalHits.length) : null,
        retrievalMs: retrievalHits.length ? distribution(retrievalHits.map((row) => row.retrievalMs).filter(Number.isFinite)) : null,
        promptTokens: distribution(rows.map((row) => row.promptEvalCount).filter(Number.isFinite)),
        outputTokens: distribution(rows.map((row) => row.evalCount).filter(Number.isFinite)),
        truncationSuspectedCount: rows.filter((row) => row.truncationSuspected).length,
        timing: {
            wallMs: distribution(wallMs),
            promptEvalMs: distribution(rows.map((row) => row.promptEvalMs).filter(Number.isFinite)),
            evalMs: distribution(rows.map((row) => row.evalMs).filter(Number.isFinite)),
            loadMsMax: Math.max(0, ...rows.map((row) => row.loadMs || 0)),
        },
        energy: {
            available: reliableEnergy.length > 0,
            gpuOnly: true,
            idleWattsMedian: round(mean(rows.map((row) => row.idleWatts).filter(Number.isFinite)), 1),
            gpuJoulesNet: reliableEnergy.length ? distribution(reliableEnergy.map((row) => row.gpuJoulesNet)) : null,
            gpuWattsMean: round(mean(reliableEnergy.map((row) => row.gpuWattsMean).filter(Number.isFinite)), 1),
            reliableCases: reliableEnergy.length,
            approxSystemJoules: config.systemWattsIdle != null && config.systemWattsBusy != null
                ? round(mean(wallMs) / 1000 * (config.systemWattsBusy - config.systemWattsIdle), 1)
                : null,
        },
        wallClockSeconds: round(wallMs.reduce((sum, value) => sum + value, 0) / 1000, 1),
        questionsPerHour: round(3600 / (mean(wallMs) / 1000), 1),
    }
}

function pairedContrast(cellA, cellB, answers, verdictByKey) {
    const verdictFor = (cellId) => {
        const map = new Map()
        for (const answer of answers.filter((row) => row.cellId === cellId)) {
            const verdict = verdictByKey.get(answer.caseKey)?.verdict
            if (verdict) map.set(answer.questionKey, verdict === "CORRECT")
        }
        return map
    }
    const a = verdictFor(cellA)
    const b = verdictFor(cellB)
    let bOnly = 0
    let aOnly = 0
    let paired = 0
    for (const [key, aCorrect] of a) {
        if (!b.has(key)) continue
        paired++
        const bCorrect = b.get(key)
        if (bCorrect && !aCorrect) bOnly++
        if (aCorrect && !bCorrect) aOnly++
    }
    const rate = (map) => {
        const shared = [...map].filter(([key]) => a.has(key) && b.has(key))
        return shared.length ? round(shared.filter(([, correct]) => correct).length / shared.length) : null
    }
    return {
        contrast: `${cellB} vs ${cellA}`,
        nPaired: paired,
        baseRate: rate(a),
        comparisonRate: rate(b),
        deltaPoints: round(((rate(b) ?? 0) - (rate(a) ?? 0)) * 100, 1),
        mcnemar: { b: bOnly, c: aOnly, exactP: round(mcnemarExactP(bOnly, aOnly), 5) },
    }
}

// The claim "retrieval precision substitutes for parameters" is an interaction, not
// two separate effects: the small model must lose more to distractors than the large
// one does. Every cell shares the same questions, so this is fully paired per question
// and a paired bootstrap gives an honest interval.
function noiseInteraction(label, smallBase, smallDist, largeBase, largeDist, answers, verdictByKey) {
    const correctness = (cellId) => {
        const map = new Map()
        for (const answer of answers.filter((row) => row.cellId === cellId)) {
            const verdict = verdictByKey.get(answer.caseKey)?.verdict
            if (verdict) map.set(answer.questionKey, verdict === "CORRECT" ? 1 : 0)
        }
        return map
    }
    const maps = [smallBase, smallDist, largeBase, largeDist].map(correctness)
    if (maps.some((map) => map.size === 0)) return { available: false, reason: `missing one of ${[smallBase, smallDist, largeBase, largeDist].join(", ")}` }

    const shared = [...maps[0].keys()].filter((key) => maps.every((map) => map.has(key)))
    if (!shared.length) return { available: false, reason: "no shared questions across the four cells" }

    const perQuestion = shared.map((key) => ({
        small: maps[0].get(key) - maps[1].get(key),
        large: maps[2].get(key) - maps[3].get(key),
    }))
    const degradationSmall = mean(perQuestion.map((row) => row.small))
    const degradationLarge = mean(perQuestion.map((row) => row.large))

    const random = makeRandom(seed ^ fnv1a32(label))
    const draws = []
    for (let iteration = 0; iteration < 2000; iteration++) {
        let smallSum = 0
        let largeSum = 0
        for (let index = 0; index < perQuestion.length; index++) {
            const pick = perQuestion[Math.floor(random() * perQuestion.length)]
            smallSum += pick.small
            largeSum += pick.large
        }
        draws.push((smallSum - largeSum) / perQuestion.length)
    }
    draws.sort((a, b) => a - b)

    const interaction = degradationSmall - degradationLarge
    const low = percentile(draws, 0.025)
    const high = percentile(draws, 0.975)
    return {
        available: true,
        contrast: `${label}: (${smallBase} - ${smallDist}) - (${largeBase} - ${largeDist})`,
        nPaired: shared.length,
        degradationSmallPoints: round(degradationSmall * 100, 1),
        degradationLargePoints: round(degradationLarge * 100, 1),
        interactionPoints: round(interaction * 100, 1),
        ci95Points: [round(low * 100, 1), round(high * 100, 1)],
        excludesZero: low > 0 || high < 0,
        reading: low > 0
            ? "the small model loses more to distractors than the large one: retrieval precision does substitute for parameters"
            : high < 0
                ? "the large model loses more, which contradicts the mechanism"
                : "direction is suggestive but the interval spans zero; more questions are needed",
    }
}

function summariseJudgeValidation(verdicts) {
    const items = verdicts.filter((record) => record.validationItem)
    const counts = { tp: 0, fn: 0, tn: 0, fp: 0 }
    const byKind = {}
    for (const item of items) {
        const kind = item.validationItem.kind
        byKind[kind] ??= { n: 0, graded: 0, asExpected: 0 }
        byKind[kind].n++
        if (!item.verdict) continue
        byKind[kind].graded++
        const expected = item.validationItem.expected
        if (expected === item.verdict) byKind[kind].asExpected++
        if (expected === "CORRECT") item.verdict === "CORRECT" ? counts.tp++ : counts.fn++
        else item.verdict === "INCORRECT" ? counts.tn++ : counts.fp++
    }
    const { tp, fn, tn, fp } = counts
    const recall = tp + fn ? tp / (tp + fn) : null
    const specificity = tn + fp ? tn / (tn + fp) : null
    const precision = tp + fp ? tp / (tp + fp) : null
    const falseCorrectRate = fp + tn ? fp / (fp + tn) : null
    return {
        judgeProvider: config.judgeProvider,
        judgeModel: config.judgeModel,
        formatMode: items[0]?.judgeFormatMode ?? null,
        items: items.length,
        byKind,
        ...counts,
        accuracy: round((tp + tn) / Math.max(1, tp + tn + fp + fn)),
        precision: round(precision),
        recall: round(recall),
        specificity: round(specificity),
        f1: precision != null && recall != null && precision + recall > 0 ? round(2 * precision * recall / (precision + recall)) : null,
        falseCorrectRate: round(falseCorrectRate),
        parseFailures: items.filter((item) => item.parseFailed).length,
        usableForAdjustment: recall != null && specificity != null && recall + specificity > 1.05,
        gatePassed: recall != null && falseCorrectRate != null && recall >= JUDGE_MIN_RECALL && falseCorrectRate <= JUDGE_MAX_FALSE_CORRECT,
    }
}

async function runReport(world, extra = {}) {
    const { records: answerRecords, droppedLines: answerDropped } = await readJsonl(paths.answers)
    const { records: verdictRecords, droppedLines: verdictDropped } = await readJsonl(paths.verdicts)
    const answers = answerRecords.filter((record) => record.type === "answer")
    const verdicts = verdictRecords.filter((record) => record.type === "verdict")
    const verdictByKey = new Map(verdicts.map((record) => [record.caseKey, record]))
    const metas = answerRecords.filter((record) => record.type === "meta")

    const cellIds = [...new Set(answers.map((answer) => answer.cellId))]
    const cellSummaries = cellIds.map((cellId) => summariseCell(cellId, answers, verdictByKey)).filter(Boolean)
    const judgeValidation = summariseJudgeValidation(verdicts)
    const find = (cellId) => cellSummaries.find((cell) => cell.cellId === cellId) ?? null

    if (judgeValidation.usableForAdjustment) {
        for (const cell of cellSummaries) {
            cell.correctnessAdjusted = cell.correctness == null
                ? null
                : rogonGladen(cell.correctness, judgeValidation.recall, judgeValidation.specificity)
        }
    }

    const [lowDensity, highDensity] = config.distractorDensities
    const oracleSmall = find("oracle-small")
    const oracleLarge = find("oracle-large")
    const floorSmall = find("floor-small")
    const floorLarge = find("floor-large")

    let killTestA = { available: false, reason: "oracle-small and oracle-large are both required" }
    if (oracleSmall?.correctness != null && oracleLarge?.correctness != null) {
        const contrast = pairedContrast("oracle-small", "oracle-large", answers, verdictByKey)
        const gap = (oracleLarge.correctness - oracleSmall.correctness) * 100
        const aboveFloor = (cell, floor) => floor?.correctness == null || cell.correctness - floor.correctness >= GAP_MIN
        let verdict = "UNDERPOWERED"
        let reason = `nPaired ${contrast.nPaired} < ${MIN_PAIRED_N}`
        if (contrast.nPaired >= MIN_PAIRED_N) {
            if (gap >= GAP_MIN * 100 && contrast.mcnemar.exactP < ALPHA && aboveFloor(oracleSmall, floorSmall) && aboveFloor(oracleLarge, floorLarge)) {
                verdict = "GAP"
                reason = `gap ${gap.toFixed(1)}pt, McNemar p=${contrast.mcnemar.exactP}, both cells clear of their floors`
            } else if (Math.abs(gap) < NULL_MAX * 100 && contrast.mcnemar.exactP > 0.2 && contrast.nPaired >= 80) {
                verdict = "NO_GAP"
                reason = `|gap| ${Math.abs(gap).toFixed(1)}pt < ${NULL_MAX * 100}pt, p=${contrast.mcnemar.exactP}; the abstract can pivot to "retrieval engineering dominates model scale"`
            } else {
                reason = `gap ${gap.toFixed(1)}pt with p=${contrast.mcnemar.exactP}: neither a clear gap nor a clear null`
            }
        }
        killTestA = {
            available: true, ...contrast,
            smallCorrectness: oracleSmall.correctness, largeCorrectness: oracleLarge.correctness,
            gapPoints: round(gap, 1),
            smallFloor: floorSmall?.correctness ?? null, largeFloor: floorLarge?.correctness ?? null,
            timeRatioLargeOverSmall: round(oracleLarge.timing.wallMs.mean / oracleSmall.timing.wallMs.mean, 1),
            gpuJoulesRatio: oracleLarge.energy.gpuJoulesNet && oracleSmall.energy.gpuJoulesNet
                ? round(oracleLarge.energy.gpuJoulesNet.mean / oracleSmall.energy.gpuJoulesNet.mean, 1)
                : null,
            gpuJoulesRatioValid: false,
            verdict, reason,
        }
    }

    const killTestFor = (alias) => {
        const base = find(`oracle-${alias}`)
        if (!base?.correctness) return { available: false, reason: `oracle-${alias} missing or ungraded` }
        const hardLow = pairedContrast(`oracle-${alias}`, `dist${lowDensity}hard-${alias}`, answers, verdictByKey)
        const hardHigh = pairedContrast(`oracle-${alias}`, `dist${highDensity}hard-${alias}`, answers, verdictByKey)
        const random = pairedContrast(`oracle-${alias}`, `dist${lowDensity}rand-${alias}`, answers, verdictByKey)
        const hardHurts = hardLow.deltaPoints <= -GAP_MIN * 100 && hardLow.mcnemar.exactP < ALPHA
        const randomHurts = random.deltaPoints <= -GAP_MIN * 100 && random.mcnemar.exactP < ALPHA
        let verdict = "NOT_SENSITIVE"
        let mechanism = "neither hard negatives nor random noise cost accuracy: kill test B fails, no precision mechanism"
        if (hardHurts && !randomHurts) {
            verdict = "SENSITIVE_TO_HARD_NEGATIVES_ONLY"
            mechanism = `precision, not dilution: hard negatives cost ${Math.abs(hardLow.deltaPoints)}pt (p=${hardLow.mcnemar.exactP}), random noise ${Math.abs(random.deltaPoints)}pt (p=${random.mcnemar.exactP})`
        } else if (hardHurts && randomHurts) {
            verdict = "SENSITIVE_TO_BOTH"
            mechanism = "context dilution, not retrieval quality: the story is about k and token budget"
        } else if (!hardHurts && randomHurts) {
            verdict = "SENSITIVE_TO_RANDOM_ONLY"
            mechanism = "unexpected: random noise hurts but hard negatives do not; check the distractor construction"
        }
        if (Math.min(hardLow.nPaired, random.nPaired) < MIN_PAIRED_N) {
            verdict = "UNDERPOWERED"
            mechanism = `nPaired ${Math.min(hardLow.nPaired, random.nPaired)} < ${MIN_PAIRED_N}`
        }
        return {
            available: true, model: alias, goldOnly: base.correctness,
            hardLow, hardHigh, random,
            monotonicInDensity: hardHigh.comparisonRate != null && hardLow.comparisonRate != null
                ? hardHigh.comparisonRate <= hardLow.comparisonRate
                : null,
            abstainRates: {
                goldOnly: base.abstainRate,
                [`dist${lowDensity}hard`]: find(`dist${lowDensity}hard-${alias}`)?.abstainRate ?? null,
                [`dist${highDensity}hard`]: find(`dist${highDensity}hard-${alias}`)?.abstainRate ?? null,
                [`dist${lowDensity}rand`]: find(`dist${lowDensity}rand-${alias}`)?.abstainRate ?? null,
            },
            verdict, mechanism,
        }
    }

    const killTestB = killTestFor("small")
    const killTestBLarge = killTestFor("large")

    const interactions = {
        hardLow: noiseInteraction(`hard${lowDensity}`, "oracle-small", `dist${lowDensity}hard-small`, "oracle-large", `dist${lowDensity}hard-large`, answers, verdictByKey),
        hardHigh: noiseInteraction(`hard${highDensity}`, "oracle-small", `dist${highDensity}hard-small`, "oracle-large", `dist${highDensity}hard-large`, answers, verdictByKey),
        random: noiseInteraction(`rand${lowDensity}`, "oracle-small", `dist${lowDensity}rand-small`, "oracle-large", `dist${lowDensity}rand-large`, answers, verdictByKey),
    }

    // The oracle cells are the ceiling: with the gold email in hand, this is as well
    // as each model can do. Everything below that ceiling in a deployed system is a
    // retrieval failure, so this prices retrieval against model scale directly.
    const headroom = oracleSmall?.correctness != null && floorSmall?.correctness != null
        ? {
            oracleCeilingSmall: oracleSmall.correctness,
            oracleCeilingLarge: oracleLarge?.correctness ?? null,
            floor: floorSmall.correctness,
            scaleWorthPoints: oracleLarge?.correctness != null ? round((oracleLarge.correctness - oracleSmall.correctness) * 100, 1) : null,
            note: "Expected end-to-end accuracy of a deployed system is approximately retrieval recall@k multiplied by the correctness of the matching distractor cell. Compare that shortfall against scaleWorthPoints to see which lever is larger.",
            projection: [1, 5].map((k) => ({
                k,
                cell: k === 1 ? "oracle-small" : `dist${lowDensity}hard-small`,
                correctnessWithGoldPresent: k === 1 ? oracleSmall.correctness : find(`dist${lowDensity}hard-small`)?.correctness ?? null,
                note: "multiply by your measured recall@k to project end-to-end accuracy",
            })),
        }
        : { available: false }

    const preCell = find("oraclepre-small")
    const representationArm = preCell && oracleSmall
        ? {
            ...pairedContrast("oracle-small", "oraclepre-small", answers, verdictByKey),
            promptTokenDeltaPercent: round((preCell.promptTokens.mean / oracleSmall.promptTokens.mean - 1) * 100, 1),
            wallMsDeltaPercent: round((preCell.timing.wallMs.mean / oracleSmall.timing.wallMs.mean - 1) * 100, 1),
            note: "Preprocessing keeps the quoted reply chain on purpose: on EnronQA the answer often lives in the deepest quoted message.",
        }
        : { available: false, reason: "oraclepre-small not run" }

    const reasons = []
    const warnings = []
    let decision = "INCONCLUSIVE"
    if (!judgeValidation.gatePassed) {
        reasons.push(`judge gate failed (recall ${judgeValidation.recall}, falseCorrectRate ${judgeValidation.falseCorrectRate})`)
    } else if (killTestA.verdict === "GAP") {
        decision = killTestB.verdict?.startsWith("SENSITIVE") ? "GO" : "GAP_BUT_NO_MECHANISM"
        reasons.push(`killTestA ${killTestA.verdict}: ${killTestA.reason}`, `killTestB ${killTestB.verdict}: ${killTestB.mechanism}`)
    } else if (killTestA.verdict === "NO_GAP") {
        decision = "NO_GAP"
        reasons.push(killTestA.reason)
    } else {
        decision = killTestA.verdict ?? "INCONCLUSIVE"
        reasons.push(killTestA.reason ?? "kill test A could not be computed")
    }

    const truncated = cellSummaries.filter((cell) => cell.truncationSuspectedCount > 0)
    if (truncated.length) warnings.push(`prompt truncation suspected in: ${truncated.map((cell) => `${cell.cellId} (${cell.truncationSuspectedCount})`).join(", ")}`)
    const cutOff = cellSummaries.filter((cell) => cell.outputTruncatedCount > 0)
    if (cutOff.length) {
        warnings.push(`output hit num_predict=${config.numPredict} in: ${cutOff.map((cell) => `${cell.cellId} (${cell.outputTruncatedCount})`).join(", ")}. Empty answers from this are graded INCORRECT; raise POC_NUM_PREDICT if the rate is material.`)
    }
    const empties = cellSummaries.filter((cell) => cell.emptyAnswers > 0)
    if (empties.length) {
        warnings.push(`empty answers (graded INCORRECT, not dropped): ${empties.map((cell) => `${cell.cellId} (${cell.emptyAnswers})`).join(", ")}`)
    }
    warnings.push("gpuJoules is GPU-only. The large model runs mostly on CPU on an 8GB card, so its energy is badly undercounted and the ratio may even invert. wallSeconds is the valid cost metric here; whole-system wall power (a logging smart plug) is required before any energy claim in the abstract.")
    if (config.questionField === "questions") {
        warnings.push("POC_QUESTION_FIELD=questions leaks named entities from the gold email into the query, which inflates retrieval recall. Rerun Phase 2 with rephrased_questions.")
    }
    warnings.push(`Hard-negative difficulty is bounded by poolSize=${config.poolSize}; a 50k corpus yields harder negatives.`)
    if (answerDropped || verdictDropped) warnings.push(`recovered truncated JSONL lines: answers ${answerDropped}, verdicts ${verdictDropped}`)

    const report = {
        summary: {
            generatedAt: new Date().toISOString(),
            stage, limit, seed, stateDir,
            poolSize: config.poolSize, hfSplit: config.hfSplit, questionField: config.questionField,
            questionsSampled: world.questions.length,
            models: { small: config.modelSmall, large: config.modelLarge },
            judge: { provider: config.judgeProvider, model: config.judgeModel, localEnergyJoules: config.judgeProvider === "ollama" && config.judgeModel.endsWith("-cloud") ? 0 : null },
            thresholds: { GAP_MIN, NULL_MAX, ALPHA, MIN_PAIRED_N, JUDGE_MIN_RECALL, JUDGE_MAX_FALSE_CORRECT },
            charsPerToken,
            cases: answers.length,
            verdicts: verdicts.length,
            nodeVersion: process.version,
            platform: `${process.platform}/${process.arch}`,
            energyNote: "GPU-only sampling via nvidia-smi, idle-subtracted. Not a whole-system measurement.",
            ...extra,
        },
        premiseVerdict: { decision, reasons, warnings, trimmedCells: extra.trimmedCells ?? [] },
        killTestA,
        killTestB,
        killTestBLarge,
        noiseSensitivityInteraction: interactions,
        headroom,
        representationArm,
        judgeValidation,
        cells: cellSummaries,
        meta: metas,
        examplePrompts: Object.fromEntries(cellIds.map((cellId) => {
            const row = answers.find((answer) => answer.cellId === cellId)
            const record = world.questions.find((question) => question.questionKey === row?.questionKey)
            if (!row || !record) return [cellId, null]
            const emails = row.contextPaths.map((path) => renderEmail(world.emailByPath.get(path) ?? "", row.representation)).filter(Boolean)
            return [cellId, row.arm === "floor" ? buildNoContextPrompt(record.question) : buildAnswerPrompt(record.question, emails)]
        })),
        // Prompt and email text are deliberately excluded: promptSha plus contextPaths
        // reconstruct any case from sample.json and the seed. A 292MB result file
        // already bloated this repo's history once.
        caseRecords: answers.map((answer) => ({
            caseKey: answer.caseKey, questionKey: answer.questionKey, cellId: answer.cellId,
            goldInContext: answer.goldInContext, goldPosition: answer.goldPosition,
            contextPaths: answer.contextPaths, retrievalRank: answer.retrievalRank,
            promptChars: answer.promptChars, promptSha: answer.promptSha, numCtx: answer.numCtx,
            promptEvalCount: answer.promptEvalCount, evalCount: answer.evalCount,
            promptEvalMs: answer.promptEvalMs, evalMs: answer.evalMs, wallMs: answer.wallMs,
            truncationSuspected: answer.truncationSuspected,
            gpuJoulesNet: answer.gpuJoulesNet, energyReliable: answer.energyReliable,
            answer: answer.answer, abstained: answer.abstained,
            emptyAnswer: answer.emptyAnswer, outputTruncated: answer.outputTruncated, thinkingChars: answer.thinkingChars,
            verdict: verdictByKey.get(answer.caseKey)?.verdict ?? null,
            autoGraded: verdictByKey.get(answer.caseKey)?.autoGraded ?? false,
            error: answer.error,
        })),
    }

    await mkdir(dirname(reportFile), { recursive: true })
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n")

    // Everything needed to read the run, small enough to paste. The full file adds
    // per-case records and example prompts, which are for drilling in, not for triage.
    console.log(JSON.stringify({
        provenance: {
            models: report.summary.models,
            judge: report.summary.judge,
            questionsSampled: report.summary.questionsSampled,
            poolSize: report.summary.poolSize,
            questionField: report.summary.questionField,
            seed: report.summary.seed,
            cases: report.summary.cases,
            verdicts: report.summary.verdicts,
        },
        premiseVerdict: report.premiseVerdict,
        killTestA: report.killTestA,
        killTestB: report.killTestB,
        killTestBLarge: report.killTestBLarge,
        noiseSensitivityInteraction: report.noiseSensitivityInteraction,
        headroom: report.headroom,
        representationArm: report.representationArm,
        judgeValidation: report.judgeValidation,
    }, null, 2))
    console.log(`\n[table] cell                       n  judged  correct  ci95            abstain  wallMsP50  promptTokP50`)
    for (const cell of cellSummaries) {
        console.log(`[table] ${cell.cellId.padEnd(24)} ${String(cell.completed).padStart(3)} ${String(cell.judged).padStart(7)} ${String(cell.correctness ?? "-").padStart(8)}  ${`[${cell.correctnessCi95[0] ?? "-"}, ${cell.correctnessCi95[1] ?? "-"}]`.padEnd(16)} ${String(cell.abstainRate).padStart(7)} ${String(cell.timing.wallMs.p50).padStart(10)} ${String(cell.promptTokens.p50 ?? "-").padStart(13)}`)
    }
    console.log(`[report] ${reportFile}`)
    return report
}

// ---------------------------------------------------------------------------
// §10  main
// ---------------------------------------------------------------------------

// Pure helpers are exported so tests/premiseUnits.js can check the statistics and
// the text transforms without Ollama, Postgres or the network.
export {
    wilson, mcnemarExactP, rogonGladen, distribution, percentile, fnv1a32, sha12, nextPowerOfTwo,
    makeRandom, shuffle, splitEmail, preprocessEmail, renderEmail, buildPoolIndex, buildContext,
    buildAnswerPrompt, buildNoContextPrompt, buildJudgePrompt, parseVerdict, readJsonl, appendRecord,
    summariseJudgeValidation, assertMetaCompatible,
}

const invokedPath = process.argv[1] ? await import("node:fs/promises").then(({ realpath }) => realpath(process.argv[1]).catch(() => process.argv[1])) : null
const isMain = invokedPath != null && import.meta.filename === invokedPath

let monitor = { available: false, samples: [], child: null }
let world
let phase2 = { available: false, reason: "not attempted" }

function shutdown(code) {
    monitor.child?.kill()
    process.exit(code)
}
process.on("SIGINT", () => {
    console.warn(`\n[interrupt] rerun the same command to resume from ${paths.answers}`)
    shutdown(130)
})
process.on("SIGTERM", () => shutdown(143))

if (isMain) try {
    if (existsSync(paths.calibration)) {
        const calibration = JSON.parse(await readFile(paths.calibration, "utf8"))
        if (calibration.charsPerToken) charsPerToken = calibration.charsPerToken
    }

    world = await buildWorld()

    if (stage === "report") {
        await runReport(world)
    } else if (stage === "judge") {
        await runJudge(world)
        await runReport(world)
    } else {
        const models = [config.modelSmall, config.modelLarge, ...(config.probeAlt ? [config.modelAlt] : [])]
        const modelInfo = await preflight(models)
        for (const [model, info] of Object.entries(modelInfo)) {
            console.log(`[model] ${model} ${info.parameterSize ?? "?"} ${info.quantization ?? "?"} ctx=${info.contextLength ?? "?"}`)
        }

        monitor = startPowerMonitor()
        if (config.energy !== "off") {
            await delay(3000)
            if (!monitor.available) console.warn(`[energy] no samples from ${config.nvidiaSmi}; continuing without GPU power. Set POC_ENERGY=off to silence.`)
            else console.log(`[energy] sampling at ${1000 / config.powerIntervalMs}Hz`)
        }

        const probe = await runProbe(world, modelInfo, monitor)
        if (stage === "probe") {
            console.log(`[probe] nothing generated; rerun with "all" to commit the run`)
        } else {
            let trimLog = []
            if (probe.totalHours > config.deadlineHours) {
                if (config.abortIfOver) throw new Error(`Projected ${probe.totalHours.toFixed(1)}h exceeds POC_DEADLINE_HOURS=${config.deadlineHours}; set POC_ABORT_IF_OVER=false to auto-trim`)
                trimLog = trimToDeadline(probe.cells, probe.projections, config.deadlineHours * 3600_000)
                for (const entry of trimLog) console.warn(`[trim] ${entry}`)
            }
            phase2 = await phase2Preflight(world)
            if (!phase2.available) console.warn(`[phase2] skipped: ${phase2.reason}`)
            await runGenerate(world, probe.cells, monitor, modelInfo, phase2)
            if (stage === "generate") {
                // Generation is the expensive, unattended half. Stopping here lets the
                // judge run later, or against a different judge, without regenerating.
                console.log(`[generate] complete; grade it with: npm run benchmark:premise -- judge ${limit} ${seed} ${stateDir} ${reportFile}`)
            } else {
                // Generation is the expensive half and is already durable on disk. A judge
                // outage must never cost it, so report what exists and let the judge stage
                // be rerun later.
                let judgeError = null
                try {
                    await runJudge(world)
                } catch (error) {
                    judgeError = error.message
                    console.warn(`\n[judge] FAILED: ${error.message}`)
                    console.warn(`[judge] generation is safe. Fix the above, then: npm run benchmark:premise -- judge ${limit} ${seed} ${stateDir} ${reportFile}`)
                }
                await runReport(world, {
                    judgeError,
                    trimmedCells: trimLog,
                    probeRates: probe.rates,
                    projectedHours: round(probe.totalHours, 2),
                    phase2: { available: phase2.available, reason: phase2.reason, coverage: phase2.coverage ?? null },
                    energy: { available: monitor.available, tool: config.nvidiaSmi, intervalMs: config.powerIntervalMs, reason: monitor.reason },
                })
            }
        }
    }
} finally {
    monitor.child?.kill()
    world?.poolIndex?.close()
    if (phase2.prisma) await phase2.prisma.$disconnect()
}
