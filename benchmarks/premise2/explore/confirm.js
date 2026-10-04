// TEST confirmation of the exploration winner (PREREG-EXPLORE.md, explore-plan.md §9).
//
// The only exploration code that touches TEST. It refuses to generate unless
// PREREG-EXPLORE.md is committed, unmodified, and records the current code hash
// (codeHash() over every exploration module), so nothing can be tuned after the
// pre-registration without it showing.
//
//   run      the frozen winner on the agent's 600 TEST questions (then the rest of
//            the 955 when asked), same weights, Ollama build and generation options as
//            the main run, with the energy logger, idle baseline and per-block markers
//   grade    tier A as in the main study: J1 + J2 on every answer, blind adjudication
//            of disagreements, consensus-INCORRECT and a seeded 10% of consensus-CORRECT
//   analyze  X1 and X2 with the main study's estimator; accuracy, latency and energy
//
// Output: .data/premise2/explore/confirm/ (answers, verdicts, markers, energy) and
// benchmarks/results/premise2/explore/confirm.{json,md}.

import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { chat, version, ps, unload, load } from "../ollama.js"
import { openBm25, mapLimit } from "../bm25.js"
import { ensureEmailStore } from "../agent-run.js"
import { orderedTestRecords } from "../simple.js"
import { AnswerStore, PERMANENT_FAILURES, readJsonl as readStoreJsonl } from "../store.js"
import { judgeConfig, referenceVerdict, adjudicate, preGrade, callJudge, inCorrectAudit, JudgePaused, JudgeAuthError, USAGE } from "../judge.js"
import { gradingUnits, unitVerdictKey, verdictIndex, referencesOf } from "../grade.js"
import { clusterBootstrap, bootstrapP, classify, holm } from "../stats.js"
import { integrateBlocks, summariseEnergy, readJsonl as readEnergyJsonl } from "../energy-integrate.js"
import { startWakeLock } from "../run.js"
import { sha256 } from "../text.js"
import { exploreDirOf } from "./pool.js"
import { ExploreStore, preflight, readJsonl, FINAL_STATUSES } from "./run.js"
import { VARIANTS } from "./variants.js"
import { openRouterUsage, spendSoFar, estimateUsd, entryUsd, TOTAL_CAP_USD } from "./grade.js"

export const WINNER = "gates"
export const RUNNER_UP = "gates6"
export const CELL_ID = "X-explore-gates"
export const ALIAS = "small"
export const CONFIRM_VERSION = "premise2-explore-confirm-v1"
export const MARGIN = 0.05
export const B_CONFIRM = 10_000
export const SEED = 20260922
export const BLOCK_SIZE = 50
export const IDLE_MS = 30_000
export const PREREG_PATH = "benchmarks/premise2/PREREG-EXPLORE.md"
const JUDGE_MODELS = { j1: "openai/gpt-oss-20b", j2: "nvidia/nemotron-3-nano-30b-a3b", adj: "deepseek/deepseek-v4.1-flash" }

const here = fileURLToPath(new URL(".", import.meta.url))
const iso = () => new Date().toISOString()
const now = () => performance.timeOrigin + performance.now()
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN)
const round = (value, digits = 4) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)))
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null)
export const confirmDirOf = (dataDir) => join(exploreDirOf(dataDir), "confirm")

// sha256 over every exploration module (sorted by name), line endings normalised.
export function codeHash() {
    const files = readdirSync(here).filter((name) => name.endsWith(".js")).sort()
    return sha256(files.map((name) => `${name}\n${readFileSync(join(here, name), "utf8").replace(/\r\n/g, "\n")}`).join("\n"))
}

// The pre-registration must be committed, clean, and name the current code hash.
export function assertPreregistered() {
    if (!existsSync(PREREG_PATH)) throw new Error(`${PREREG_PATH} missing: TEST stays closed until the pre-registration is committed`)
    const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
    if (!git("log", "-1", "--format=%H", "--", PREREG_PATH)) throw new Error(`${PREREG_PATH} is not committed`)
    if (git("status", "--porcelain", "--", PREREG_PATH, "benchmarks/premise2/explore")) throw new Error("PREREG-EXPLORE.md or exploration code has uncommitted changes")
    const recorded = readFileSync(PREREG_PATH, "utf8").match(/Code hash: `([0-9a-f]{64})`/)?.[1]
    const current = codeHash()
    if (recorded !== current) throw new Error(`exploration code hash ${current} differs from the pre-registered ${recorded}`)
    return { commit: git("log", "-1", "--format=%H", "--", PREREG_PATH), codeHash: current }
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

// The agent's 600 TEST questions (P-B items 0..599) first, then the rest of the 955.
export function confirmRecords(dataDir, n = 600) {
    const pools = readJson(join(dataDir, "pools.json"))
    const agentItems = readJson(new URL("../agent-items.json", import.meta.url))
    return orderedTestRecords(pools, agentItems).slice(0, n)
}

export const confirmKey = ({ digest, questionKey }) => sha256(`${CONFIRM_VERSION}|${digest}|${WINNER}@${VARIANTS[WINNER].version}|${questionKey}`)

export async function runConfirm({ dataDir, n = 600, ollamaUrl = "http://localhost:11434", log = console.log }) {
    const prereg = assertPreregistered()
    const dir = confirmDirOf(dataDir)
    mkdirSync(dir, { recursive: true })
    const main = readJson(join(dataDir, "run-state.json")).provenance
    const { tag, digest, ollamaVersion } = await preflight({ dataDir, alias: ALIAS, ollamaUrl })
    // The main run's generation options exactly (num_predict 320), not exploration's 160.
    const options = main.options
    const records = confirmRecords(dataDir, n)
    const store = new ExploreStore(join(dir, "answers.jsonl"))
    const pending = records.filter((record) => !store.done(confirmKey({ digest, questionKey: record.questionKey })))
    log(`[confirm] ${WINNER} on TEST: ${pending.length} pending of ${records.length}; prereg ${prereg.commit.slice(0, 10)}, code ${prereg.codeHash.slice(0, 12)}`)
    if (!pending.length) return
    const markersPath = join(dir, "markers.jsonl")
    const marker = (kind, extra = {}) => appendFileSync(markersPath, JSON.stringify({ t: now(), at: iso(), kind, model: ALIAS, cell: CELL_ID, ...extra }) + "\n")
    let logger = null
    if (process.env.POC2_ENERGY !== "off") {
        const args = [join(here, "..", "energy-logger.js"), "--out", join(dir, "energy.jsonl")]
        if (process.env.POC2_LHM_URL) args.push("--lhm-url", process.env.POC2_LHM_URL)
        logger = spawn(process.execPath, args, { stdio: "ignore", windowsHide: true })
        log(`[confirm] energy logger started (pid ${logger.pid})`)
    }
    const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), log)
    const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
    const wakeLock = startWakeLock(log)
    try {
        // Fresh load, two warm-up calls, then a 30 s idle baseline with the model resident.
        for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
        marker("load-start")
        const loaded = await load(ollamaUrl, tag)
        marker("load-end", loaded)
        if (loaded.status !== "ok") throw new Error(`load ${tag}: ${loaded.status}`)
        for (let index = 0; index < 2; index++) await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: { ...options, num_predict: 8 } })
        marker("ps", { snapshot: (await ps(ollamaUrl)).map((model) => ({ name: model.name, size: model.size, sizeVram: model.size_vram, contextLength: model.context_length })) })
        const idleId = `idle:${ALIAS}:${iso()}`
        marker("idle-start", { blockId: idleId })
        await delay(IDLE_MS)
        marker("idle-end", { blockId: idleId })
        for (let start = 0; start < pending.length; start += BLOCK_SIZE) {
            const block = pending.slice(start, start + BLOCK_SIZE)
            const blockId = `${CELL_ID}:${ALIAS}:${iso()}`
            if ((await version(ollamaUrl)) !== ollamaVersion) throw new Error(`Ollama version changed from ${ollamaVersion} during the run`)
            marker("block-start", { blockId })
            for (const record of block) {
                const tally = { calls: 0, genMs: 0, promptTokens: 0, outputTokens: 0, maxLoadMs: 0, searchMs: 0, searches: 0, statuses: [] }
                const ctx = {
                    alias: ALIAS, tag,
                    emailOf: emails.emailOf,
                    emailMap: { get: emails.emailOf },
                    search: async (query, k, user = null) => {
                        const started = performance.now()
                        const paths = bm25.search(query, k, user).map((hit) => hit.path)
                        tally.searchMs += performance.now() - started
                        tally.searches++
                        return paths
                    },
                    generate: async ({ prompt, messages, options: override, think = false }) => {
                        const result = await chat({ url: ollamaUrl, model: tag, prompt, messages, options: override ?? options, think })
                        tally.calls++
                        tally.genMs += result.wallMs ?? 0
                        tally.promptTokens += result.promptEvalCount ?? 0
                        tally.outputTokens += result.evalCount ?? 0
                        tally.maxLoadMs = Math.max(tally.maxLoadMs, result.loadMs ?? 0)
                        tally.statuses.push(result.status)
                        return result
                    },
                }
                const started = performance.now()
                let result
                try {
                    result = await VARIANTS[WINNER].run(ctx, record)
                } catch (error) {
                    result = { status: "http_error", answer: "", error: String(error.message).slice(0, 300) }
                }
                store.add({
                    key: confirmKey({ digest, questionKey: record.questionKey }), variant: WINNER, version: VARIANTS[WINNER].version, confirmVersion: CONFIRM_VERSION,
                    alias: ALIAS, digest, questionKey: record.questionKey, user: record.user, blockId, wallMs: Math.round(performance.now() - started),
                    ...tally, searchMs: Math.round(tally.searchMs), reloaded: tally.maxLoadMs > 1_000, ollamaVersion, at: iso(), ...result,
                })
            }
            marker("block-end", { blockId })
            log(`[confirm] ${Math.min(start + BLOCK_SIZE, pending.length)}/${pending.length}`)
        }
    } finally {
        wakeLock?.kill()
        bm25.close()
        emails.close()
        try { logger?.kill() } catch { /* already gone */ }
    }
}

// Final confirm answer per question (the latest final record; a question whose
// attempts all failed keeps its last failure, which grades INCORRECT).
export function confirmAnswers(dataDir) {
    const byKey = new Map()
    for (const record of readJsonl(join(confirmDirOf(dataDir), "answers.jsonl"))) {
        const previous = byKey.get(record.key)
        if (!previous || FINAL_STATUSES.has(record.status) || !FINAL_STATUSES.has(previous.status)) byKey.set(record.key, record)
    }
    return [...byKey.values()]
}

// Grading units in the main study's shape. The adjudicator's evidence key is the
// set of emails the final answer call saw.
export function confirmUnits(dataDir) {
    const pools = readJson(join(dataDir, "pools.json"))
    const recordByKey = new Map(pools.test.map((record) => [record.questionKey, record]))
    return confirmAnswers(dataDir).map((answer) => {
        const paths = answer.readPaths ?? answer.contextPaths ?? []
        return {
            cellId: CELL_ID, role: "primary", tier: "A", alias: ALIAS, answer, answerKey: answer.key, record: recordByKey.get(answer.questionKey),
            item: { questionKey: answer.questionKey, promptSha: sha256(`${CONFIRM_VERSION}|${JSON.stringify(paths)}`), paths },
        }
    })
}

const mainVerdictRecords = (dataDir) => {
    const agent = join(dataDir, "agent", "verdicts.jsonl")
    return [...readStoreJsonl(join(dataDir, "verdicts.jsonl")).records, ...(existsSync(agent) ? readStoreJsonl(agent).records : [])]
}

export async function gradeConfirm({ dataDir, loadCorpus, log = console.log }) {
    for (const [role, model] of Object.entries(JUDGE_MODELS)) {
        const judge = judgeConfig(role)
        if (judge.provider !== "openrouter" || judge.model !== model) throw new Error(`tier-A grading requires the study's OpenRouter ${role} model ${model}; no verdicts were written`)
    }
    const spent = spendSoFar(dataDir)
    if (spent >= TOTAL_CAP_USD) throw new Error(`total spend cap reached: $${spent.toFixed(3)}`)
    const dir = confirmDirOf(dataDir)
    const verdictsPath = join(dir, "verdicts.jsonl")
    const units = confirmUnits(dataDir)
    const pre = new Map(units.map((unit) => [unit, preGrade(unit.answer)]))
    const judgeable = units.filter((unit) => !pre.get(unit))
    const records = [...mainVerdictRecords(dataDir), ...readStoreJsonl(verdictsPath, { repair: true }).records]
    const width = Number(process.env.POC2_JUDGE_CONCURRENCY ?? 8)
    const session = process.env.POC2_GRADE_SESSION ?? iso().slice(0, 10)
    log(`[confirm-grade] ${units.length} answers, ${units.length - judgeable.length} pre-graded; spend so far $${spent.toFixed(3)}`)
    const usageBefore = await openRouterUsage()
    const item = (unit) => ({ question: unit.record.question, references: referencesOf(unit.record), candidate: unit.answer.answer })
    let paused = null
    const pass = async (label, judge, selected, call) => {
        const have = new Set(verdictIndex(records, judge.role, judge.model).keys())
        const tasks = []
        const seen = new Set()
        for (const unit of selected) {
            const key = unitVerdictKey(unit, judge)
            if (have.has(key) || seen.has(key)) continue
            seen.add(key)
            tasks.push({ unit, key })
        }
        log(`[confirm-grade] ${label}: ${tasks.length} calls to ${judge.model}`)
        await mapLimit(tasks, width, async ({ unit, key }) => {
            if (paused) return
            let result
            try {
                result = await call(unit)
            } catch (error) {
                if (error instanceof JudgePaused || error instanceof JudgeAuthError) { paused = error.message; return }
                result = { verdict: null, error: error.message.slice(0, 200) }
            }
            const verdict = {
                type: "verdict", tier: "test", judge: judge.role, judgeModel: judge.model, provider: judge.provider, think: judge.think,
                verdictKey: key, questionKey: unit.item.questionKey, cellId: unit.cellId, alias: unit.alias, answerKey: unit.answerKey,
                promptSha: judge.role === "adj" ? unit.item.promptSha : undefined, session, at: iso(), ...result,
            }
            appendFileSync(verdictsPath, JSON.stringify(verdict) + "\n")
            records.push(verdict)
        })
    }
    const [j1, j2] = [judgeConfig("j1"), judgeConfig("j2")]
    const adj = { ...judgeConfig("adj"), model: JUDGE_MODELS.adj }
    await pass("J1", j1, judgeable, (unit) => referenceVerdict(j1, item(unit), {}))
    await pass("J2", j2, judgeable, (unit) => referenceVerdict(j2, item(unit), {}))
    const j1Index = verdictIndex(records, "j1", j1.model)
    const j2Index = verdictIndex(records, "j2", j2.model)
    const toAdjudicate = judgeable.filter((unit) => {
        const v1 = j1Index.get(unitVerdictKey(unit, j1))?.verdict
        const v2 = j2Index.get(unitVerdictKey(unit, j2))?.verdict
        return v1 && v2 && (v1 !== v2 || v1 === "INCORRECT" || inCorrectAudit(`${unit.cellId}|${unit.alias}|${unit.item.questionKey}`))
    })
    if (toAdjudicate.length && !paused) {
        await callJudge(adj, 'Reply with JSON only: {"ping": true}', undefined, { timeoutMs: 90_000 })
        const { emailByPath, evidence } = await loadCorpus()
        const supporting = (unit) => {
            const record = unit.record
            const paths = new Set([record.path, ...(record.twins ?? [])])
            for (const path of unit.item.paths) if (!paths.has(path) && evidence.answerBearing(path, record) === true) paths.add(path)
            return [...paths].map((path) => emailByPath.get(path)).filter(Boolean)
        }
        const shown = (unit) => (unit.item.paths.length ? unit.item.paths : [unit.record.path]).map((path) => emailByPath.get(path) ?? "")
        await pass("adjudication", adj, toAdjudicate, (unit) => adjudicate(adj, { ...item(unit), emails: shown(unit) }, supporting(unit), {}))
    }
    const usageAfter = await openRouterUsage()
    const tokens = Object.fromEntries(USAGE)
    const entry = { at: iso(), phase: "confirm", usd: usageBefore != null && usageAfter != null ? usageAfter - usageBefore : null, estUsd: estimateUsd(tokens), usageBefore, usageAfter, tokens }
    appendFileSync(join(exploreDirOf(dataDir), "spend.jsonl"), JSON.stringify(entry) + "\n")
    log(`[confirm-grade] done: $${entryUsd(entry).toFixed(4)} this session, total $${(spent + entryUsd(entry)).toFixed(3)}${paused ? `; PAUSED: ${paused}` : ""}`)
    return { paused, usd: entryUsd(entry) }
}

// Score one unit exactly as report.js scoreUnit does for tier A, except that the
// winner's context overflow is its own failure (INCORRECT), not an exclusion: its
// prompts are built at run time, so an overflow is part of the pipeline being tested.
export function scoreWith({ j1, j2, adj, j1Index, j2Index, adjIndex }) {
    return (unit, { overflowIsWrong = false } = {}) => {
        if (PERMANENT_FAILURES.has(unit.answer.status)) return overflowIsWrong ? { final: 0, j1: 0, pre: "overflow" } : { final: null, j1: null, excluded: unit.answer.status }
        if (preGrade(unit.answer)) return { final: 0, j1: 0, pre: true }
        const bit = (verdict) => (verdict == null ? null : verdict === "CORRECT" ? 1 : 0)
        const v1 = j1Index.get(unitVerdictKey(unit, j1))?.verdict ?? null
        const v2 = j2Index.get(unitVerdictKey(unit, j2))?.verdict ?? null
        const va = adjIndex.get(unitVerdictKey(unit, adj))?.verdict ?? null
        const consensus = v1 && v2 ? (v1 === v2 ? bit(v1) : null) : null
        return { final: va != null ? bit(va) : consensus, j1: bit(v1) }
    }
}

export async function analyzeConfirm({ dataDir, log = console.log, outDir = "benchmarks/results/premise2/explore" }) {
    const state = readJson(join(dataDir, "run-state.json"))
    const { cells } = readJson(join(dataDir, "cells.json"))
    const pools = readJson(join(dataDir, "pools.json"))
    const recordByKey = new Map([...pools.dev, ...pools.test, ...pools.bridge].map((record) => [record.questionKey, record]))
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    const verdicts = [...mainVerdictRecords(dataDir), ...readStoreJsonl(join(confirmDirOf(dataDir), "verdicts.jsonl")).records]
    const j1 = judgeConfig("j1")
    const j2 = judgeConfig("j2")
    // The adjudicator the main report used: the model with the most adjudications.
    const adjCounts = new Map()
    for (const record of verdicts) if (record.type === "verdict" && record.judge === "adj" && record.verdict) adjCounts.set(record.judgeModel, (adjCounts.get(record.judgeModel) ?? 0) + 1)
    const adj = { ...judgeConfig("adj"), model: [...adjCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? JUDGE_MODELS.adj }
    const score = scoreWith({ j1, j2, adj, j1Index: verdictIndex(verdicts, "j1", j1.model), j2Index: verdictIndex(verdicts, "j2", j2.model), adjIndex: verdictIndex(verdicts, "adj", adj.model) })

    const order = confirmRecords(dataDir, 955).map((record) => record.questionKey)
    const first600 = new Set(order.slice(0, 600))
    const pbUnits = gradingUnits({ cells, state, store, recordByKey }).filter((unit) => unit.cellId === "P-B")
    const arm = (units, options) => new Map(units.map((unit) => [unit.item.questionKey, { unit, ...score(unit, options) }]))
    const arms = {
        winner: arm(confirmUnits(dataDir), { overflowIsWrong: true }),
        winnerExcl: arm(confirmUnits(dataDir)),
        e2bPB: arm(pbUnits.filter((unit) => unit.alias === "small")),
        b31PB: arm(pbUnits.filter((unit) => unit.alias === "large")),
    }
    const boot = (rows, statistic) => clusterBootstrap({ items: rows, clusterOf: (row) => row.user, statistic, B: B_CONFIRM, seed: SEED })
    const contrast = (name, a, b, { kind = "final", keys = first600, type = "superiority", margin = 0 } = {}) => {
        const rows = []
        for (const key of keys) {
            const x = arms[a].get(key)?.[kind]
            const y = arms[b].get(key)?.[kind]
            if (x == null || y == null) continue
            rows.push({ user: recordByKey.get(key).user, a: x, b: y })
        }
        if (rows.length < 2) return { name, n: rows.length, label: "NOT RUN" }
        const result = boot(rows, (sample) => mean(sample.map((row) => row.a - row.b)))
        const p = bootstrapP(result, { kind: type, margin })
        return {
            name, kind, type, margin, n: rows.length, clusters: result.clusters,
            armMeans: [round(mean(rows.map((row) => row.a))), round(mean(rows.map((row) => row.b)))],
            estimate: round(result.estimate), low: round(result.low), high: round(result.high), p: round(p, 5),
            label: classify({ estimate: result.estimate, low: result.low, high: result.high, margin, kind: type }),
            discordant: { onlyFirst: rows.filter((row) => row.a > row.b).length, onlySecond: rows.filter((row) => row.a < row.b).length },
        }
    }
    const confirmatory = {
        X1: contrast("X1 e2b(winner) - e2b(P-B), superiority", "winner", "e2bPB"),
        X2ni: contrast("X2 e2b(winner) - 31b(P-B), non-inferiority at 5 pts", "winner", "b31PB", { type: "noninferiority", margin: MARGIN }),
        X2sup: contrast("X2 e2b(winner) - 31b(P-B), superiority", "winner", "b31PB"),
    }
    const family = ["X1", "X2ni", "X2sup"].filter((id) => confirmatory[id].p != null)
    const adjusted = holm(family.map((id) => confirmatory[id].p))
    family.forEach((id, index) => { confirmatory[id].holmP = round(adjusted[index], 5) })
    const all955 = new Set(order)
    const secondary = {
        X1j1: contrast("X1, J1 only", "winner", "e2bPB", { kind: "j1" }),
        X2j1: contrast("X2, J1 only (superiority)", "winner", "b31PB", { kind: "j1" }),
        X1overflowExcluded: contrast("X1, winner overflow excluded", "winnerExcl", "e2bPB"),
        X2overflowExcluded: contrast("X2 NI, winner overflow excluded", "winnerExcl", "b31PB", { type: "noninferiority", margin: MARGIN }),
        X1all955: contrast("X1 on every TEST question run", "winner", "e2bPB", { keys: all955 }),
    }

    // Latency and energy for the winner, against the main study's e2b P-B.
    const answers = confirmAnswers(dataDir).filter((answer) => first600.has(answer.questionKey))
    const walls = answers.map((answer) => answer.wallMs).sort((a, b) => a - b)
    const finals600 = [...arms.winner.values()].filter((entry) => first600.has(entry.unit.item.questionKey) && entry.final != null)
    const accuracy = mean(finals600.map((entry) => entry.final))
    let energy = null
    const energyPath = join(confirmDirOf(dataDir), "energy.jsonl")
    if (existsSync(energyPath)) {
        const samples = (await readEnergyJsonl(energyPath)).records
        const blocks = integrateBlocks({ samples, markers: readJsonl(join(confirmDirOf(dataDir), "markers.jsonl")) })
        const perBlock = {}
        for (const answer of confirmAnswers(dataDir)) if (answer.blockId) perBlock[answer.blockId] = (perBlock[answer.blockId] ?? 0) + 1
        const summary = summariseEnergy(blocks, perBlock)
        const entry = Object.values(summary.byModelCell)[0] ?? null
        energy = {
            label: "CPU package + GPU only: a lower bound, as in the main study",
            sources: { gpu: samples.filter((s) => s.src === "gpu").length, cpu: samples.filter((s) => s.src === "cpu").length, status: samples.filter((s) => s.src === "status").slice(-5) },
            grossJPerAnswer: entry?.grossJPerAnswer ?? null, marginalJPerAnswer: entry?.marginalJPerAnswer ?? null,
            grossJPerCorrect: entry?.grossJPerAnswer?.mean != null ? round(entry.grossJPerAnswer.mean / accuracy, 1) : null,
            marginalJPerCorrect: entry?.marginalJPerAnswer?.mean != null ? round(entry.marginalJPerAnswer.mean / accuracy, 1) : null,
        }
    }
    const mainReportPath = "benchmarks/results/premise2/report.json"
    const mainReport = existsSync(mainReportPath) ? readJson(mainReportPath) : null
    const out = {
        version: CONFIRM_VERSION, winner: WINNER, at: iso(), codeHash: codeHash(),
        judges: { j1: j1.model, j2: j2.model, adj: adj.model },
        counts: { answers: confirmAnswers(dataDir).length, first600: answers.length, overflow: answers.filter((answer) => PERMANENT_FAILURES.has(answer.status)).length, unresolved600: [...arms.winner.values()].filter((entry) => first600.has(entry.unit.item.questionKey) && entry.final == null).length },
        accuracy600: round(accuracy), confirmatory, secondary,
        latency: { meanMs: Math.round(mean(walls)), p50Ms: quantile(walls, 0.5), p95Ms: quantile(walls, 0.95), meanCalls: round(mean(answers.map((answer) => answer.calls)), 3), switched: answers.filter((answer) => answer.switched).length, retried: answers.filter((answer) => answer.used === 2).length },
        energy,
        mainStudy: mainReport ? { energy: mainReport.energy?.perCorrect ?? mainReport.energy ?? null } : null,
    }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "confirm.json"), JSON.stringify(out, null, 2))
    const fmt = (test) => (test.estimate == null ? `${test.name}: NOT RUN` : `| ${test.name} | ${test.n} | ${(test.armMeans[0] * 100).toFixed(1)} vs ${(test.armMeans[1] * 100).toFixed(1)} | ${(test.estimate * 100).toFixed(1)} [${(test.low * 100).toFixed(1)}, ${(test.high * 100).toFixed(1)}] | ${test.p} | ${test.holmP ?? "–"} | ${test.label} |`)
    const md = [
        `# Exploration winner on TEST (${WINNER})`, "",
        `Tier A (J1 ${j1.model}, J2 ${j2.model}, adjudicator ${adj.model}); paired mailbox-cluster bootstrap, B = ${B_CONFIRM}, seed ${SEED}. Code hash \`${out.codeHash}\`.`, "",
        "| test | n | arm means | Δ [95% CI] | p | Holm p | label |", "|---|---|---|---|---|---|---|",
        ...Object.values(confirmatory).map(fmt), "", "Secondary:", "",
        "| test | n | arm means | Δ [95% CI] | p | Holm p | label |", "|---|---|---|---|---|---|---|",
        ...Object.values(secondary).map(fmt), "",
        `Latency (600): mean ${out.latency.meanMs} ms, p50 ${out.latency.p50Ms}, p95 ${out.latency.p95Ms}; calls/question ${out.latency.meanCalls}; switched ${out.latency.switched}, retried ${out.latency.retried}; context overflow ${out.counts.overflow}; unresolved ${out.counts.unresolved600}.`,
        energy ? `Energy (lower bound): gross ${energy.grossJPerAnswer?.mean} J/answer, marginal ${energy.marginalJPerAnswer?.mean} J/answer; per correct: gross ${energy.grossJPerCorrect} J, marginal ${energy.marginalJPerCorrect} J.` : "Energy: no samples.",
    ].join("\n")
    writeFileSync(join(outDir, "confirm.md"), md + "\n")
    log(md)
    return out
}
