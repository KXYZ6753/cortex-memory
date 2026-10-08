// Worker p6: offline helpers (no GPU). Streams the exploration answer store and keeps only
// the variants asked for (the store is ~200 MB; latestAnswers parses all of it), joins J1
// verdicts, and provides the paired statistics used in p6.md:
//   - flips (+fixed / -broken) by stratum,
//   - question-stratified paired bootstrap (resample questions within stratum),
//   - mailbox-cluster paired bootstrap (resample mailboxes = record.user, all their questions),
//   both B = 10,000 with tools/rng.js mulberry32.
// Exploration data only: .data/premise2/explore/answers.jsonl + verdicts.jsonl + pool records.
import { createReadStream, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { loadPool, exploreDirOf } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"

// .env selects the J1 judge config (OpenRouter gpt-oss-20b); without it judgeConfig("j1")
// falls back to another judge id and no stored verdict matches.
if (existsSync(".env")) process.loadEnvFile(".env")
export const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const DEV = /^(S300-[1-5]|FULL-[0-3]|S100-\d|H6-D)$/

// specs: ["variant@version", ...] (version without "+cold" gets it appended).
// Returns Map(spec -> Map(`${set}|${questionKey}` -> latest final answer)).
export async function loadAnswers(specs) {
    const want = new Map(specs.map((s) => { const [v, ver] = s.split("@"); return [s, { v, ver: ver ? (ver.includes("+") ? ver : `${ver}+cold`) : null }] }))
    const names = new Set([...want.values()].map((w) => w.v))
    const out = new Map(specs.map((s) => [s, new Map()]))
    const rl = createInterface({ input: createReadStream(join(exploreDirOf(dataDir), "answers.jsonl")) })
    for await (const line of rl) {
        const v = line.match(/"variant":"([^"]+)"/)?.[1]
        if (!v || !names.has(v)) continue
        const set = line.match(/"set":"([^"]+)"/)?.[1]
        if (!set || !DEV.test(set)) continue
        let a
        try { a = JSON.parse(line) } catch { continue }
        if (!FINAL_STATUSES.has(a.status)) continue
        // e2b (study alias "small") only: q8's runs store the Q8_0 model as "small-q8", s6's e4b as "mid"
        if ((a.alias ?? "small") !== "small") continue
        for (const [s, w] of want) if (w.v === a.variant && (!w.ver || w.ver === a.version)) out.get(s).set(`${a.set}|${a.questionKey}`, a)
    }
    return out
}

let ctxCache = null
export function grading() {
    if (!ctxCache) {
        const pool = loadPool(dataDir)
        ctxCache = { pool, verdicts: verdictIndex(dataDir), judge: judgeConfig("j1"), missShare: pool.manifest.strata.missShare }
    }
    return ctxCache
}
export const setKeys = (name) => loadSet(dataDir, name, grading().pool).questionKeys

// 1 / 0 / null (not graded)
export function correctOf(answer) {
    const { pool, verdicts, judge } = grading()
    if (preGrade(answer)) return 0
    const v = verdicts.get(answerVerdictKey(answer, pool.byKey.get(answer.questionKey), judge))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}

// pairs: [{ key, set, user, stratum, a, b }] (a = arm, b = reference, 0/1)
export function pairStats(pairs, { weightedOn = true, B = BOOT_B, seed = 20261007 } = {}) {
    const { missShare } = grading()
    const S = { miss: pairs.filter((p) => p.stratum === "miss"), hit: pairs.filter((p) => p.stratum === "hit") }
    const flips = (l) => [l.filter((p) => p.a > p.b).length, l.filter((p) => p.a < p.b).length]
    const acc = (l, f) => (l.length ? l.reduce((s, p) => s + f(p), 0) / l.length : NaN)
    const useW = weightedOn && S.miss.length > 0
    const delta = (l) => {
        const m = l.filter((p) => p.stratum === "miss"), h = l.filter((p) => p.stratum === "hit")
        const dh = acc(h, (p) => p.a - p.b)
        return 100 * (useW ? missShare * acc(m, (p) => p.a - p.b) + (1 - missShare) * dh : dh)
    }
    const est = delta(pairs)
    // stratified question bootstrap
    const r1 = mulberry32(seed), d1 = []
    const dm = S.miss.map((p) => p.a - p.b), dh = S.hit.map((p) => p.a - p.b)
    for (let b = 0; b < B; b++) {
        let sm = 0, sh = 0
        for (let i = 0; i < dm.length; i++) sm += dm[Math.floor(r1() * dm.length)]
        for (let i = 0; i < dh.length; i++) sh += dh[Math.floor(r1() * dh.length)]
        d1.push(100 * (useW ? missShare * sm / dm.length + (1 - missShare) * sh / dh.length : sh / dh.length))
    }
    d1.sort((x, y) => x - y)
    // mailbox-cluster bootstrap
    const byUser = new Map()
    for (const p of pairs) { if (!byUser.has(p.user)) byUser.set(p.user, []); byUser.get(p.user).push(p) }
    const users = [...byUser.keys()]
    const r2 = mulberry32(seed + 1), d2 = []
    for (let b = 0; b < B; b++) {
        let nm = 0, sm = 0, nh = 0, sh = 0
        for (let i = 0; i < users.length; i++) {
            for (const p of byUser.get(users[Math.floor(r2() * users.length)])) {
                if (p.stratum === "miss") { nm++; sm += p.a - p.b } else { nh++; sh += p.a - p.b }
            }
        }
        const v = 100 * (useW ? missShare * (nm ? sm / nm : 0) + (1 - missShare) * (nh ? sh / nh : 0) : (nh ? sh / nh : 0))
        d2.push(v)
    }
    d2.sort((x, y) => x - y)
    return {
        n: pairs.length, nMiss: S.miss.length, nHit: S.hit.length, users: users.length,
        a: { hit: 100 * acc(S.hit, (p) => p.a), miss: 100 * acc(S.miss, (p) => p.a) },
        b: { hit: 100 * acc(S.hit, (p) => p.b), miss: 100 * acc(S.miss, (p) => p.b) },
        flips: { hit: flips(S.hit), miss: flips(S.miss) },
        delta: est, dHit: 100 * acc(S.hit, (p) => p.a - p.b), dMiss: 100 * acc(S.miss, (p) => p.a - p.b),
        ciQ: [pctSorted(d1, 0.025), pctSorted(d1, 0.975)], ciM: [pctSorted(d2, 0.025), pctSorted(d2, 0.975)],
        pGt0Q: d1.filter((x) => x <= 0).length / B,
    }
}

export const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–")
export const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–")
export const sgn = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}` : "–")
export const ci = ([lo, hi], d = 1) => `[${sgn(lo, d)}, ${sgn(hi, d)}]`
export const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : NaN)
