// Model registry and cell catalog for premise2: the single source of truth for what
// runs, on which models, at what n, in which stage of the Windows queue.

// Parameter counts from the Gemma 3 / Gemma 4 technical reports, not Ollama's
// parameter_size (which counts on different bases per tag). The FLOP proxy uses
// non-embedding parameters: per-layer embedding tables are lookups, not compute.
export const MODELS = {
    tiny: { tag: "gemma3:1b-it-qat", family: "gemma3", nonEmbeddingB: 0.698, effectiveB: 1.0, storedB: 1.0, role: "distraction amplifier (Gemma 3; cross-generation confound)" },
    small: { tag: "gemma4:e2b-it-qat", family: "gemma4", nonEmbeddingB: 1.87, effectiveB: 2.27, storedB: 5.1, role: "primary small" },
    mid: { tag: "gemma4:e4b-it-qat", family: "gemma4", nonEmbeddingB: 3.94, effectiveB: 4.61, storedB: 8.0, role: "scale midpoint" },
    large: { tag: "gemma4:31b-it-qat", family: "gemma4", nonEmbeddingB: 29.29, effectiveB: 30.7, storedB: 30.7, role: "large baseline (dense)" },
    bridge: { tag: "gemma4:e2b", family: "gemma4", nonEmbeddingB: 1.87, effectiveB: 2.27, storedB: 5.1, role: "V1 tag (Q4_K_M) for the V1 replay only" },
}

// Smoke runs (Mac, no Gemma 4 installed): every alias maps to one small local model
// and every cell is cut to its first POC2_MAX_ITEMS items. Never used for results.
export const SMOKE = process.env.POC2_SMOKE_MODEL ? { model: process.env.POC2_SMOKE_MODEL, maxItems: Number(process.env.POC2_MAX_ITEMS ?? 3) } : null
if (SMOKE) for (const entry of Object.values(MODELS)) entry.tag = SMOKE.model
export const capItems = (items) => (SMOKE ? items.slice(0, SMOKE.maxItems) : items)

export const JUDGES = {
    j1: { provider: "ollama", model: "gpt-oss:20b-cloud", family: "openai" },
    j2: { provider: "ollama", model: "nemotron-3-nano:30b-cloud", family: "nvidia" },
    // Tried in order; the first that answers is used for the whole grading pass.
    // The first two are third-family but not on Ollama's free tier; nemotron-3-super
    // is free but shares J2's family (the report flags it). gpt-oss is deliberately
    // not a fallback: V1 showed its false negatives on verbose large-model answers,
    // which is the error adjudication exists to catch.
    adjudicator: { provider: "ollama", model: "deepseek-v4-flash:cloud", chain: ["deepseek-v4-flash:cloud", "mistral-large-3:675b-cloud", "nemotron-3-super:cloud"], family: "deepseek" },
}

export const RUNTIME = {
    numCtx: 16384,
    numBatch: 512,
    numPredict: 320,
    temperature: 0,
    topP: 1,
    seed: 42,
}

const retr = (method, k, { order = "rank", representation = "R0", scope = "global", field = "questions", template = "T2", variant = "standard" } = {}) =>
    ({ arm: "retr", retrieval: { method, k, order, scope, field }, representation, template, variant })

// DEV grid and E* candidates, instantiated for the chosen retrieval pipeline R*.
export function engineeredConfigs(rStar) {
    const configs = [{ id: `k1-rank-R0`, ...retr(rStar, 1) }]
    for (const k of [3, 5, "gate"]) {
        for (const order of ["rank", "bestlast"]) {
            for (const representation of ["R0", "R2"]) configs.push({ id: `k${k}-${order}-${representation}`, ...retr(rStar, k, { order, representation }) })
        }
    }
    return configs
}

export const BASELINE = { id: "B", ...retr("bm25", 5) }

// How many components of `config` differ from the baseline B (tie-break for E*).
export function distanceFromBaseline(config) {
    let differences = 0
    if (config.retrieval.method !== BASELINE.retrieval.method) differences++
    if (config.retrieval.k !== BASELINE.retrieval.k) differences++
    if (config.retrieval.order !== BASELINE.retrieval.order) differences++
    if (config.representation !== BASELINE.representation) differences++
    return differences
}

// TEST cells. `models` maps a model alias to its n (a prefix length of the TEST
// order; null = the whole prefix). `stage` orders the Windows queue.
export function testCells() {
    const all = (n = null) => ({ tiny: n, small: n, mid: n })
    return [
        { id: "P-oracle", role: "primary", stage: 2, arm: "oracle", representation: "R0", template: "T2", models: { ...all(), large: 600 } }, // 31b: 400 interleaved, 400-600 by the time rule
        { ...BASELINE, id: "P-B", role: "primary", stage: 2, models: { ...all(), large: 600 } },
        { id: "P-Estar", role: "primary", stage: 3, estar: true, models: { ...all(), large: 600 } },

        { id: "S-floor", role: "secondary", stage: 2, arm: "floor", representation: "R0", template: "T2", models: { tiny: 100, small: 100, mid: 100, large: 100 } },
        { id: "S-dist4hard", role: "secondary", stage: 2, arm: "dist", distractor: { type: "hard", count: 4 }, representation: "R0", template: "T2", models: { tiny: 600, small: 600, mid: 600, large: 300 }, largeRule: "time" },
        { id: "S-dist9hard", role: "secondary", stage: 2, arm: "dist", distractor: { type: "hard", count: 9 }, representation: "R0", template: "T2", models: { small: 300 } },
        { id: "S-dist4rand", role: "secondary", stage: 2, arm: "dist", distractor: { type: "rand", count: 4 }, representation: "R0", template: "T2", models: { small: 300, large: 300 }, largeRule: "time" },
        { id: "S-format-T1", role: "secondary", stage: 2, arm: "oracle", representation: "R0", template: "T1", models: { small: 300 } },
        { id: "S-null-oracle", role: "secondary", stage: 2, arm: "oracle", representation: "R0", template: "T2", variant: "null", models: { small: 300 } },
        { id: "S-null-B", role: "secondary", stage: 2, ...retr("bm25", 5, { variant: "null" }), models: { small: 300 } },
        { id: "S-oracle-R2", role: "diagnostic", stage: 2, arm: "oracle", representation: "R2", template: "T2", models: { small: 300, large: 300 }, largeRule: "time" },
        { id: "S-R2-B", role: "secondary", stage: 2, ...retr("bm25", 5, { representation: "R2" }), models: { mid: 600 } },

        // G-R2-bm25 is the e2b arm of secondary S2 (R2 vs R0 at BM25 k5), so it runs in
        // stage 2 rather than with the rest of the grid, which a stop time may cut.
        ...["R0", "R1", "R2"].flatMap((representation) => ["bm25", "dense", "rrf60"].map((method) => (
            { id: `G-${representation}-${method}`, role: "grid", stage: representation === "R2" && method === "bm25" ? 2 : 6, ...retr(method, 5, { representation }), models: { small: 600 } }
        ))),

        { id: "X-bm25-k1", role: "exploratory", stage: 6, ...retr("bm25", 1), models: { small: 300 } },
        { id: "X-bm25-k3", role: "exploratory", stage: 6, ...retr("bm25", 3), models: { small: 300 } },
        { id: "X-bm25-k10", role: "exploratory", stage: 6, ...retr("bm25", 10), models: { small: 300 } },
        { id: "X-bm25rr-k5", role: "exploratory", stage: 6, ...retr("bm25+rr", 5), models: { small: 300 } },
        { id: "X-bm25rr-gate", role: "exploratory", stage: 6, ...retr("bm25+rr", "gate"), models: { small: 300 } },
        { id: "X-bm25-k5-bestlast", role: "exploratory", stage: 6, ...retr("bm25", 5, { order: "bestlast" }), models: { small: 300 } },
        { id: "X-hybv1-k5", role: "exploratory", stage: 6, ...retr("hybv1", 5), models: { small: 300 } },
        { id: "X-peruser-bm25-k5", role: "exploratory", stage: 6, ...retr("bm25", 5, { scope: "user" }), models: { small: 300 } },
        { id: "X-rephrased-bm25-k5", role: "exploratory", stage: 6, ...retr("bm25", 5, { field: "rephrased" }), models: { small: 300 } },
        { id: "X-oracle-RL", role: "exploratory", stage: 6, arm: "oracle", representation: "RL", template: "T2", models: { small: 300 } },
        { id: "X-goldsel-B", role: "exploratory", stage: 3, ...retr("bm25", 5), goldSelect: true, models: { small: 300 } },
    ]
}

// V1 replay on V1's own 100 questions: tag (Q4_K_M vs QAT) x template (T1 vs T2).
export function bridgeCells() {
    return [
        { id: "V1-bridge-T1", role: "bridge", stage: 2, arm: "oracle", representation: "R0", template: "T1", models: { bridge: null, small: null } },
        { id: "V1-bridge-T2", role: "bridge", stage: 2, arm: "oracle", representation: "R0", template: "T2", models: { bridge: null, small: null } },
    ]
}

// Order of the 31b's optional secondaries, each admitted only if its projected
// finish is before the stop time (pre-registered).
export const LARGE_TIME_RULE_ORDER = [
    { cell: "S-dist4hard", n: 300 },
    { cell: "S-oracle-R2", n: 300 },
    { cell: "P-oracle", n: 600 },
    { cell: "S-dist4rand", n: 300 },
]

export const LARGE_INTERLEAVE = { block: 50, targets: { "P-oracle": 400, "P-B": 600, "P-Estar": 600 } }

// Agent arm (PREREG-AGENT.md): run order, the confirmatory arms (e2b, 31b) first.
// A-rawfirst: the harness runs round 1 as SEARCH on the raw question (isolates who
// writes the query). A-null: answer-neutral rewording (the agent's flip floor). The
// thinking arms need a larger per-turn output limit: thinking tokens count toward it.
export const AGENT_ARMS = [
    { cell: "A-agent", alias: "small" },
    { cell: "A-agent", alias: "large" },
    { cell: "A-agent", alias: "mid" },
    { cell: "A-agent", alias: "tiny" },
    { cell: "A-rawfirst", alias: "small", rawFirst: true },
    { cell: "A-null", alias: "small", variant: "null" },
    { cell: "A-think", alias: "small", think: true },
    { cell: "A-think", alias: "mid", think: true },
]
export const AGENT_THINK_NUM_PREDICT = 4096
export const AGENT_BLOCK = 50
