// Screening analysis (explore-plan.md §7): design-weighted accuracy, paired
// differences with a mailbox-cluster bootstrap, per-stratum accuracy, failure
// buckets and wall time, for every variant run on a set.
//
// Weighting: sets over-sample BM25 misses (50/50 in S100), so the plain mean would
// overstate the miss stratum. The weighted accuracy is
//   missShare × accuracy on misses + (1 − missShare) × accuracy on hits,
// with missShare the pool's true share. It estimates accuracy on a natural sample.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { judgeConfig, preGrade } from "../judge.js"
import { isAbstain } from "../prompts.js"
import { EvidenceCache } from "../evidence.js"
import { splitmix32 } from "../text.js"
import { loadPool } from "./pool.js"
import { loadSet } from "./sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "./grade.js"

export const RESULTS_DIR = new URL("../../results/premise2/explore/", import.meta.url)

export function weighted(items, missShare, value = (item) => item.correct) {
    const mean = (list) => (list.length ? list.reduce((sum, item) => sum + value(item), 0) / list.length : NaN)
    const miss = items.filter((item) => item.stratum === "miss")
    const hit = items.filter((item) => item.stratum === "hit")
    return { weighted: missShare * mean(miss) + (1 - missShare) * mean(hit), miss: mean(miss), hit: mean(hit), nMiss: miss.length, nHit: hit.length }
}

// Paired cluster bootstrap of the weighted difference (variant − reference): resample
// mailboxes with replacement, keep every question of a drawn mailbox, recompute.
export function pairedBootstrap(pairs, missShare, { B = 2000, seed = 20260922 } = {}) {
    const byUser = new Map()
    for (const pair of pairs) {
        if (!byUser.has(pair.user)) byUser.set(pair.user, [])
        byUser.get(pair.user).push(pair)
    }
    const users = [...byUser.keys()]
    const diff = (items) => {
        const a = weighted(items, missShare, (item) => item.a)
        const b = weighted(items, missShare, (item) => item.b)
        return { weighted: a.weighted - b.weighted, miss: a.miss - b.miss, hit: a.hit - b.hit }
    }
    const estimate = diff(pairs)
    const random = splitmix32(seed)
    const draws = []
    for (let draw = 0; draw < B; draw++) {
        const items = []
        for (let index = 0; index < users.length; index++) items.push(...byUser.get(users[Math.floor(random() * users.length)]))
        const value = diff(items).weighted
        if (Number.isFinite(value)) draws.push(value)
    }
    draws.sort((x, y) => x - y)
    const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))]
    return { ...estimate, low: at(0.025), high: at(0.975) }
}

// Failure bucket of one answer. Precedence: correct, abstained, never found (no
// answer-bearing email reached the model), shown but not opened (agents), and
// otherwise wrong with the evidence in view ("read wrong / distracted").
export function bucketOf(item, isAnswerBearing) {
    if (item.correct) return "correct"
    if (item.technical) return "technical"
    if (item.abstain) return "abstained"
    const read = item.answer.openedPaths ?? item.answer.readPaths ?? item.answer.contextPaths ?? []
    const shown = item.answer.shownPaths ?? []
    if (read.some(isAnswerBearing)) return "read but wrong"
    if (shown.some(isAnswerBearing)) return "shown not opened"
    return "never found"
}

export function analyzeSet({ dataDir, setName, alias = "small", baseline = "pb", champion = null, emailOf, log = console.log }) {
    const pool = loadPool(dataDir)
    const set = loadSet(dataDir, setName, pool)
    const missShare = pool.manifest.strata.missShare
    const judge = judgeConfig("j1")
    const verdicts = verdictIndex(dataDir)
    const keys = new Set(set.questionKeys)
    const evidence = new EvidenceCache({ get: emailOf })
    const byVariant = new Map()
    for (const answer of latestAnswers(dataDir)) {
        if (answer.set !== setName || answer.alias !== alias || !keys.has(answer.questionKey)) continue
        const record = pool.byKey.get(answer.questionKey)
        const pre = preGrade(answer)
        let correct = null
        if (pre) correct = 0
        else {
            const verdict = verdicts.get(answerVerdictKey(answer, record, judge))
            if (verdict) correct = verdict.verdict === "CORRECT" ? 1 : 0
        }
        const id = `${answer.variant}@${answer.version}`
        if (!byVariant.has(id)) byVariant.set(id, [])
        byVariant.get(id).push({ questionKey: answer.questionKey, user: record.user, stratum: record.stratum, correct, answer, record, abstain: Boolean(pre?.abstain) || isAbstain(answer.answer), technical: pre?.source === "technical" })
    }
    const answerBearingFor = (record) => (path) => path === record.path || (record.twins ?? []).includes(path) || evidence.answerBearing(path, record) === true
    const summaries = []
    const pickRef = (name) => [...byVariant.keys()].filter((id) => id.startsWith(`${name}@`)).sort().at(-1)
    const baselineId = pickRef(baseline)
    const championId = champion ? pickRef(champion) : null
    const graded = (id) => new Map((byVariant.get(id) ?? []).filter((item) => item.correct !== null).map((item) => [item.questionKey, item]))
    const baseItems = baselineId ? graded(baselineId) : new Map()
    const champItems = championId ? graded(championId) : new Map()
    const baseWall = baselineId ? mean(byVariant.get(baselineId).map((item) => item.answer.wallMs)) : null
    for (const [id, items] of byVariant) {
        const done = items.filter((item) => item.correct !== null)
        const acc = weighted(done, missShare)
        const buckets = {}
        for (const item of done) {
            const bucket = bucketOf(item, answerBearingFor(item.record))
            buckets[bucket] ??= { miss: 0, hit: 0 }
            buckets[bucket][item.stratum]++
        }
        const pairWith = (ref) => done.filter((item) => ref.has(item.questionKey)).map((item) => ({ user: item.user, stratum: item.stratum, a: item.correct, b: ref.get(item.questionKey).correct }))
        const vsBaseline = baselineId && id !== baselineId ? pairedBootstrap(pairWith(baseItems), missShare) : null
        const vsChampion = championId && id !== championId ? pairedBootstrap(pairWith(champItems), missShare) : null
        const wall = mean(items.map((item) => item.answer.wallMs))
        summaries.push({
            variant: id, n: items.length, graded: done.length, ...acc, vsBaseline, vsChampion, buckets,
            wallMs: wall, wallX: baseWall ? wall / baseWall : null, calls: mean(items.map((item) => item.answer.calls)),
            reloads: items.filter((item) => item.answer.reloaded).length, outputLimit: items.filter((item) => item.answer.status === "output_limit").length,
        })
    }
    summaries.sort((a, b) => (b.weighted ?? -1) - (a.weighted ?? -1))
    const out = { set: setName, alias, missShare, baseline: baselineId, champion: championId, at: new Date().toISOString(), summaries }
    mkdirSync(RESULTS_DIR, { recursive: true })
    writeFileSync(new URL(`${setName}-${alias}.json`, RESULTS_DIR), JSON.stringify(out, null, 2))
    log(markdownTable(out))
    return { out, byVariant }
}

const mean = (values) => {
    const list = values.filter((value) => Number.isFinite(value))
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null
}
const pct = (value) => (Number.isFinite(value) ? (value * 100).toFixed(1) : "–")
const delta = (d) => (d ? `${d.weighted >= 0 ? "+" : ""}${pct(d.weighted)} [${pct(d.low)}, ${pct(d.high)}]` : "–")

export function markdownTable(out) {
    const lines = [
        `Set ${out.set} (${out.alias}); miss share ${pct(out.missShare)}%; baseline ${out.baseline ?? "–"}${out.champion ? `; champion ${out.champion}` : ""}`,
        "",
        "| variant | graded | weighted | Δ vs baseline [95% CI] | Δ vs champion | miss | hit | Δmiss | Δhit | wall ms | × base | calls |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for (const s of out.summaries) {
        lines.push(`| ${s.variant} | ${s.graded}/${s.n} | ${pct(s.weighted)} | ${delta(s.vsBaseline)} | ${delta(s.vsChampion)} | ${pct(s.miss)} | ${pct(s.hit)} | ${s.vsBaseline ? pct(s.vsBaseline.miss) : "–"} | ${s.vsBaseline ? pct(s.vsBaseline.hit) : "–"} | ${Math.round(s.wallMs ?? 0)} | ${s.wallX ? s.wallX.toFixed(2) : "–"} | ${s.calls?.toFixed(1) ?? "–"} |`)
    }
    lines.push("", "Failure buckets (miss/hit counts):")
    for (const s of out.summaries) lines.push(`- ${s.variant}: ${Object.entries(s.buckets).map(([bucket, c]) => `${bucket} ${c.miss}/${c.hit}`).join(", ")}`)
    return lines.join("\n")
}
