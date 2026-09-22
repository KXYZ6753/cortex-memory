// Stage 0: probe. Every decision it makes is pre-registered and frozen in the run
// state, so the rest of the run has no human decision points.
//
//  - 3 sanity answers per model (status ok, no reload inside a block)
//  - 31b output length under T2 on 30 oracle + 30 k=5 DEV prompts; if its mean
//    exceeds 1.3x V1's 18.7 tokens, num_predict drops from 320 to 160 for ALL models
//  - GPU share (size_vram / size) for every model at num_ctx 16384
//  - one deliberately oversize prompt, which must come back as context_overflow
//  - the Gemma-4 template offset (31b prompt_eval_count = e2b + 4)
//  - tiny oracle on 50 DEV questions graded by J1: below 0.5 the tiny model is dropped
//  - cloud judge throughput at concurrency 1 and 3, and adjudicator availability

import { chat, generationOptions, ps, unload, load } from "./ollama.js"
import { MODELS, JUDGES } from "./cells.js"
import { referenceVerdict, preGrade, callJudge, judgeConfig, JudgePaused } from "./judge.js"
import { mapLimit } from "./bm25.js"

const V1_MEAN_OUTPUT_TOKENS = 18.7
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

export async function runProbe({ cells, prompts, recordByKey, ollamaUrl, log, limits = { tiny: 50, large: 30, judge: 30 } }) {
    const summary = { at: new Date().toISOString(), models: {}, checks: {} }
    const options = generationOptions()
    const oracle = cells.get("PR-oracle")
    const baseline = cells.get("PR-B")

    const generate = async (alias, items) => {
        const out = []
        for (const item of items) out.push({ item, result: await chat({ url: ollamaUrl, model: MODELS[alias].tag, prompt: prompts.get(item.promptSha), options }) })
        return out
    }

    for (const alias of ["small", "tiny", "mid", "bridge", "large"]) {
        for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)
        const loaded = await load(ollamaUrl, MODELS[alias].tag)
        const snapshot = (await ps(ollamaUrl)).find((model) => model.name === MODELS[alias].tag)
        const gpuShare = snapshot?.size ? snapshot.size_vram / snapshot.size : null
        const sanity = await generate(alias, oracle.items.slice(0, 3))
        const entry = {
            tag: MODELS[alias].tag,
            coldLoadMs: loaded.coldLoadMs,
            gpuShare: gpuShare === null ? null : Number(gpuShare.toFixed(3)),
            contextLength: snapshot?.context_length ?? null,
            sanity: sanity.map(({ result }) => ({ status: result.status, wallMs: result.wallMs, loadMs: result.loadMs, promptEvalCount: result.promptEvalCount, evalCount: result.evalCount })),
        }
        if (alias !== "large" && alias !== "small" && gpuShare !== null && gpuShare < 0.999) log(`[probe] NOTE ${alias} is partially offloaded (GPU share ${(gpuShare * 100).toFixed(0)}%); its cost is labelled "partially offloaded"`)
        if (alias === "small") {
            // One deliberately oversize prompt: must fail loudly, never be truncated.
            const oversize = `You answer questions.\n\n${"The quick brown fox jumps over the lazy dog. ".repeat(9000)}\n\nQuestion: What jumps?\nAnswer:`
            const overflow = await chat({ url: ollamaUrl, model: MODELS.small.tag, prompt: oversize, options, attempts: 1 })
            summary.checks.overflow = { status: overflow.status, expected: "context_overflow", pass: overflow.status === "context_overflow", error: overflow.error?.slice(0, 200) ?? null, promptEvalCount: overflow.promptEvalCount ?? null }
            if (!summary.checks.overflow.pass) log(`[probe] WARNING oversize prompt returned ${overflow.status}, not context_overflow: truncate:false may be ignored by this Ollama build`)
        }
        if (alias === "tiny") {
            const tinyAnswers = await generate("tiny", oracle.items.slice(0, limits.tiny))
            let correct = 0
            let graded = 0
            let judgeError = null
            for (const { item, result } of tinyAnswers) {
                const record = recordByKey.get(item.questionKey)
                const pre = preGrade({ status: result.status, answer: result.answer })
                try {
                    const verdict = pre ? pre.final : (await referenceVerdict(judgeConfig("j1"), { question: record.question, references: [record.gold, ...(record.alternates ?? [])], candidate: result.answer }, { ollamaUrl })).verdict
                    if (verdict) graded++
                    if (verdict === "CORRECT") correct++
                } catch (error) {
                    judgeError = error.message
                    break
                }
            }
            const accuracy = graded ? correct / graded : null
            summary.checks.tinyFloor = { graded, accuracy, threshold: 0.5, judgeError }
            summary.tinyDropped = accuracy !== null && graded >= 30 && accuracy < 0.5
            if (summary.tinyDropped) log(`[probe] tiny model oracle accuracy ${(accuracy * 100).toFixed(0)}% < 50%: dropped from the run (pre-registered rule)`)
        }
        if (alias === "large") {
            const oracleRuns = await generate("large", oracle.items.slice(0, limits.large))
            const bRuns = await generate("large", baseline.items.slice(0, limits.large))
            const outputTokens = oracleRuns.map(({ result }) => result.evalCount).filter(Number.isFinite)
            const meanTokens = mean(outputTokens)
            summary.checks.largeOutputLength = { meanOracleEvalCount: meanTokens, v1Mean: V1_MEAN_OUTPUT_TOKENS, ratio: meanTokens ? meanTokens / V1_MEAN_OUTPUT_TOKENS : null }
            summary.numPredict = meanTokens && meanTokens > 1.3 * V1_MEAN_OUTPUT_TOKENS ? 160 : options.num_predict
            entry.rates = {
                oracleWallMsMean: mean(oracleRuns.map(({ result }) => result.wallMs).filter(Number.isFinite)),
                bWallMsMean: mean(bRuns.map(({ result }) => result.wallMs).filter(Number.isFinite)),
                decodeTokPerSec: mean(oracleRuns.filter(({ result }) => result.evalMs > 0 && result.evalCount > 1).map(({ result }) => (result.evalCount - 1) / (result.evalMs / 1000))),
            }
            // Template offset check against the e2b sanity answers on the same prompts.
            const small = summary.models.small?.sanity ?? []
            summary.checks.templateOffset = oracleRuns.slice(0, 3).map(({ result }, index) => (small[index]?.promptEvalCount != null && result.promptEvalCount != null ? result.promptEvalCount - small[index].promptEvalCount : null))
        }
        summary.models[alias] = entry
        log(`[probe] ${alias}: load ${(loaded.coldLoadMs / 1000).toFixed(1)} s, GPU share ${entry.gpuShare ?? "?"}, sanity ${entry.sanity.map((s) => s.status).join("/")}`)
    }
    for (const model of await ps(ollamaUrl)) await unload(ollamaUrl, model.name)

    // Cloud judge throughput (30 calls per level, to spare the usage quota).
    const judgeItems = oracle.items.slice(0, limits.judge).map((item) => recordByKey.get(item.questionKey))
    summary.checks.judgeThroughput = {}
    for (const concurrency of [1, 3]) {
        const started = performance.now()
        let errors = 0
        let pausedWith = null
        await mapLimit(judgeItems, concurrency, async (record) => {
            try {
                await referenceVerdict(judgeConfig("j1"), { question: record.question, references: [record.gold], candidate: record.gold }, { ollamaUrl })
            } catch (error) {
                errors++
                if (error instanceof JudgePaused) pausedWith = error.message
            }
        })
        const seconds = (performance.now() - started) / 1000
        summary.checks.judgeThroughput[concurrency] = { callsPerSecond: Number((judgeItems.length / seconds).toFixed(3)), errors, pausedWith }
    }
    const rates = summary.checks.judgeThroughput
    summary.judgeConcurrency = rates[3] && !rates[3].errors && rates[3].callsPerSecond > (rates[1]?.callsPerSecond ?? 0) * 1.3 ? 3 : 1

    // Adjudicator availability (third family), with a fallback.
    summary.checks.adjudicator = null
    for (const model of JUDGES.adjudicator.chain) {
        try {
            await callJudge({ provider: "ollama", model, think: false }, 'Reply with JSON only: {"verdict": "CORRECT", "quotes": [], "missing": "", "referenceError": false, "reason": "ping"}', undefined, { ollamaUrl, timeoutMs: 60_000 })
            summary.checks.adjudicator = { model, available: true }
            break
        } catch (error) {
            summary.checks.adjudicator = { model, available: false, error: error.message.slice(0, 200) }
        }
    }
    summary.checks.j2 = await callJudge(judgeConfig("j2"), 'Reply with JSON only: {"verdict": "CORRECT", "partsAsked": 1, "partsCorrect": 1, "missing": "", "reason": "ping"}', undefined, { ollamaUrl, timeoutMs: 60_000 })
        .then(() => ({ model: JUDGES.j2.model, available: true }))
        .catch((error) => ({ model: JUDGES.j2.model, available: false, error: error.message.slice(0, 200) }))

    log(`[probe] numPredict ${summary.numPredict}, judge concurrency ${summary.judgeConcurrency}, overflow check ${summary.checks.overflow?.pass ? "pass" : "FAIL"}, adjudicator ${summary.checks.adjudicator?.model ?? "none"} ${summary.checks.adjudicator?.available ? "ok" : "unavailable"}, J2 ${summary.checks.j2.available ? "ok" : "unavailable"}`)
    return summary
}
