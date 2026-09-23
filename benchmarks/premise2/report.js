// Offline analysis for premise2 (see PREREG.md): the confirmatory hypotheses, the
// secondary family, exploratory estimates, retrieval-only metrics, judge agreement,
// timing, cost and energy. Writes benchmarks/results/premise2/{report.json,
// report.md, cases.csv}. No prompt or answer text leaves .data/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AnswerStore, PERMANENT_FAILURES, generationKey, optionsHash, readJsonl } from "./store.js"
import { judgeConfig, preGrade, spanScore } from "./judge.js"
import { unitVerdictKey, verdictIndex, withEstarCell, TIER_A_ROLES, DEV_TIER_A_TOP } from "./grade.js"
import { MODELS, LARGE_TIME_RULE_ORDER } from "./cells.js"
import { clusterBootstrap, bootstrapP, classify, clusterRobustZ, holm, wilson, geometricMeanRatio } from "./stats.js"
import { integrateBlocks, summariseEnergy, readJsonl as readEnergyJsonl } from "./energy-integrate.js"
import { contentWords, criticalSpans } from "./text.js"

export const MARGIN = 0.05
const B_CONFIRM = 10_000
const B_DESCRIPTIVE = 2_000
const SEED = 20260922

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN)
const round = (value, digits = 4) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)))
const pct = (value, digits = 1) => (value == null || !Number.isFinite(value) ? "–" : `${(value * 100).toFixed(digits)}`)
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null)

export async function report({ dataDir, log = console.log, outDir = "benchmarks/results/premise2", loadCorpus = null }) {
    const read = (name) => JSON.parse(readFileSync(join(dataDir, name), "utf8"))
    const state = read("run-state.json")
    const manifest = read("manifest-prepare.json")
    const cells = withEstarCell(read("cells.json").cells)
    const pools = read("pools.json")
    const recordByKey = new Map([...pools.dev, ...pools.test, ...pools.bridge].map((record) => [record.questionKey, record]))
    const store = new AnswerStore(join(dataDir, "answers.jsonl"))
    const verdicts = readJsonl(join(dataDir, "verdicts.jsonl")).records
    const digests = state.provenance.digests
    const optsHash = optionsHash(state.provenance.options)
    const smoke = Object.values(digests).some((digest) => String(digest).includes("#"))
    const warnings = []
    if (smoke) warnings.push("SMOKE RUN: every model alias is the same small model; numbers are meaningless.")

    // ---- judges and the adjudicator actually used ----
    const j1 = judgeConfig("j1")
    const j2 = judgeConfig("j2")
    const adjCounts = new Map()
    for (const record of verdicts) if (record.type === "verdict" && record.judge === "adj" && record.verdict) adjCounts.set(record.judgeModel, (adjCounts.get(record.judgeModel) ?? 0) + 1)
    const adjModel = [...adjCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? judgeConfig("adj").model
    if (adjCounts.size > 1) warnings.push(`adjudication verdicts from ${adjCounts.size} models (${[...adjCounts.keys()].join(", ")}); only ${adjModel} is used`)
    const adj = { ...judgeConfig("adj"), model: adjModel }
    if (!adjCounts.size) warnings.push("no adjudication verdicts: tier-A scores are the J1/J2 consensus, and disagreements are pending")
    else if (/nemotron/i.test(adjModel)) warnings.push(`adjudicator ${adjModel} shares J2's model family (the third-family adjudicators need paid Ollama credits)`)
    const j1Index = verdictIndex(verdicts, "j1", j1.model)
    const j2Index = verdictIndex(verdicts, "j2", j2.model)
    const adjIndex = verdictIndex(verdicts, "adj", adj.model)

    // ---- units: every generated (or finally failed) answer, per cell and model ----
    const cellById = new Map(cells.map((cell) => [cell.id, cell]))
    const devTop = new Set(Object.entries(state.estar?.table ?? {}).filter(([id, row]) => id !== "D-B" && row.accuracy !== null).sort((a, b) => b[1].accuracy - a[1].accuracy).slice(0, DEV_TIER_A_TOP).map(([id]) => id))
    devTop.add("D-B")
    const unitsByArm = new Map()
    const allUnits = []
    const materialised = []
    for (const cell of cells) {
        if (cell.role === "probe" || cell.role === "estar-candidate") continue
        let source = cell
        if (cell.estar) {
            if (!state.estar) continue
            const candidate = cellById.get(`E-${state.estar.estar}`)
            if (!candidate) continue
            source = { ...candidate, id: cell.id, role: cell.role, models: cell.models, stage: cell.stage }
        }
        materialised.push(source)
        const tier = cell.role === "dev" ? (devTop.has(cell.id) ? "A" : "B") : TIER_A_ROLES.has(cell.role) ? "A" : "B"
        for (const [alias, n] of Object.entries(source.models ?? {})) {
            if (!digests[alias]) continue
            const items = n == null ? source.items : source.items.slice(0, n)
            const arm = new Map()
            for (const [position, item] of items.entries()) {
                const answerKey = generationKey(digests[alias], optsHash, item.promptSha)
                let answer = store.get(answerKey)
                if (!answer) {
                    const failure = store.finalFailure(answerKey)
                    if (!failure) continue
                    answer = { ...failure, answer: null }
                }
                const record = recordByKey.get(item.questionKey)
                const unit = { cellId: cell.id, cell: source, role: cell.role, tier, alias, item, record, answer, answerKey, position }
                unit.scores = scoreUnit(unit)
                arm.set(item.questionKey, unit)
                allUnits.push(unit)
            }
            if (arm.size) unitsByArm.set(`${cell.id}|${alias}`, arm)
        }
    }
    log(`[report] ${allUnits.length} answers over ${unitsByArm.size} cell x model arms`)

    function scoreUnit(unit) {
        // Context overflow: the shared prompt does not fit the 16k window for any
        // model, so the question is excluded from every contrast using this cell.
        if (PERMANENT_FAILURES.has(unit.answer.status)) return { final: null, j1: null, j2: null, strict: null, adj: null, span: null, pre: null, excluded: unit.answer.status }
        const pre = preGrade(unit.answer)
        const hasSpans = criticalSpans(unit.record.gold).length > 0
        if (pre) return { final: 0, j1: 0, j2: 0, strict: 0, adj: null, span: hasSpans ? 0 : null, pre: pre.source }
        const v1 = j1Index.get(unitVerdictKey(unit, j1))?.verdict ?? null
        const v2 = j2Index.get(unitVerdictKey(unit, j2))?.verdict ?? null
        const va = adjIndex.get(unitVerdictKey(unit, adj))?.verdict ?? null
        const bit = (verdict) => (verdict == null ? null : verdict === "CORRECT" ? 1 : 0)
        const consensus = v1 && v2 ? (v1 === v2 ? bit(v1) : null) : null
        const final = unit.tier === "A" ? (va != null ? bit(va) : consensus) : bit(v1)
        return {
            final,
            j1: bit(v1),
            j2: bit(v2),
            strict: v1 && v2 ? (v1 === "CORRECT" && v2 === "CORRECT" ? 1 : 0) : null,
            adj: bit(va),
            span: spanScore(unit.answer.answer, unit.record.gold),
            pre: null,
        }
    }

    const arm = (cellId, alias) => unitsByArm.get(`${cellId}|${alias}`) ?? new Map()

    // Rows where every arm has a score of `kind` for the same question.
    function rowsFor(arms, { kind = "final", filter = null } = {}) {
        const maps = arms.map(([cellId, alias]) => arm(cellId, alias))
        const rows = []
        let pending = 0
        let excluded = 0
        if (!maps.every((map) => map.size)) return { rows, pending, excluded, missingArm: true }
        for (const [questionKey, first] of maps[0]) {
            const units = maps.map((map) => map.get(questionKey))
            if (units.some((unit) => !unit)) continue
            if (filter && !filter(first.record, units)) continue
            if (units.some((unit) => unit.scores.excluded)) {
                excluded++
                continue
            }
            const values = units.map((unit) => unit.scores[kind])
            if (values.some((value) => value == null)) {
                if (kind === "final") pending++
                continue
            }
            rows.push({ user: first.record.user, record: first.record, values, units })
        }
        return { rows, pending, excluded, missingArm: false }
    }

    const boot = (rows, statistic, B) => clusterBootstrap({ items: rows, clusterOf: (row) => row.user, statistic, B, seed: SEED })

    // Paired difference arms[0] - arms[1] (or a custom per-row combination).
    function contrast(name, arms, { kind = "final", filter = null, type = "superiority", margin = 0, B = B_CONFIRM, combine = (v) => v[0] - v[1] } = {}) {
        const { rows, pending, excluded, missingArm } = rowsFor(arms, { kind, filter })
        const base = { name, arms: arms.map(([cellId, alias]) => `${alias}:${cellId}`), kind, type, margin, n: rows.length, pending, excludedOverflow: excluded }
        if (missingArm || rows.length < 2) return { ...base, label: "NOT RUN", estimate: null }
        const diffs = rows.map((row) => combine(row.values))
        const result = boot(rows, (sample) => mean(sample.map((row) => combine(row.values))), B)
        const p = bootstrapP(result, { kind: type === "noninferiority" ? "noninferiority" : "superiority", margin })
        const z = clusterRobustZ(diffs, rows.map((row) => row.user))
        const armMeans = arms.map((_, index) => round(mean(rows.map((row) => row.values[index]))))
        // Minimum detectable effect at 80% power, from the bootstrap CI width.
        const se = (result.high - result.low) / (2 * 1.959964)
        return {
            ...base,
            mde80: round(2.8016 * se),
            clusters: result.clusters,
            armMeans,
            estimate: round(result.estimate),
            low: round(result.low),
            high: round(result.high),
            p: type === "equivalence" ? null : round(p, 5),
            label: classify({ estimate: result.estimate, low: result.low, high: result.high, margin, kind: type }),
            robustZ: z ? { z: round(z.z, 3), p: round(z.p, 5) } : null,
            discordant: arms.length === 2 ? { onlyFirst: rows.filter((row) => row.values[0] > row.values[1]).length, onlySecond: rows.filter((row) => row.values[0] < row.values[1]).length } : undefined,
        }
    }

    function ratio(name, arms, statistic, { filter = null, kind = "final" } = {}) {
        const { rows, pending, missingArm } = rowsFor(arms, { kind, filter })
        if (missingArm || rows.length < 2) return { name, label: "NOT RUN", n: rows.length }
        const stat = (sample) => statistic(arms.map((_, index) => mean(sample.map((row) => row.values[index]))))
        const result = boot(rows, stat, B_CONFIRM)
        return { name, arms: arms.map(([cellId, alias]) => `${alias}:${cellId}`), n: rows.length, pending, estimate: round(result.estimate), low: round(result.low), high: round(result.high), skippedDraws: result.skipped, armMeans: arms.map((_, index) => round(mean(rows.map((row) => row.values[index])))) }
    }

    // ---- confirmatory ----
    const H = {}
    const kinds = ["final", "strict", "span"]
    for (const kind of kinds) {
        H[kind] = {
            H1: contrast("H1 oracle: 31b - e2b", [["P-oracle", "large"], ["P-oracle", "small"]], { kind }),
            H2: contrast("H2 e2b(E*) - 31b(B), NI margin 5 pts", [["P-Estar", "small"], ["P-B", "large"]], { kind, type: "noninferiority", margin: MARGIN }),
            H3: contrast("H3 DiD [e2b(E*) - e2b(B)] - [31b(E*) - 31b(B)]", [["P-Estar", "small"], ["P-B", "small"], ["P-Estar", "large"], ["P-B", "large"]], { kind, combine: (v) => (v[0] - v[1]) - (v[2] - v[3]) }),
        }
        const gate = H[kind].H1
        const gatePassed = gate.p != null && gate.p < 0.05
        // Holm over the family members that ran (a NOT RUN H3 does not block H2).
        const family = [H[kind].H2, H[kind].H3].filter((test) => test.p != null)
        const adjusted = gatePassed ? holm(family.map((test) => test.p)) : family.map(() => null)
        H[kind].gatePassed = gatePassed
        for (const test of [H[kind].H2, H[kind].H3]) {
            const index = family.indexOf(test)
            test.holmP = index >= 0 && adjusted[index] != null ? round(adjusted[index], 5) : null
            test.confirmed = gatePassed && test.holmP != null && test.holmP <= 0.05
            test.confirmatory = gatePassed && test.label !== "NOT RUN"
        }
    }
    const primary = H.final
    for (const key of ["H1", "H2", "H3"]) {
        primary[key].robust = primary[key].label !== "NOT RUN" && kinds.every((kind) => H[kind][key].label === primary[key].label)
    }
    // PREREG section 8: a short 31b prefix is reported, with the MDE for the achieved n.
    for (const cellId of ["P-B", "P-Estar"]) {
        const n = arm(cellId, "large").size
        if (n < 400) warnings.push(`31b ${cellId} has only ${n} answers (< 400 planned minimum); see each contrast's mde80 for the achieved n`)
    }
    // Sensitivity labels for H2 at a 2.5-point margin, TOST +/-5, and the conservative comparator.
    const h2Extra = {
        margin25: contrast("H2 at margin 2.5 pts", [["P-Estar", "small"], ["P-B", "large"]], { type: "noninferiority", margin: 0.025 }),
        tost5: contrast("H2 TOST +/-5 pts", [["P-Estar", "small"], ["P-B", "large"]], { type: "equivalence", margin: MARGIN }),
    }
    {
        const largeB = mean([...arm("P-B", "large").values()].map((unit) => unit.scores.final).filter((value) => value != null))
        const largeE = mean([...arm("P-Estar", "large").values()].map((unit) => unit.scores.final).filter((value) => value != null))
        const best = Number.isFinite(largeE) && largeE > largeB ? "P-Estar" : "P-B"
        h2Extra.conservative = { ...contrast(`H2 vs 31b at max(B, E*) = ${best}`, [["P-Estar", "small"], [best, "large"]], { type: "noninferiority", margin: MARGIN }), comparator: best }
    }
    // Post-hoc scale-vs-retrieval contrasts. Exploratory: they are not in PREREG's
    // confirmatory or secondary families, and carry no Holm adjustment.
    const headline = [
        contrast("e2b(oracle) - 31b(B): perfect retrieval on the small model vs real retrieval on the large one", [["P-oracle", "small"], ["P-B", "large"]]),
        contrast("e2b(B) - 31b(B): the deployed gap", [["P-B", "small"], ["P-B", "large"]]),
        contrast("e4b(B) - 31b(B): the deployed gap at the midpoint", [["P-B", "mid"], ["P-B", "large"]]),
        contrast("e2b(oracle) - e2b(B): what retrieval costs the small model", [["P-oracle", "small"], ["P-B", "small"]]),
        contrast("31b(oracle) - 31b(B): what retrieval costs the large model", [["P-oracle", "large"], ["P-B", "large"]]),
    ]
    const gapClosure = ratio("gap closure [e2b(E*) - e2b(B)] / [31b(B) - e2b(B)]", [["P-Estar", "small"], ["P-B", "small"], ["P-B", "large"]], ([e, b, l]) => (l - b > 0 ? (e - b) / (l - b) : NaN))
    const headroom = {}
    const ladder = {}
    const rStar = manifest.retrieval.rStar
    for (const alias of ["tiny", "small", "mid", "large"]) {
        headroom[alias] = ratio(`${alias} own headroom (E* - B)/(oracle - B)`, [["P-Estar", alias], ["P-B", alias], ["P-oracle", alias]], ([e, b, o]) => (o - b > 0 ? (e - b) / (o - b) : NaN))
        // R* at k5 is the baseline itself when R* is bm25 (byte-identical prompts), so it
        // reuses P-B rather than the tier-B grid cell. Tier-B steps are J1-only; every
        // step also carries its J1 accuracy so they can be compared on one basis.
        const rStarCell = rStar === "bm25" ? "P-B" : ["dense", "rrf60"].includes(rStar) ? `G-R0-${rStar}` : null
        const steps = [["B", "P-B"], [`R* (${rStar} k5)${rStar === "bm25" ? " = B" : ""}`, rStarCell], ["E*", "P-Estar"], ["gold-informed selection", "X-goldsel-B"], ["oracle", "P-oracle"]]
        ladder[alias] = steps.map(([label, cellId]) => {
            const units = cellId ? [...arm(cellId, alias).values()] : []
            const values = units.map((unit) => unit.scores.final).filter((value) => value != null)
            const j1Values = units.map((unit) => unit.scores.j1).filter((value) => value != null)
            const correct = values.filter((value) => value === 1).length
            return {
                step: label, cell: cellId, tier: units[0]?.tier ?? null, n: values.length,
                accuracy: values.length ? round(correct / values.length) : null, ci: wilson(correct, values.length),
                j1Accuracy: j1Values.length ? round(mean(j1Values)) : null,
            }
        })
    }

    // ---- secondary family ----
    const threaded = (record) => record.threaded === true
    const largeDist = LARGE_TIME_RULE_ORDER.find((entry) => entry.cell === "S-dist4hard")
    const s1Admitted = state.timeRule ? state.timeRule["S-dist4hard"]?.decision === "admit" : arm("S-dist4hard", "large").size >= 30
    const secondaries = [
        s1Admitted && arm("S-dist4hard", "large").size >= 2
            ? contrast("S1 distraction interaction [e2b(oracle-dist4)] - [31b(oracle-dist4)]", [["P-oracle", "small"], ["S-dist4hard", "small"], ["P-oracle", "large"], ["S-dist4hard", "large"]], { combine: (v) => (v[0] - v[1]) - (v[2] - v[3]) })
            : { name: "S1 distraction interaction", label: "DROPPED (31b S-dist4hard not admitted by the time rule)", n: 0, p: null, dropped: true, plannedN: largeDist?.n },
        contrast("S2 R2 - R0, e2b, BM25 k5, threaded", [["G-R2-bm25", "small"], ["G-R0-bm25", "small"]], { filter: threaded }),
        contrast("S3 R2 - R0, e4b, BM25 k5, threaded", [["S-R2-B", "mid"], ["P-B", "mid"]], { filter: threaded }),
    ]
    const retrievalRows = existsSync(join(dataDir, "retrieval.jsonl")) ? readJsonl(join(dataDir, "retrieval.jsonl")).records : []
    secondaries.push(retrievalContrast(retrievalRows))
    {
        const tested = secondaries.filter((test) => test.p != null && !test.dropped)
        const adjusted = holm(tested.map((test) => test.p))
        tested.forEach((test, index) => {
            test.holmP = round(adjusted[index], 5)
            test.confirmed = adjusted[index] <= 0.05
        })
    }

    // ---- exploratory: every arm, with its natural reference ----
    const referenceOf = (cell, alias) => {
        if (cell.role === "dev") return cell.id === "D-B" ? null : ["D-B", alias]
        if (cell.id === "P-oracle" || cell.arm === "floor") return null
        if (cell.id === "P-B") return ["P-oracle", alias]
        if (cell.id === "P-Estar") return ["P-B", alias]
        if (cell.role === "bridge") return cell.id === "V1-bridge-T2" ? null : ["V1-bridge-T2", alias]
        if (cell.arm === "retr") return ["P-B", alias]
        return ["P-oracle", alias]
    }
    const noise = {
        oracle: flipRate(arm("S-null-oracle", "small"), arm("P-oracle", "small")),
        retrieval: flipRate(arm("S-null-B", "small"), arm("P-B", "small")),
    }
    const exploratory = []
    for (const cell of materialised) {
        for (const alias of Object.keys(cell.models ?? {})) {
            const units = [...arm(cell.id, alias).values()]
            if (!units.length) continue
            const summary = armSummary(units)
            const reference = referenceOf(cell, alias)
            let versus = null
            if (reference && arm(...reference).size) {
                // Tier-B cells are scored by J1 alone, so they are compared with their
                // reference on the J1 basis; comparing J1-only with an adjudicated
                // reference would mix two scoring rules.
                const referenceTier = arm(...reference).values().next().value?.tier
                const basis = units[0].tier === "B" || referenceTier === "B" ? "j1" : "final"
                versus = { ...contrast(`${alias}:${cell.id} vs ${reference[1]}:${reference[0]}`, [[cell.id, alias], reference], { B: B_DESCRIPTIVE, kind: basis }), basis }
                const noiseRate = cell.arm === "retr" ? noise.retrieval?.rate : noise.oracle?.rate
                if (noiseRate != null && versus.discordant) {
                    const expected = (noiseRate * versus.n) / 2
                    versus.netOfNoise = { rescued: round(versus.discordant.onlyFirst - expected, 1), damaged: round(versus.discordant.onlySecond - expected, 1), expectedFlipsEachWay: round(expected, 1) }
                }
            }
            exploratory.push({ cell: cell.id, role: cell.role, stage: cell.stage, alias, ...summary, versus })
        }
    }
    // Bridge: tag (Q4_K_M vs QAT) at each template.
    const bridge = ["V1-bridge-T1", "V1-bridge-T2"].map((id) => contrast(`${id}: e2b-QAT - e2b-Q4KM`, [[id, "small"], [id, "bridge"]], { B: B_DESCRIPTIVE }))

    // ---- distraction: induced errors, capture vs dilution ----
    let corpus = null
    if (loadCorpus) {
        try {
            corpus = await loadCorpus()
        } catch (error) {
            warnings.push(`corpus not loaded for capture analysis: ${error.message}`)
        }
    }
    const distraction = []
    for (const cell of materialised.filter((c) => c.arm === "dist")) {
        for (const alias of Object.keys(cell.models ?? {})) {
            const { rows } = rowsFor([["P-oracle", alias], [cell.id, alias]])
            if (!rows.length) continue
            const oracleRight = rows.filter((row) => row.values[0] === 1)
            const induced = oracleRight.filter((row) => row.values[1] === 0)
            const entry = { cell: cell.id, alias, n: rows.length, oracleCorrect: oracleRight.length, induced: induced.length, inducedRate: oracleRight.length ? round(induced.length / oracleRight.length) : null, inducedCi: wilson(induced.length, oracleRight.length) }
            if (corpus) {
                const causes = { capture: 0, dilution: 0, abstain: 0 }
                for (const row of induced) causes[captureKind(row.units[1], corpus)]++
                entry.inducedBy = causes
            }
            distraction.push(entry)
        }
    }

    // ---- strata (estimates only) ----
    const strata = {}
    const strataOf = {
        threaded: (record) => (record.threaded ? "threaded" : "single"),
        location: (record) => record.location ?? "unknown",
        questionType: (record) => record.type ?? "other",
    }
    for (const [name, of] of Object.entries(strataOf)) {
        strata[name] = {}
        const values = new Set([...arm("P-B", "small").values()].map((unit) => of(unit.record)))
        for (const value of values) {
            const filter = (record) => of(record) === value
            strata[name][value] = {
                accuracy: Object.fromEntries(["P-oracle", "P-B", "P-Estar"].flatMap((cellId) => ["small", "large"].map((alias) => {
                    const units = [...arm(cellId, alias).values()].filter((unit) => filter(unit.record))
                    const scored = units.map((unit) => unit.scores.final).filter((v) => v != null)
                    return [`${alias}:${cellId}`, scored.length ? { n: scored.length, accuracy: round(mean(scored)) } : null]
                }))),
                H2diff: contrast(`H2 diff in ${name}=${value}`, [["P-Estar", "small"], ["P-B", "large"]], { filter, B: B_DESCRIPTIVE }),
                EstarGainSmall: contrast(`e2b E* - B in ${name}=${value}`, [["P-Estar", "small"], ["P-B", "small"]], { filter, B: B_DESCRIPTIVE }),
            }
        }
    }

    // ---- retrieval-only metrics ----
    const retrieval = retrievalMetrics(retrievalRows)

    // ---- judge agreement, adjudication, drift ----
    const judging = judgeAgreement(allUnits, verdicts, { j1Index, j1 })

    // ---- timing and cost ----
    const latency = existsSync(join(dataDir, "latency.json")) ? read("latency.json") : null
    const timing = timingSummary(allUnits)
    const cost = costSummary({ allUnits, arm, latency, estar: state.estar, cellById, rowsFor })

    // ---- energy ----
    let energy = null
    const energyPath = join(dataDir, "energy.jsonl")
    if (existsSync(energyPath)) {
        try {
            const samples = (await readEnergyJsonl(energyPath)).records
            const markers = readJsonl(join(dataDir, "markers.jsonl")).records
            const blocks = integrateBlocks({ samples, markers })
            const answersPerBlock = {}
            for (const answer of store.done.values()) if (answer.blockId) answersPerBlock[answer.blockId] = (answersPerBlock[answer.blockId] ?? 0) + 1
            const summary = summariseEnergy(blocks, answersPerBlock)
            const status = samples.filter((sample) => sample.src === "status")
            energy = {
                label: "CPU package + GPU only: a lower bound (DRAM, board and PSU losses are missing, which understates the CPU-bound 31b most)",
                sources: { gpuSamples: samples.filter((s) => s.src === "gpu").length, cpuSamples: samples.filter((s) => s.src === "cpu").length, statusEvents: status.slice(-10) },
                byModelCell: summary.byModelCell,
                perCorrect: energyPerCorrect(summary.byModelCell, arm),
                judgeActiveBlocks: blocks.filter((block) => block.judgeActive).length,
            }
        } catch (error) {
            warnings.push(`energy integration failed: ${error.message}`)
        }
    } else {
        warnings.push("no energy.jsonl: energy not reported")
    }

    // ---- run health ----
    if (state.probe?.checks?.overflow && !state.probe.checks.overflow.pass) warnings.push(`probe: an oversize prompt returned ${state.probe.checks.overflow.status}, not context_overflow (truncate:false may be ignored)`)
    if (state.probe?.tinyDropped) warnings.push("probe: tiny model dropped (oracle accuracy < 0.5)")
    if (state.lastStop && state.lastStop.reason !== "complete") warnings.push(`run stopped: ${state.lastStop.reason} at stage ${state.lastStop.stage} (${state.lastStop.at})`)
    const pendingFinal = allUnits.filter((unit) => unit.scores.final == null).length
    if (pendingFinal) warnings.push(`${pendingFinal} answers have no final verdict yet (grading incomplete)`)
    const statuses = {}
    for (const unit of allUnits) statuses[unit.answer.status] = (statuses[unit.answer.status] ?? 0) + 1

    const out = {
        generatedAt: new Date().toISOString(),
        smoke,
        warnings,
        prereg: { hash: state.provenance.preregHash, deviations: deviations() },
        run: { estar: state.estar ? { estar: state.estar.estar, tiedWith: state.estar.tiedWith, rule: state.estar.rule, devTable: state.estar.table } : null, rStar, rStarResults: manifest.retrieval.rStarResults, probe: state.probe ?? null, lastStop: state.lastStop ?? null, provenance: { ...state.provenance, details: undefined }, statuses },
        data: { pools: manifest.pools, exclusions: manifest.exclusions, corpus: manifest.corpus },
        judges: { j1: j1.model, j2: j2.model, adjudicator: adj.model },
        confirmatory: { primary, sensitivity: { strict: H.strict, span: H.span }, h2Extra, gapClosure, headroom, ladder },
        headline,
        secondaries,
        noise,
        exploratory,
        bridge,
        distraction,
        strata,
        retrieval,
        judging,
        timing,
        cost,
        latency,
        energy,
    }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "report.json"), JSON.stringify(out, null, 2) + "\n")
    writeFileSync(join(outDir, "cases.csv"), casesCsv(allUnits))
    writeFileSync(join(outDir, "report.md"), markdown(out))
    log(`[report] wrote ${outDir}/report.{json,md} and cases.csv`)
    return out
}

// ---------------------------------------------------------------------------

function flipRate(a, b) {
    let n = 0
    let flips = 0
    for (const [key, unit] of a) {
        const other = b.get(key)
        if (!other || unit.scores.final == null || other.scores.final == null) continue
        n++
        if (unit.scores.final !== other.scores.final) flips++
    }
    return n ? { n, flips, rate: round(flips / n) } : null
}

function armSummary(units) {
    const count = (kind) => {
        const values = units.map((unit) => unit.scores[kind]).filter((value) => value != null)
        const correct = values.filter((value) => value === 1).length
        return { n: values.length, accuracy: values.length ? round(correct / values.length) : null, ci: wilson(correct, values.length) }
    }
    return {
        answers: units.length,
        final: count("final"),
        j1: count("j1"),
        strict: count("strict"),
        span: count("span"),
        abstain: units.filter((unit) => unit.scores.pre === "abstain").length,
        contextOverflow: units.filter((unit) => unit.scores.excluded === "context_overflow").length,
        technical: units.filter((unit) => unit.scores.pre === "technical").length,
        outputLimit: units.filter((unit) => unit.answer.status === "output_limit").length,
    }
}

function retrievalContrast(rows) {
    const pool = rows.filter((row) => row.pool === "test" || row.pool === "retrieval")
    const methods = ["bm25", "dense", "rrf60"]
    const hit = (row, method) => {
        const rank = row.ranks?.[`${method}|global|questions`]?.answer
        return rank != null && rank <= 5 ? 1 : 0
    }
    if (!pool.length) return { name: "S4 answer-bearing R@5, best vs second", label: "NOT RUN", n: 0, p: null }
    const means = methods.map((method) => ({ method, mean: mean(pool.map((row) => hit(row, method))) })).sort((a, b) => b.mean - a.mean)
    const [best, second] = means
    const items = pool.map((row) => ({ user: row.user, d: hit(row, best.method) - hit(row, second.method) }))
    const result = clusterBootstrap({ items, clusterOf: (item) => item.user, statistic: (sample) => mean(sample.map((item) => item.d)), B: B_CONFIRM, seed: SEED })
    const p = bootstrapP(result)
    return {
        name: `S4 answer-bearing R@5: ${best.method} - ${second.method}`,
        n: items.length,
        means: Object.fromEntries(means.map((entry) => [entry.method, round(entry.mean)])),
        estimate: round(result.estimate),
        low: round(result.low),
        high: round(result.high),
        p: round(p, 5),
        label: classify({ estimate: result.estimate, low: result.low, high: result.high, kind: "superiority" }),
    }
}

function retrievalMetrics(rows) {
    const groups = { dev: rows.filter((row) => row.pool === "dev"), testAndRetrieval: rows.filter((row) => row.pool === "test" || row.pool === "retrieval") }
    const out = {}
    for (const [group, list] of Object.entries(groups)) {
        const keys = new Set(list.flatMap((row) => Object.keys(row.ranks ?? {})))
        out[group] = {}
        for (const key of [...keys].sort()) {
            const scored = list.filter((row) => row.ranks?.[key])
            if (!scored.length) continue
            const at = (kind, k) => round(mean(scored.map((row) => (row.ranks[key][kind] != null && row.ranks[key][kind] <= k ? 1 : 0))))
            const entry = { n: scored.length }
            for (const kind of ["strict", "relaxed", "answer"]) entry[kind] = Object.fromEntries([1, 3, 5, 10, 20].map((k) => [`@${k}`, at(kind, k)]))
            entry.mrrStrict = round(mean(scored.map((row) => (row.ranks[key].strict ? 1 / row.ranks[key].strict : 0))))
            const items = scored.map((row) => ({ user: row.user, v: row.ranks[key].answer != null && row.ranks[key].answer <= 5 ? 1 : 0 }))
            const ci = clusterBootstrap({ items, clusterOf: (item) => item.user, statistic: (sample) => mean(sample.map((item) => item.v)), B: B_DESCRIPTIVE, seed: SEED })
            entry.answerAt5Ci = [round(ci.low), round(ci.high)]
            out[group][key] = entry
        }
    }
    return out
}

function agreement(pairs) {
    const a = pairs.filter(([x, y]) => x === 1 && y === 1).length
    const b = pairs.filter(([x, y]) => x === 1 && y === 0).length
    const c = pairs.filter(([x, y]) => x === 0 && y === 1).length
    const d = pairs.filter(([x, y]) => x === 0 && y === 0).length
    const n = a + b + c + d
    if (!n) return { n: 0 }
    const observed = (a + d) / n
    const expected = ((a + b) * (a + c) + (c + d) * (b + d)) / (n * n)
    return {
        n,
        table: { bothCorrect: a, firstOnly: b, secondOnly: c, bothIncorrect: d },
        raw: round(observed),
        kappa: expected < 1 ? round((observed - expected) / (1 - expected)) : null,
        pabak: round(2 * observed - 1),
        positive: a + b + c ? round((2 * a) / (2 * a + b + c)) : null,
        negative: b + c + d ? round((2 * d) / (2 * d + b + c)) : null,
    }
}

function judgeAgreement(units, verdicts, { j1Index, j1 }) {
    const judged = units.filter((unit) => !unit.scores.pre && unit.scores.j1 != null && unit.scores.j2 != null)
    const byTier = {}
    for (const tier of ["A", "B"]) byTier[tier] = agreement(judged.filter((unit) => unit.tier === tier).map((unit) => [unit.scores.j1, unit.scores.j2]))
    const byAlias = {}
    for (const alias of new Set(judged.map((unit) => unit.alias))) byAlias[alias] = agreement(judged.filter((unit) => unit.alias === alias).map((unit) => [unit.scores.j1, unit.scores.j2]))
    const adjudicated = units.filter((unit) => unit.scores.adj != null)
    const trigger = (unit) => (unit.scores.j1 !== unit.scores.j2 ? "disagreement" : unit.scores.j1 === 0 ? "consensusIncorrect" : "auditCorrect")
    const adjudication = {}
    for (const unit of adjudicated) {
        const key = trigger(unit)
        adjudication[key] ??= { n: 0, correct: 0 }
        adjudication[key].n++
        if (unit.scores.adj === 1) adjudication[key].correct++
    }
    for (const entry of Object.values(adjudication)) entry.correctRate = round(entry.correct / entry.n)
    const adjRecords = verdicts.filter((record) => record.type === "verdict" && record.judge === "adj" && record.verdict)
    const anchors = verdicts.filter((record) => record.type === "anchor" && record.verdict)
    const drift = {}
    for (const record of anchors) {
        const main = j1Index.get(record.verdictKey)?.verdict
        if (!main) continue
        drift[record.session] ??= { n: 0, agree: 0 }
        drift[record.session].n++
        if (main === record.verdict) drift[record.session].agree++
    }
    for (const entry of Object.values(drift)) entry.agreement = round(entry.agree / entry.n)
    return {
        j1VsJ2: { byTier, byAlias },
        adjudication: {
            byTrigger: adjudication,
            unverifiedCorrectDowngraded: adjRecords.filter((record) => record.unverifiedCorrect).length,
            referenceErrorFlags: adjRecords.filter((record) => record.referenceError).length,
            parseFailures: verdicts.filter((record) => record.type === "verdict" && record.parseFailed).length,
        },
        anchorDrift: drift,
        j1Model: j1.model,
    }
}

// Warm timing: ok, no reload inside the call, no wall-clock gap before it. An answer
// reused by a second cell (identical prompt) counts for both.
const warm = (unit) => unit.answer.status === "ok" && !unit.answer.reloadedAndRetried && !unit.answer.timingSuspect && Number.isFinite(unit.answer.wallMs)

function timingSummary(units) {
    const groups = new Map()
    for (const unit of units) {
        if (!warm(unit)) continue
        const key = `${unit.alias}|${unit.cellId}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(unit.answer)
    }
    const out = {}
    for (const [key, answers] of groups) {
        const walls = answers.map((answer) => answer.wallMs).sort((a, b) => a - b)
        const trim = Math.floor(walls.length * 0.1)
        const trimmed = walls.slice(trim, walls.length - trim)
        const decode = answers.filter((answer) => answer.evalMs > 0 && answer.evalCount > 1).map((answer) => (answer.evalCount - 1) / (answer.evalMs / 1000)).sort((a, b) => a - b)
        const prefill = answers.filter((answer) => answer.promptEvalMs > 0 && answer.promptEvalCount > 0).map((answer) => (answer.promptEvalCount - (answer.promptEvalCachedCount ?? 0)) / (answer.promptEvalMs / 1000)).sort((a, b) => a - b)
        out[key] = {
            n: answers.length,
            wallMs: { p50: quantile(walls, 0.5), p95: quantile(walls, 0.95), trimmedMean: round(mean(trimmed), 1), total: walls.reduce((s, v) => s + v, 0) },
            promptTokens: round(mean(answers.map((answer) => answer.promptEvalCount ?? 0)), 1),
            cachedPromptTokens: round(mean(answers.map((answer) => answer.promptEvalCachedCount ?? 0)), 1),
            outputTokens: round(mean(answers.map((answer) => answer.evalCount ?? 0)), 1),
            decodeTokPerSec: round(quantile(decode, 0.5), 1),
            prefillTokPerSec: round(quantile(prefill, 0.5), 1),
        }
    }
    return out
}

function retrievalCostMs(method, latency) {
    if (!latency) return null
    const c = latency.components
    const get = (name) => c[name]?.meanMs ?? null
    const base = method.replace(/\+rr$/, "")
    const parts = { bm25: [get("bm25")], dense: [get("queryEmbed"), get("denseSearch")], rrf60: [get("bm25"), get("queryEmbed"), get("denseSearch"), get("rrf")], hybv1: [get("bm25"), get("queryEmbed"), get("denseSearch")] }[base] ?? []
    if (method.endsWith("+rr")) parts.push(get("rerank"))
    if (parts.some((part) => part == null)) return null
    return round(parts.reduce((s, v) => s + v, 0), 1)
}

function costSummary({ allUnits, arm, latency, estar, cellById, rowsFor }) {
    const out = { perArm: {}, ratios: {} }
    const estarCell = estar ? cellById.get(`E-${estar.estar}`) : null
    const methodOf = (cellId) => {
        const cell = cellId === "P-Estar" ? estarCell : cellById.get(cellId)
        if (!cell || cell.arm !== "retr") return null
        return cell.retrieval.k === "gate" && !cell.retrieval.method.endsWith("+rr") ? `${cell.retrieval.method}+rr` : cell.retrieval.method
    }
    for (const cellId of ["P-oracle", "P-B", "P-Estar", "S-dist4hard"]) {
        for (const alias of ["tiny", "small", "mid", "large"]) {
            const units = [...arm(cellId, alias).values()]
            if (!units.length) continue
            const scored = units.filter((unit) => unit.scores.final != null)
            const correct = scored.filter((unit) => unit.scores.final === 1).length
            const warmUnits = units.filter(warm)
            const wall = warmUnits.reduce((s, unit) => s + unit.answer.wallMs, 0)
            const tokens = units.reduce((s, unit) => s + (unit.answer.promptEvalCount ?? 0) + (unit.answer.evalCount ?? 0), 0)
            const flops = 2 * MODELS[alias].nonEmbeddingB * 1e9 * tokens
            const method = methodOf(cellId)
            const retrievalMs = method ? retrievalCostMs(method, latency) : 0
            const meanWall = warmUnits.length ? wall / warmUnits.length : null
            out.perArm[`${alias}|${cellId}`] = {
                n: scored.length,
                accuracy: scored.length ? round(correct / scored.length) : null,
                meanGenerationMs: round(meanWall, 1),
                retrievalMethod: method,
                meanRetrievalMs: retrievalMs,
                meanPipelineMs: meanWall != null && retrievalMs != null ? round(meanWall + retrievalMs, 1) : null,
                pipelineMsPerCorrect: meanWall != null && retrievalMs != null && correct ? round(((meanWall + retrievalMs) * scored.length) / correct, 1) : null,
                flopProxyPerCorrect: correct ? Number((flops / units.length * scored.length / correct).toPrecision(4)) : null,
            }
        }
    }
    // Paired time ratios, 31b / e2b, on the same questions (warm answers only).
    for (const cellId of ["P-oracle", "P-B"]) {
        const { rows } = rowsFor([[cellId, "large"], [cellId, "small"]], { kind: "final" })
        const pairs = rows.filter((row) => row.units.every(warm)).map((row) => [row.units[0].answer.wallMs, row.units[1].answer.wallMs])
        if (!pairs.length) continue
        out.ratios[`${cellId} 31b/e2b`] = {
            n: pairs.length,
            ratioOfTotals: round(pairs.reduce((s, [x]) => s + x, 0) / pairs.reduce((s, [, y]) => s + y, 0), 2),
            geometricMeanRatio: round(geometricMeanRatio(pairs), 2),
            label: "hardware-specific (the 31b runs largely on CPU on the 8 GB GPU)",
        }
    }
    {
        const large = out.perArm["large|P-B"]
        const small = out.perArm["small|P-Estar"]
        if (large?.meanPipelineMs && small?.meanPipelineMs) out.ratios["pipeline 31b(B) / e2b(E*)"] = { ratio: round(large.meanPipelineMs / small.meanPipelineMs, 2), perCorrect: large.pipelineMsPerCorrect && small.pipelineMsPerCorrect ? round(large.pipelineMsPerCorrect / small.pipelineMsPerCorrect, 2) : null }
    }
    return out
}

function energyPerCorrect(byModelCell, arm) {
    const out = {}
    for (const [key, entry] of Object.entries(byModelCell)) {
        const units = [...arm(entry.cell, entry.model).values()].filter((unit) => unit.scores.final != null)
        const accuracy = units.length ? mean(units.map((unit) => unit.scores.final)) : null
        const gross = entry.grossJPerAnswer?.mean
        const marginal = entry.marginalJPerAnswer?.mean
        out[key] = { accuracy: round(accuracy), grossJPerCorrect: accuracy ? round(gross / accuracy, 1) : null, marginalJPerCorrect: accuracy && marginal != null ? round(marginal / accuracy, 1) : null }
    }
    return out
}

// Wrong answer after distractors were added: "capture" if its content words come
// from a distractor rather than the gold, "abstain" for NOT IN EMAILS, otherwise
// "dilution" (the model lost or garbled the gold fact).
function captureKind(unit, { emailByPath }) {
    if (unit.scores.pre === "abstain") return "abstain"
    const words = [...new Set(contentWords(unit.answer.answer ?? ""))].filter((word) => !new Set(contentWords(unit.record.question)).has(word))
    if (words.length < 2) return "dilution"
    const share = (text) => {
        const present = new Set(contentWords(text ?? ""))
        return words.filter((word) => present.has(word)).length / words.length
    }
    const gold = share(emailByPath.get(unit.record.path))
    const best = Math.max(0, ...(unit.item.distractors ?? []).map((d) => share(emailByPath.get(d.path))))
    return best >= 0.5 && best > gold ? "capture" : "dilution"
}

function deviations() {
    try {
        const text = readFileSync(new URL("./PREREG.md", import.meta.url), "utf8")
        const section = text.split("## Deviation log")[1] ?? ""
        return section.trim()
    } catch {
        return null
    }
}

function casesCsv(units) {
    const header = ["cell", "alias", "tier", "questionKey", "mailbox", "type", "threaded", "location", "position", "status", "pre", "final", "j1", "j2", "strict", "adj", "span", "wallMs", "promptTokens", "outputTokens", "k", "goldInContext", "goldPosition"]
    const escape = (value) => (value == null ? "" : /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value))
    const lines = [header.join(",")]
    for (const unit of units) {
        const s = unit.scores
        lines.push([
            unit.cellId, unit.alias, unit.tier, unit.item.questionKey, unit.record.user, unit.record.type, unit.record.threaded, unit.record.location, unit.position,
            unit.answer.status, s.pre, s.final, s.j1, s.j2, s.strict, s.adj, s.span, unit.answer.wallMs, unit.answer.promptEvalCount, unit.answer.evalCount,
            unit.item.k, unit.item.goldInContext, unit.item.goldBucket,
        ].map(escape).join(","))
    }
    return lines.join("\n") + "\n"
}

function markdown(out) {
    const lines = []
    const row = (cells) => lines.push(`| ${cells.join(" | ")} |`)
    const ci = (test) => (test.low == null ? "–" : `[${pct(test.low)}, ${pct(test.high)}]`)
    lines.push("# premise2 results", "")
    lines.push(`Generated ${out.generatedAt}. Judges: J1 ${out.judges.j1}, J2 ${out.judges.j2}, adjudicator ${out.judges.adjudicator}. E* = ${out.run.estar?.estar ?? "not selected"}; R* = ${out.run.rStar}.`, "")
    if (out.warnings.length) {
        lines.push("## Warnings", "")
        for (const warning of out.warnings) lines.push(`- ${warning}`)
        lines.push("")
    }
    lines.push("## Confirmatory (adjudicated score; points = percentage points)", "")
    row(["hypothesis", "n", "arm means", "estimate", "95% CI", "p", "Holm p", "label", "robust", "MDE (80%)"])
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---"])
    for (const key of ["H1", "H2", "H3"]) {
        const test = out.confirmatory.primary[key]
        const label = key === "H1" || test.confirmatory || test.label === "NOT RUN" ? test.label : `${test.label} (estimate only: gate failed)`
        row([test.name, test.n, (test.armMeans ?? []).map((v) => pct(v)).join(" / "), pct(test.estimate), ci(test), test.p ?? "–", test.holmP ?? "–", label, test.robust ? "yes" : "no", pct(test.mde80)])
    }
    lines.push("", `Gate (H1) ${out.confirmatory.primary.gatePassed ? "passed" : "did not pass"}; H2 and H3 are ${out.confirmatory.primary.gatePassed ? "Holm-tested" : "estimates only"}.`, "")
    const gc = out.confirmatory.gapClosure
    lines.push(`**Gap closure** (primary estimand): ${gc.estimate == null ? "–" : gc.estimate.toFixed(3)} [${gc.low?.toFixed(3) ?? "–"}, ${gc.high?.toFixed(3) ?? "–"}], n = ${gc.n}.`, "")
    lines.push("H2 sensitivity:", "")
    for (const test of Object.values(out.confirmatory.h2Extra)) lines.push(`- ${test.name}: ${pct(test.estimate)} ${ci(test)} → ${test.label}`)
    lines.push("", "### Engineering ladder (accuracy, %)", "")
    row(["model", ...out.confirmatory.ladder.small.map((step) => step.step)])
    row(["---", ...out.confirmatory.ladder.small.map(() => "---")])
    for (const [alias, steps] of Object.entries(out.confirmatory.ladder)) row([alias, ...steps.map((step) => (step.accuracy == null ? "–" : `${pct(step.accuracy)}${step.tier === "B" ? "†" : ""} (J1 ${pct(step.j1Accuracy)}, n=${step.n})`))])
    lines.push("", "† tier-B cell, scored by J1 alone: compare it with the J1 values of the other steps.")
    lines.push("", "Own-headroom closure (E* − B)/(oracle − B):", "")
    for (const [alias, entry] of Object.entries(out.confirmatory.headroom)) lines.push(`- ${alias}: ${entry.estimate == null ? "–" : entry.estimate.toFixed(3)} [${entry.low?.toFixed(3) ?? "–"}, ${entry.high?.toFixed(3) ?? "–"}] (n=${entry.n ?? 0})`)
    lines.push("", "### Scale vs retrieval (exploratory, no Holm adjustment)", "")
    row(["contrast", "n", "arm means", "estimate", "95% CI", "p", "label"])
    row(["---", "---", "---", "---", "---", "---", "---"])
    for (const test of out.headline) row([test.name, test.n, (test.armMeans ?? []).map((v) => pct(v)).join(" / "), pct(test.estimate), ci(test), test.p ?? "–", test.label])
    lines.push("", "## Secondary family (Holm)", "")
    row(["test", "n", "estimate", "95% CI", "p", "Holm p", "label"])
    row(["---", "---", "---", "---", "---", "---", "---"])
    for (const test of out.secondaries) row([test.name, test.n, pct(test.estimate), ci(test), test.p ?? "–", test.holmP ?? "–", test.label])
    lines.push("", "## Accuracy by cell (final score, %; Δ vs natural reference with cluster CI)", "")
    row(["cell", "model", "n", "acc", "J1", "strict", "span", "abstain", "Δ vs ref", "Δ CI", "Δ basis"])
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---"])
    for (const entry of out.exploratory) row([entry.cell, entry.alias, entry.final.n, pct(entry.final.accuracy), pct(entry.j1.accuracy), pct(entry.strict.accuracy), pct(entry.span.accuracy), entry.abstain, entry.versus ? pct(entry.versus.estimate) : "–", entry.versus ? ci(entry.versus) : "–", entry.versus?.basis ?? "–"])
    lines.push("", "\"acc\" is the final score: adjudicated for tier-A cells, J1 alone for tier-B cells (grid, exploratory, most DEV configs). Deltas involving a tier-B cell are computed on the J1 basis.")
    lines.push("", `Null-perturbation flip rate (noise floor): oracle ${pct(out.noise.oracle?.rate)}% (n=${out.noise.oracle?.n ?? 0}), retrieval ${pct(out.noise.retrieval?.rate)}% (n=${out.noise.retrieval?.n ?? 0}).`, "")
    if (out.distraction.length) {
        lines.push("## Distraction (induced errors = wrong with distractors | right on oracle)", "")
        row(["cell", "model", "n", "oracle correct", "induced", "rate", "capture / dilution / abstain"])
        row(["---", "---", "---", "---", "---", "---", "---"])
        for (const entry of out.distraction) row([entry.cell, entry.alias, entry.n, entry.oracleCorrect, entry.induced, pct(entry.inducedRate), entry.inducedBy ? `${entry.inducedBy.capture} / ${entry.inducedBy.dilution} / ${entry.inducedBy.abstain}` : "–"])
        lines.push("")
    }
    lines.push("## Retrieval (TEST + retrieval-only questions, global scope)", "")
    row(["list", "n", "strict R@5", "relaxed R@5", "answer R@5", "answer R@5 CI", "MRR"])
    row(["---", "---", "---", "---", "---", "---", "---"])
    for (const [key, entry] of Object.entries(out.retrieval.testAndRetrieval ?? {})) row([key, entry.n, pct(entry.strict["@5"]), pct(entry.relaxed["@5"]), pct(entry.answer["@5"]), `[${pct(entry.answerAt5Ci[0])}, ${pct(entry.answerAt5Ci[1])}]`, entry.mrrStrict?.toFixed(3) ?? "–"])
    lines.push("", "## Judging", "")
    for (const [tier, entry] of Object.entries(out.judging.j1VsJ2.byTier)) lines.push(`- J1 vs J2, tier ${tier}: n=${entry.n}, raw ${pct(entry.raw)}%, κ ${entry.kappa ?? "–"}, PABAK ${entry.pabak ?? "–"}`)
    for (const [alias, entry] of Object.entries(out.judging.j1VsJ2.byAlias)) lines.push(`- J1 vs J2, ${alias}: n=${entry.n}, raw ${pct(entry.raw)}%, κ ${entry.kappa ?? "–"}`)
    for (const [trigger, entry] of Object.entries(out.judging.adjudication.byTrigger)) lines.push(`- adjudication (${trigger}): n=${entry.n}, CORRECT ${pct(entry.correctRate)}%`)
    lines.push(`- unverified CORRECT downgraded: ${out.judging.adjudication.unverifiedCorrectDowngraded}; reference-error flags: ${out.judging.adjudication.referenceErrorFlags}`)
    for (const [session, entry] of Object.entries(out.judging.anchorDrift)) lines.push(`- anchor drift, session ${session}: agreement ${pct(entry.agreement)}% (n=${entry.n})`)
    lines.push("", "## Cost (hardware-specific; energy is a lower bound)", "")
    row(["arm", "n", "acc", "gen ms", "retrieval ms", "pipeline ms / correct", "FLOP proxy / correct"])
    row(["---", "---", "---", "---", "---", "---", "---"])
    for (const [key, entry] of Object.entries(out.cost.perArm)) row([key, entry.n, pct(entry.accuracy), entry.meanGenerationMs ?? "–", entry.meanRetrievalMs ?? "–", entry.pipelineMsPerCorrect ?? "–", entry.flopProxyPerCorrect?.toExponential(2) ?? "–"])
    for (const [key, entry] of Object.entries(out.cost.ratios)) lines.push(`- ${key}: ${JSON.stringify(entry)}`)
    if (out.energy) {
        lines.push("", `Energy: ${out.energy.label}.`, "")
        for (const [key, entry] of Object.entries(out.energy.perCorrect)) lines.push(`- ${key}: gross ${entry.grossJPerCorrect ?? "–"} J/correct, marginal ${entry.marginalJPerCorrect ?? "–"} J/correct`)
    }
    lines.push("", "## Deviations from PREREG", "", out.prereg.deviations || "(none)", "")
    return lines.join("\n")
}
