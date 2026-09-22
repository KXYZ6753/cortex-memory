// Ollama client for premise2 generation, judging and provenance.
//
// Every generation call sends the same fixed options (RUNTIME) and truncate:false, so
// an oversize prompt fails as context_overflow instead of being silently halved by
// llama-server. Outcomes are mapped to a status taxonomy so technical failures are
// never confused with wrong answers.

import { setTimeout as delay } from "node:timers/promises"
import { RUNTIME } from "./cells.js"

export const STATUSES = ["ok", "empty", "output_limit", "context_overflow", "timeout", "http_error", "oom", "malformed"]

export function generationOptions(overrides = {}) {
    return {
        temperature: RUNTIME.temperature,
        top_p: RUNTIME.topP,
        seed: RUNTIME.seed,
        num_ctx: RUNTIME.numCtx,
        num_batch: RUNTIME.numBatch,
        num_predict: RUNTIME.numPredict,
        repeat_penalty: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        ...overrides,
    }
}

function classifyHttp(status, body) {
    if (/exceed|context (?:size|length|window)|too long|prompt is too long|input length/i.test(body)) return "context_overflow"
    if (/out of memory|failed to allocate|cudaMalloc|insufficient memory|OOM/i.test(body)) return "oom"
    return "http_error"
}

const ms = (nanoseconds) => (nanoseconds == null ? null : Math.round(nanoseconds / 1e6))

// One chat request. Retries transient failures (network, 5xx other than overflow or
// OOM, 429) up to `attempts` times; returns a record, never throws.
export async function chat({ url, model, prompt, options, think = false, format, keepAlive = "60m", timeoutMs = 900_000, attempts = 3 }) {
    let last = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const started = performance.now()
        try {
            const response = await fetch(`${url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages: [{ role: "user", content: prompt }],
                    stream: false,
                    think,
                    truncate: false,
                    keep_alive: keepAlive,
                    ...(format ? { format } : {}),
                    options,
                }),
                signal: AbortSignal.timeout(timeoutMs),
            })
            const wallMs = Math.round(performance.now() - started)
            if (!response.ok) {
                const body = (await response.text()).slice(0, 600)
                const status = classifyHttp(response.status, body)
                last = { status, httpStatus: response.status, error: body, wallMs, attempts: attempt }
                const transient = status === "http_error" && (response.status >= 500 || response.status === 429)
                if (!transient || attempt === attempts) return last
                await delay(response.status === 429 ? 5000 * attempt : 1000 * 2 ** (attempt - 1))
                continue
            }
            let data
            try {
                data = await response.json()
            } catch (error) {
                last = { status: "malformed", error: error.message, wallMs, attempts: attempt }
                if (attempt === attempts) return last
                continue
            }
            const answer = typeof data.message?.content === "string" ? data.message.content.trim() : null
            const thinking = data.message?.thinking ?? ""
            let status = "ok"
            if (answer === null) status = "malformed"
            else if (!answer) status = data.done_reason === "length" ? "output_limit" : "empty"
            else if (data.done_reason === "length") status = "output_limit"
            return {
                status,
                answer,
                thinkingChars: thinking.length,
                doneReason: data.done_reason ?? null,
                promptEvalCount: data.prompt_eval_count ?? null,
                promptEvalCachedCount: data.prompt_eval_cached_count ?? null,
                promptEvalMs: ms(data.prompt_eval_duration),
                evalCount: data.eval_count ?? null,
                evalMs: ms(data.eval_duration),
                loadMs: ms(data.load_duration),
                totalMs: ms(data.total_duration),
                wallMs,
                attempts: attempt,
            }
        } catch (error) {
            const wallMs = Math.round(performance.now() - started)
            const status = error.name === "TimeoutError" ? "timeout" : "http_error"
            last = { status, error: String(error.message).slice(0, 300), wallMs, attempts: attempt }
            if (attempt === attempts) return last
            await delay(2000 * attempt)
        }
    }
    return last
}

async function getJson(url, path, timeoutMs = 20_000) {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`)
    return response.json()
}

async function postJson(url, path, body, timeoutMs = 120_000) {
    const response = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    return response.json()
}

export const version = (url) => getJson(url, "/api/version").then((data) => data.version)
export const tags = (url) => getJson(url, "/api/tags").then((data) => data.models ?? [])
export const ps = (url) => getJson(url, "/api/ps").then((data) => data.models ?? [])

export async function show(url, model) {
    const data = await postJson(url, "/api/show", { model })
    return {
        details: data.details ?? null,
        capabilities: data.capabilities ?? null,
        parameters: data.parameters ?? null,
        template: data.template ?? null,
        parameterCount: data.model_info?.["general.parameter_count"] ?? null,
        contextLength: Object.entries(data.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1] ?? null,
        modifiedAt: data.modified_at ?? null,
    }
}

// Rendered chat template for a prompt, without running the model (used once per
// model to document template differences such as the 31b's empty thought block).
export async function renderOnly(url, model, prompt) {
    try {
        const data = await postJson(url, "/api/chat", { model, messages: [{ role: "user", content: prompt }], stream: false, think: false, _debug_render_only: true })
        return data.debugInfo?.rendered_template ?? data._debug_info?.rendered_template ?? data.message?.content ?? JSON.stringify(data).slice(0, 2000)
    } catch (error) {
        return `unavailable: ${error.message}`
    }
}

export async function unload(url, model) {
    try {
        await postJson(url, "/api/generate", { model, keep_alive: 0, stream: false }, 60_000)
    } catch {
        // Unloading is best effort.
    }
}

// Loads a model with the study's fixed num_ctx/num_batch so the first scored call
// never pays a reload, and returns the measured cold load.
export async function load(url, model, keepAlive = "60m") {
    const started = performance.now()
    const result = await chat({ url, model, prompt: "Reply with OK.", options: generationOptions({ num_predict: 4 }), keepAlive, attempts: 2, timeoutMs: 900_000 })
    return { coldLoadMs: Math.round(performance.now() - started), loadMs: result.loadMs ?? null, status: result.status, error: result.error ?? null }
}

export function compareVersions(a, b) {
    const pa = String(a).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
    const pb = String(b).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
    for (let index = 0; index < Math.max(pa.length, pb.length); index++) {
        const diff = (pa[index] ?? 0) - (pb[index] ?? 0)
        if (diff) return Math.sign(diff)
    }
    return 0
}
