// Tier-A grading of TEST answers outside explore/ (worker p3).
//
// A parameterised copy of explore/confirm.js gradeConfirm, which is hard-wired to gates' units
// and to confirm/verdicts.jsonl and cannot be called for other units. The procedure is the same
// line for line:
//   - the judge models must be the study's OpenRouter J1 / J2 / adjudicator (same check);
//   - the total spend cap (explore/grade.js TOTAL_CAP_USD) is checked before any call;
//   - preGrade exclusions: exact abstentions and technical failures get no judge call;
//   - J1 and J2 on every judgeable answer; a verdict already present under the same
//     unitVerdictKey (main study verdicts, the given verdict files) is reused, and identical
//     keys inside one pass are called once;
//   - adjudication when J1 and J2 disagree, when both say INCORRECT, and for the seeded 10% of
//     consensus-CORRECT (inCorrectAudit on `${unit.cellId}|${unit.alias}|${questionKey}`);
//   - adjudicator evidence as gradeConfirm builds it: shown = the unit's item.paths (else the
//     gold path), supporting = gold + twins + answer-bearing emails among item.paths;
//   - verdict records in gradeConfirm's shape, appended to `verdictsPath`;
//   - one spend.jsonl entry per session (OpenRouter key usage before/after + token estimate).
// Nothing here prints an answer, a reference or a verdict.

import { appendFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { mapLimit } from "../bm25.js"
import { readJsonl as readStoreJsonl } from "../store.js"
import { judgeConfig, referenceVerdict, adjudicate, preGrade, callJudge, inCorrectAudit, JudgePaused, JudgeAuthError, USAGE } from "../judge.js"
import { unitVerdictKey, verdictIndex, referencesOf } from "../grade.js"
import { exploreDirOf } from "../explore/pool.js"
import { openRouterUsage, spendSoFar, estimateUsd, entryUsd, TOTAL_CAP_USD, PRICES } from "../explore/grade.js"

// explore/confirm.js JUDGE_MODELS (not exported there), unchanged.
export const JUDGE_MODELS = { j1: "openai/gpt-oss-20b", j2: "nvidia/nemotron-3-nano-30b-a3b", adj: "deepseek/deepseek-v4.1-flash" }

const iso = () => new Date().toISOString()

// explore/confirm.js mainVerdictRecords (not exported there), unchanged.
export const mainVerdictRecords = (dataDir) => {
    const agent = join(dataDir, "agent", "verdicts.jsonl")
    return [...readStoreJsonl(join(dataDir, "verdicts.jsonl")).records, ...(existsSync(agent) ? readStoreJsonl(agent).records : [])]
}

export function assertJudgeModels() {
    for (const [role, model] of Object.entries(JUDGE_MODELS)) {
        const judge = judgeConfig(role)
        if (judge.provider !== "openrouter" || judge.model !== model) throw new Error(`tier-A grading requires the study's OpenRouter ${role} model ${model}; no verdicts were written`)
    }
}

// Every verdict record the grading may reuse: the main study's, the `reuse` files (read only),
// then the file this session appends to.
export function verdictRecords({ dataDir, verdictsPath, reuse = [] }) {
    const seen = new Set()
    const out = [...mainVerdictRecords(dataDir)]
    for (const path of reuse) {
        if (path === verdictsPath || seen.has(path) || !existsSync(path)) continue
        seen.add(path)
        out.push(...readStoreJsonl(path).records)
    }
    return [...out, ...(existsSync(verdictsPath) ? readStoreJsonl(verdictsPath, { repair: true }).records : [])]
}

export async function gradeTierA({ dataDir, units, verdictsPath, reuse = [], phase, loadCorpus, label = "tier-a", log = console.log }) {
    assertJudgeModels()
    const spent = spendSoFar(dataDir)
    if (spent >= TOTAL_CAP_USD) throw new Error(`total spend cap reached: $${spent.toFixed(3)}`)
    const pre = new Map(units.map((unit) => [unit, preGrade(unit.answer)]))
    const judgeable = units.filter((unit) => !pre.get(unit))
    const records = verdictRecords({ dataDir, verdictsPath, reuse })
    const width = Number(process.env.POC2_JUDGE_CONCURRENCY ?? 8)
    const session = process.env.POC2_GRADE_SESSION ?? iso().slice(0, 10)
    log(`[${label}] ${units.length} answers, ${units.length - judgeable.length} pre-graded; spend so far $${spent.toFixed(3)}`)
    const usageBefore = await openRouterUsage()
    const item = (unit) => ({ question: unit.record.question, references: referencesOf(unit.record), candidate: unit.answer.answer })
    let paused = null
    const pass = async (passLabel, judge, selected, call) => {
        const have = new Set(verdictIndex(records, judge.role, judge.model).keys())
        const tasks = []
        const seen = new Set()
        for (const unit of selected) {
            const key = unitVerdictKey(unit, judge)
            if (have.has(key) || seen.has(key)) continue
            seen.add(key)
            tasks.push({ unit, key })
        }
        log(`[${label}] ${passLabel}: ${tasks.length} calls to ${judge.model}`)
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
    const entry = { at: iso(), phase, usd: usageBefore != null && usageAfter != null ? usageAfter - usageBefore : null, estUsd: estimateUsd(tokens), usageBefore, usageAfter, tokens }
    appendFileSync(join(exploreDirOf(dataDir), "spend.jsonl"), JSON.stringify(entry) + "\n")
    log(`[${label}] done: $${entryUsd(entry).toFixed(4)} this session, total $${(spent + entryUsd(entry)).toFixed(3)}${paused ? `; PAUSED: ${paused}` : ""}`)
    return { paused, usd: entryUsd(entry) }
}

// Tokens per call for the cost estimate: the mean over every spend.jsonl entry that used the
// model (exploration J1 batches; addendum 3's gates grading for J2 and the adjudicator); an
// assumption only where a model has no history.
const ASSUMED_TOKENS = { [JUDGE_MODELS.j1]: { prompt: 450, completion: 110 }, [JUDGE_MODELS.j2]: { prompt: 500, completion: 600 }, [JUDGE_MODELS.adj]: { prompt: 4_000, completion: 500 } }

function tokensPerCall(dataDir, model) {
    let calls = 0, prompt = 0, completion = 0
    for (const entry of readStoreJsonl(join(exploreDirOf(dataDir), "spend.jsonl")).records) {
        const t = entry.tokens?.[`openrouter:${model}`]
        if (!t?.calls) continue
        calls += t.calls; prompt += t.promptTokens; completion += t.completionTokens
    }
    return calls ? { prompt: prompt / calls, completion: completion / calls, basis: `${calls} earlier calls (spend.jsonl)` } : { ...ASSUMED_TOKENS[model], basis: "assumed" }
}

// Counts only: units, pre-graded / judgeable, the J1 / J2 calls still needed (keys without a
// verdict record yet, deduplicated as the passes do), and an adjudication range. Reads verdict
// records for their keys only (never their verdicts); prints no answer, reference or verdict.
export function planTierA({ dataDir, units, verdictsPath, reuse = [], groupOf = (unit) => unit.alias, adjRate = null }) {
    const records = verdictRecords({ dataDir, verdictsPath, reuse })
    const [j1, j2] = [judgeConfig("j1"), judgeConfig("j2")]
    const haveKeys = (judge) => {
        const keys = new Set()
        for (const record of records) if (record.type === "verdict" && record.judge === judge.role && record.judgeModel === judge.model && record.verdict) keys.add(record.verdictKey)
        return keys
    }
    const have = { j1: haveKeys(j1), j2: haveKeys(j2) }
    const groups = {}
    const pending = { j1: new Set(), j2: new Set() }
    let judgeableAll = 0
    for (const unit of units) {
        const g = (groups[groupOf(unit)] ??= { units: 0, questions: new Set(), preGraded: 0, judgeable: 0, j1New: new Set(), j2New: new Set() })
        g.units++
        g.questions.add(unit.item.questionKey)
        if (preGrade(unit.answer)) { g.preGraded++; continue }
        g.judgeable++
        judgeableAll++
        for (const [role, judge] of [["j1", j1], ["j2", j2]]) {
            const key = unitVerdictKey(unit, judge)
            if (have[role].has(key)) continue
            if (!pending[role].has(key)) { pending[role].add(key); (role === "j1" ? g.j1New : g.j2New).add(key) }
        }
    }
    const basis = Object.fromEntries(Object.entries(JUDGE_MODELS).map(([role, model]) => [role, tokensPerCall(dataDir, model)]))
    const usdPerCall = (model, t) => (PRICES[model] ? t.prompt * PRICES[model][0] + t.completion * PRICES[model][1] : NaN)
    const per = Object.fromEntries(Object.entries(JUDGE_MODELS).map(([role, model]) => [role, usdPerCall(model, basis[role])]))
    // Adjudication: unknown before J1/J2. Range: a prior share of judgeable answers (the
    // published tier-A error rate plus J1/J2 disagreement plus the 10% audit), and all of them.
    const share = adjRate ?? 0.25
    const adjLow = Math.round(judgeableAll * share)
    const est = (adjCalls) => pending.j1.size * per.j1 + pending.j2.size * per.j2 + adjCalls * per.adj
    return {
        groups: Object.fromEntries(Object.entries(groups).map(([name, g]) => [name, { units: g.units, questions: g.questions.size, preGraded: g.preGraded, judgeable: g.judgeable, j1Calls: g.j1New.size, j2Calls: g.j2New.size }])),
        totals: { units: units.length, judgeable: judgeableAll, j1Calls: pending.j1.size, j2Calls: pending.j2.size, adjCallsEstimate: adjLow, adjCallsMax: judgeableAll },
        usdPerCall: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Number(v.toFixed(6))])),
        tokenBasis: Object.fromEntries(Object.entries(basis).map(([role, t]) => [role, { prompt: Math.round(t.prompt), completion: Math.round(t.completion), basis: t.basis }])),
        usdEstimate: { expected: Number(est(adjLow).toFixed(4)), upper: Number(est(judgeableAll).toFixed(4)), adjShareAssumed: share },
        spend: { soFar: Number(spendSoFar(dataDir).toFixed(4)), cap: TOTAL_CAP_USD },
    }
}
