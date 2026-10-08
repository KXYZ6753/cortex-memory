// Round 6, lead: fresh-hit replication of s6's scale control on H6-D (journal, Thu 06:50 ET).
//   node benchmarks/premise2/explore2/tools/lead-s6fresh.js [set]   (default H6-D; refuses H6-C, TEST, DEMO)
// Arms: s6's det variants (gold only sandwich / T2, P-B, gates) for e2b (alias small) and e4b
// (alias mid). Hits only. Contrasts are per-question linear combinations of arm correctness on
// questions where every arm is graded, with a question bootstrap and a mailbox-cluster bootstrap
// (B = 10,000, tools/rng.js mulberry32, seed 20260922).
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
const dataDir = ".data/premise2"
const SET = process.argv[2] ?? "H6-D"
if (/^(H6-C|TEST|DEMO)/i.test(SET)) throw new Error(`${SET} is not allowed here`)
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const keys = new Set(loadSet(dataDir, SET, pool).questionKeys.filter((k) => pool.byKey.get(k).stratum === "hit"))

const ARMS = {}
for (const [m, alias] of [["e2b", "small"], ["e4b", "mid"]])
    for (const [a, variant] of [["gold", "s6-det-oracles"], ["goldT2", "s6-det-oracle"], ["pb", "s6-det-pb"], ["gates", "s6-det-gates"]])
        ARMS[`${m} ${a}`] = { variant, version: "1+cold", alias }

const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {}
}
const latest = new Map(Object.keys(ARMS).map((l) => [l, new Map()]))
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    if (!line.includes(`"set":"${SET}"`) || !line.includes('"s6-det-')) continue
    const r = JSON.parse(line)
    if (!FINAL_STATUSES.has(r.status) || !keys.has(r.questionKey)) continue
    for (const [label, arm] of Object.entries(ARMS))
        if (r.variant === arm.variant && r.version === arm.version && r.alias === arm.alias) latest.get(label).set(r.questionKey, r)
}
const score = (r) => {
    if (!r) return null
    if (preGrade(r)) return 0
    const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}
const labels = Object.keys(ARMS)
const rows = []
for (const k of keys) {
    const s = Object.fromEntries(labels.map((l) => [l, score(latest.get(l).get(k))]))
    if (Object.values(s).some((x) => x === null)) continue
    rows.push({ k, user: pool.byKey.get(k).user, s, wall: Object.fromEntries(labels.map((l) => [l, latest.get(l).get(k).wallMs])) })
}
const f = (x) => (100 * x).toFixed(2)
const mean = (xs) => xs.reduce((t, x) => t + x, 0) / Math.max(xs.length, 1)
console.log(`${SET}: ${rows.length} of ${keys.size} hits graded under all ${labels.length} arms`)
if (!rows.length) process.exit(0)
for (const l of labels) console.log(`  ${l.padEnd(12)} ${f(mean(rows.map((r) => r.s[l])))}  wall ${Math.round(mean(rows.map((r) => r.wall[l])))} ms`)

const C = {
    "PRIMARY gap closed by sandwich: [T2 e4b−e2b] − [sandwich e4b−e2b]": (s) => (s["e4b goldT2"] - s["e2b goldT2"]) - (s["e4b gold"] - s["e2b gold"]),
    "gold-only sandwich, e4b − e2b": (s) => s["e4b gold"] - s["e2b gold"],
    "gold-only T2, e4b − e2b": (s) => s["e4b goldT2"] - s["e2b goldT2"],
    "P-B, e4b − e2b": (s) => s["e4b pb"] - s["e2b pb"],
    "gates − P-B, e2b": (s) => s["e2b gates"] - s["e2b pb"],
    "gates − P-B, e4b": (s) => s["e4b gates"] - s["e4b pb"],
    "gain difference, e4b − e2b": (s) => (s["e4b gates"] - s["e4b pb"]) - (s["e2b gates"] - s["e2b pb"]),
    "e2b gates − e4b P-B": (s) => s["e2b gates"] - s["e4b pb"],
    "e4b gates − e2b gates": (s) => s["e4b gates"] - s["e2b gates"],
}
const rnd = mulberry32(20260922)
const users = [...new Set(rows.map((r) => r.user))]
const byUser = new Map(users.map((u) => [u, rows.filter((r) => r.user === u)]))
for (const [name, fn] of Object.entries(C)) {
    const v = rows.map((r) => fn(r.s))
    const d = mean(v)
    const qb = [], cb = []
    for (let b = 0; b < BOOT_B; b++) {
        let t = 0
        for (let j = 0; j < v.length; j++) t += v[Math.floor(rnd() * v.length)]
        qb.push(t / v.length)
        let tc = 0, n = 0
        for (let j = 0; j < users.length; j++) for (const r of byUser.get(users[Math.floor(rnd() * users.length)])) { tc += fn(r.s); n++ }
        cb.push(tc / n)
    }
    qb.sort((x, y) => x - y); cb.sort((x, y) => x - y)
    console.log(`${name}: ${f(d)}  question [${f(pctSorted(qb, 0.025))}, ${f(pctSorted(qb, 0.975))}]  mailbox [${f(pctSorted(cb, 0.025))}, ${f(pctSorted(cb, 0.975))}]  (+${v.filter((x) => x > 0).length}/−${v.filter((x) => x < 0).length})`)
}
