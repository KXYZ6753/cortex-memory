// Worker q8 (round 6): offline breakdown of the gold-only Q8 vs Q4 pair.
//
//   node benchmarks/premise2/explore2/tools/q8-flips.js [--sets FULL-2,FULL-3,S300-4,S300-5] [--show N]
//
// On hits graded in both arms (q8-det-oracle, alias small vs small-q8): the 2x2 table of
// correctness (shared errors = the floor both precisions hit), Δ by prompt-length tercile
// (does precision matter more on longer inputs, as in multi-email contexts?), Δ by
// output length, answer-text identity, and the first N flips with question, reference and
// both answers. Development sets only; verdicts of those sets' questions only.

import { createReadStream, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
const dataDir = process.env.POC2_DATA_DIR ?? ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const SETS = opt("sets", "FULL-2,FULL-3,S300-4,S300-5").split(",")
for (const s of SETS) if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(s)) throw new Error(`${s} is not a development set`)
const show = Number(opt("show", "0"))

const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const keys = new Set(SETS.flatMap((s) => loadSet(dataDir, s, pool).questionKeys))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.verdict && keys.has(e.questionKey)) verdicts.set(e.vkey, e)
}
const arms = { small: new Map(), "small-q8": new Map() }
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    if (!line || !line.includes('"variant":"q8-det-oracle"')) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!SETS.includes(r.set) || !keys.has(r.questionKey) || !FINAL_STATUSES.has(r.status) || !arms[r.alias]) continue
    const record = pool.byKey.get(r.questionKey)
    let correct = null
    if (preGrade(r)) correct = 0
    else {
        const v = verdicts.get(answerVerdictKey(r, record, judge))
        if (v) correct = v.verdict === "CORRECT" ? 1 : 0
    }
    arms[r.alias].set(r.questionKey, { r, record, correct })
}
const pairs = [...arms.small.keys()].filter((k) => arms["small-q8"].has(k)).map((k) => ({ q4: arms.small.get(k), q8: arms["small-q8"].get(k) })).filter((p) => p.q4.correct !== null && p.q8.correct !== null)
const n = pairs.length
const both = pairs.filter((p) => p.q4.correct && p.q8.correct).length
const none = pairs.filter((p) => !p.q4.correct && !p.q8.correct).length
const fixed = pairs.filter((p) => !p.q4.correct && p.q8.correct)
const broken = pairs.filter((p) => p.q4.correct && !p.q8.correct)
const pct = (x) => (100 * x).toFixed(1)
console.log(`hits paired: ${n}`)
console.log(`2x2: both right ${both} (${pct(both / n)}%), Q8 only ${fixed.length}, Q4 only ${broken.length}, both wrong ${none} (${pct(none / n)}%)`)
console.log(`Q4 wrong ${none + fixed.length}: Q8 fixes ${fixed.length} (${pct(fixed.length / (none + fixed.length))}%); union right ${pct((n - none) / n)}%`)
console.log(`answer text identical: ${pairs.filter((p) => p.q4.r.answer === p.q8.r.answer).length}/${n}; among identical, verdict differs: ${pairs.filter((p) => p.q4.r.answer === p.q8.r.answer && p.q4.correct !== p.q8.correct).length}`)
console.log(`status: Q4 ${JSON.stringify(count(pairs.map((p) => p.q4.r.status)))}, Q8 ${JSON.stringify(count(pairs.map((p) => p.q8.r.status)))}; abstain/technical (preGrade): Q4 ${pairs.filter((p) => preGrade(p.q4.r)).length}, Q8 ${pairs.filter((p) => preGrade(p.q8.r)).length}`)

function count(values) { const c = {}; for (const v of values) c[v] = (c[v] ?? 0) + 1; return c }

// Δ (Q8 − Q4) by tercile of a per-question feature, with a question bootstrap interval.
function byTercile(name, feature) {
    const sorted = [...pairs].sort((a, b) => feature(a) - feature(b))
    const cut = [Math.floor(n / 3), Math.floor((2 * n) / 3)]
    const groups = [sorted.slice(0, cut[0]), sorted.slice(cut[0], cut[1]), sorted.slice(cut[1])]
    console.log(`\nΔ hit (Q8 − Q4) by ${name} tercile:`)
    console.log(`| tercile | range | n | Q4 | Q8 | Δ [95% q-bootstrap] | +/− |`)
    console.log(`|---|---|---|---|---|---|---|`)
    groups.forEach((g, i) => {
        const d = g.map((p) => p.q8.correct - p.q4.correct)
        const rnd = mulberry32(8100 + i)
        const draws = []
        for (let b = 0; b < BOOT_B; b++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[Math.floor(rnd() * d.length)]; draws.push(s / d.length) }
        draws.sort((x, y) => x - y)
        const m = (f) => g.reduce((s, p) => s + f(p), 0) / g.length
        console.log(`| ${i + 1} | ${feature(g[0])}–${feature(g.at(-1))} | ${g.length} | ${pct(m((p) => p.q4.correct))} | ${pct(m((p) => p.q8.correct))} | ${pct(m((p) => p.q8.correct - p.q4.correct))} [${pct(pctSorted(draws, 0.025))}, ${pct(pctSorted(draws, 0.975))}] | +${d.filter((x) => x === 1).length}/−${d.filter((x) => x === -1).length} |`)
    })
}
byTercile("prompt tokens", (p) => p.q4.r.promptTokens)
byTercile("Q4 output tokens", (p) => p.q4.r.outputTokens)

if (show) {
    for (const [label, list] of [["FIXED by Q8", fixed], ["BROKEN by Q8", broken]]) {
        console.log(`\n=== ${label} (${list.length}; first ${show}) ===`)
        for (const p of list.slice(0, show)) {
            console.log(`- [${p.q4.r.set}] Q: ${p.q4.record.question}\n  ref: ${p.q4.record.gold}\n  Q4: ${p.q4.r.answer}\n  Q8: ${p.q8.r.answer}`)
        }
    }
}
