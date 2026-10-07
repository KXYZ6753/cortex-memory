// Worker i: measurement infrastructure. See docs/premise-study/explore2/i.md.
//
// 1. Determinism. Ollama 0.34.2 runs upstream llama-server (llama.cpp b10969, -np 1,
//    -b/-ub 512, cache_prompt always on, host-RAM prompt cache of 8 GiB, SWA context
//    checkpoints because gemma4 has sliding-window layers). Which checkpoint a new
//    prompt resumes from (n_past = 0, 1, or a small position inside a shared instruction
//    prefix) depends on the prompts that came before it, also from other questions, and
//    the resume point moves the 512-token batch boundaries, which changes the numerics.
//    det(run) is an opt-in wrapper that puts a fixed one-token "reset" call in front of
//    model calls. The reset prompt shares only the chat-template prefix with every real
//    prompt; its own state is always reloaded from the server's prompt cache, so the
//    next real prompt sees the same slot (no checkpoint below the template prefix, short
//    slot so no foreign cached prompt qualifies) whatever ran before.
//      mode "all"   : reset before every model call (generate and chatRaw)
//      mode "first" : reset before the first model call of each question only
//    The wrapper records per call the server's cached-token count (= resume point) so two
//    histories can be compared call by call.
// 2. Energy. i-e-* are plain re-runs (identical code, own ids) of pb, gates, t-lk and x1
//    for the energy table; i-idle holds the GPU lock with the model resident and makes no
//    model call for IDLE_MS (idle baseline window; status "idle" is never graded).
// 3. Verification. i-pert-* run a deterministic per-question "perturbation" (other calls
//    on the previous question: nothing, gates, a length-varied YES/NO probe, or a full x1
//    episode) before the question, emulating interleaved or stacked variants.

import { setTimeout as delay } from "node:timers/promises"
import { createHash } from "node:crypto"
import { generationOptions } from "../../ollama.js"
import { VARIANTS as BASE } from "../../explore/variants.js"
import { VARIANTS as X } from "./x-agent.js"
import { VARIANTS as T } from "./t-ladder.js"
import { VARIANTS as G } from "./g-agent.js"
import { relevancePrompt } from "./w-map.js"

// v1 used "§" (10 tokens with the template). Its cached state shares 4 of 10 tokens
// with every user-turn prompt (f_keep 0.4 >= 0.25), so a prompt that follows a system-turn
// prompt (lcp 2) could load and consume it from the RAM cache; the next reset then resumed
// elsewhere (seen once in 150 perturbed questions). v1 also left a checkpoint at 4 tokens,
// so real calls resumed at 4 on the reset lineage. v2 uses a ~25-token reset: no other
// prompt can load it (4/25 < 0.25) and no checkpoint lies at or below the 4-token template,
// so every real call that is not continuing its own conversation is processed from 0.
export const RESET_PROMPT = "§ 0 1 2 3 4 5 6 7 8 9 §"
export const IDLE_MS = 30_000
const RESET_OPTIONS = () => generationOptions({ num_predict: 1 })

export function det(run, { mode = "all" } = {}) {
    if (mode !== "all" && mode !== "first") throw new Error(`det mode ${mode}`)
    return async (ctx, record) => {
        const info = { mode, resets: 0, resetMs: 0, resetCached: [], cached: [], evaluated: [] }
        let calls = 0
        const before = async () => {
            if (mode === "all" || calls === 0) {
                const started = performance.now()
                const reset = await ctx.generate({ prompt: RESET_PROMPT, options: RESET_OPTIONS() })
                info.resetMs += performance.now() - started
                info.resets++
                info.resetCached.push(reset.promptEvalCachedCount ?? null)
            }
            calls++
        }
        const wrapped = {
            ...ctx,
            generate: async (args) => {
                await before()
                const result = await ctx.generate(args)
                info.cached.push(result.promptEvalCachedCount ?? null)
                info.evaluated.push(result.promptEvalCount ?? null)
                return result
            },
            chatRaw: async (body) => {
                await before()
                const data = await ctx.chatRaw(body)
                info.cached.push(data?.prompt_eval_cached_count ?? null)
                info.evaluated.push(data?.prompt_eval_count ?? null)
                return data
            },
        }
        const result = await run(wrapped, record)
        info.resetMs = Math.round(info.resetMs)
        return { ...result, det: info }
    }
}

// Same per-call diagnostics without any reset (for the controls).
function observe(run) {
    return async (ctx, record) => {
        const info = { mode: "none", cached: [], evaluated: [] }
        const wrapped = {
            ...ctx,
            generate: async (args) => {
                const result = await ctx.generate(args)
                info.cached.push(result.promptEvalCachedCount ?? null)
                info.evaluated.push(result.promptEvalCount ?? null)
                return result
            },
            chatRaw: async (body) => {
                const data = await ctx.chatRaw(body)
                info.cached.push(data?.prompt_eval_cached_count ?? null)
                info.evaluated.push(data?.prompt_eval_count ?? null)
                return data
            },
        }
        const result = await run(wrapped, record)
        return { ...result, det: info }
    }
}

// Deterministic per-question perturbation on the previous question of this variant's run.
const previous = new Map()
const hashOf = (text) => createHash("sha256").update(text).digest()
async function perturb(ctx, record, id) {
    const prev = previous.get(id) ?? null
    previous.set(id, record)
    const digest = hashOf(record.questionKey)
    const kind = prev ? ["none", "gates", "probe", "x1"][digest[0] % 4] : "none"
    const started = performance.now()
    let calls = 0
    const counted = { ...ctx, generate: (a) => { calls++; return ctx.generate(a) }, chatRaw: (b) => { calls++; return ctx.chatRaw(b) } }
    if (kind === "gates") await BASE.gates.run(counted, prev)
    else if (kind === "x1") await X.x1.run(counted, prev)
    else if (kind === "probe") {
        // Lengths spread over ~430-700 tokens so that some land just above 513 tokens, which
        // is what creates the small-position checkpoints inside shared instruction prefixes.
        const email = (ctx.emailOf(prev.path) ?? "").slice(0, 1700 + ((digest[1] << 8) | digest[2]) % 1100)
        await counted.generate({ prompt: relevancePrompt(prev.question, email), options: generationOptions({ num_predict: 3 }) })
    }
    return { kind, prevKey: prev?.questionKey ?? null, ms: Math.round(performance.now() - started), calls }
}

// Stronger perturbation (pert2). pert1 (above) replays prompts the run had already issued,
// which turned out not to move plain x1 at all (150/150 identical). pert2 inserts calls
// the natural sequence never has: a system-turn "filler" prompt of hash-chosen length
// (~300-2,800 tokens; lcp 2 with everything, so it re-enters the server from the start)
// before every question including the first, plus g5 agent episodes and gates on
// earlier questions.
const WORDS = "account meeting gas power trade contract deal price schedule report review draft memo update market risk credit desk book option swap".split(" ")
const filler = (digest, n) => Array.from({ length: n }, (_, i) => WORDS[(digest[i % 32] + i * 7) % WORDS.length]).join(" ")
const history2 = new Map()
async function perturb2(ctx, record, id) {
    const seen = history2.get(id) ?? []
    history2.set(id, [record, ...seen].slice(0, 3))
    const [prev, prev2] = seen
    const digest = hashOf(`pert2|${record.questionKey}`)
    const kind = digest[0] % 4
    const started = performance.now()
    let calls = 0
    const counted = { ...ctx, generate: (a) => { calls++; return ctx.generate(a) }, chatRaw: (b) => { calls++; return ctx.chatRaw(b) } }
    const fill = () => counted.chatRaw({ messages: [{ role: "system", content: filler(digest, 250 + ((digest[1] << 8) | digest[2]) % 2400) }, { role: "user", content: "Reply with OK." }], options: generationOptions({ num_predict: 2 }) })
    const steps = []
    if (kind === 0 || !prev) { await fill(); steps.push("filler") }
    else if (kind === 1) { await G.g5.run(counted, prev); steps.push("g5") }
    else if (kind === 2) { await fill(); await BASE.gates.run(counted, prev); steps.push("filler", "gates") }
    else { await G.g5.run(counted, prev2 ?? prev); await fill(); steps.push("g5", "filler") }
    return { kind: steps.join("+"), prevKey: prev?.questionKey ?? null, ms: Math.round(performance.now() - started), calls }
}

function perturbed(id, run, how = perturb) {
    return async (ctx, record) => {
        const pert = await how(ctx, record, id)
        const started = performance.now()
        const result = await run(ctx, record)
        return { ...result, pert, coreMs: Math.round(performance.now() - started) }
    }
}

const x1 = (ctx, record) => X.x1.run(ctx, record)

export const VARIANTS = {
    "i-det-x1": { version: 2, describe: "x1 behind det(): fixed short reset call (one output token) before every model call, so answers do not depend on earlier questions' prompt-cache state", run: det(x1, { mode: "all" }) },
    "i-detq-x1": { version: 2, describe: "x1 behind det(first): one reset call at the start of each question only", run: det(x1, { mode: "first" }) },
    "i-pert-x1": { version: 1, describe: "Control: per-question perturbation (none/gates/probe/x1 on the previous question), then x1 (no reset); per-call cache diagnostics", run: perturbed("i-pert-x1", observe(x1)) },
    "i-pert-det-x1": { version: 2, describe: "Verification: perturbation, then i-det-x1 (reset before every call)", run: perturbed("i-pert-det-x1", det(x1, { mode: "all" })) },
    "i-pert-detq-x1": { version: 2, describe: "Verification: perturbation, then i-detq-x1 (reset at question start)", run: perturbed("i-pert-detq-x1", det(x1, { mode: "first" })) },
    "i-pert2-x1": { version: 1, describe: "Control 2: stronger perturbation (system-turn filler of varying length before every question, g5 episodes and gates on earlier questions), then x1 (no reset)", run: perturbed("i-pert2-x1", observe(x1), perturb2) },
    "i-pert2-det-x1": { version: 2, describe: "Verification 2: stronger perturbation, then i-det-x1 v2", run: perturbed("i-pert2-det-x1", det(x1, { mode: "all" }), perturb2) },
    "i-pert2-detq-x1": { version: 2, describe: "Verification 2: stronger perturbation, then i-detq-x1 v2", run: perturbed("i-pert2-detq-x1", det(x1, { mode: "first" }), perturb2) },
    "i-det-gates": { version: 2, describe: "gates behind det() (reset before every model call)", run: det((ctx, record) => BASE.gates.run(ctx, record), { mode: "all" }) },
    "i-det-pb": { version: 2, describe: "pb behind det() (reset before every model call)", run: det((ctx, record) => BASE.pb.run(ctx, record), { mode: "all" }) },
    "i-det-tlk": { version: 2, describe: "t-lk behind det() (reset before every model call)", run: det((ctx, record) => T["t-lk"].run(ctx, record), { mode: "all" }) },
    "i-e-pb": { version: 1, describe: "Energy re-run of pb (identical code, own id)", run: (ctx, record) => BASE.pb.run(ctx, record) },
    "i-e-gates": { version: 1, describe: "Energy re-run of gates (identical code, own id)", run: (ctx, record) => BASE.gates.run(ctx, record) },
    "i-e-tlk": { version: 1, describe: "Energy re-run of t-lk (identical code, own id)", run: (ctx, record) => T["t-lk"].run(ctx, record) },
    "i-e-x1": { version: 1, describe: "Energy re-run of x1 (identical code, own id; also an x1 run-to-run check)", run: (ctx, record) => X.x1.run(ctx, record) },
    "i-idle": { version: 1, describe: "Idle baseline: holds the GPU lock with e2b resident for 30 s, no model call (status idle, never graded)", run: async () => { await delay(IDLE_MS); return { status: "idle", answer: "" } } },
}
