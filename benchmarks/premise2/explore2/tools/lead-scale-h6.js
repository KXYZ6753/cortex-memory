// Round 6, lead: e2b vs e4b P-B and gates on fresh hits, pooled over sets (journal, Thu 07:45 ET).
//   node benchmarks/premise2/explore2/tools/lead-scale-h6.js <set,set> [--allow-h6c]
// Arms: s6-det-pb and s6-det-gates for e2b (alias small) and e4b (alias mid), behind det. Hits
// only in the contrasts; misses are listed separately. Question bootstrap (within set) and
// mailbox-cluster bootstrap, B = 10,000, tools/rng.js mulberry32, seed 20260922.
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
const SETS = (process.argv[2] ?? "H6-D").split(",")
const allowH6C = process.argv.includes("--allow-h6c")
for (const s of SETS) if (/^(TEST|DEMO)/i.test(s) || (s === "H6-C" && !allowH6C)) throw new Error(`${s} is not allowed here`)
const pool = loadPool(dataDir)
const judge = judgeConfig("j1")
const setOf = new Map()
for (const s of SETS) for (const k of loadSet(dataDir, s, pool).questionKeys) setOf.set(k, s)

const ARMS = {
    "e2b pb": { variant: "s6-det-pb", alias: "small" }, "e2b gates": { variant: "s6-det-gates", alias: "small" },
    "e4b pb": { variant: "s6-det-pb", alias: "mid" }, "e4b gates": { variant: "s6-det-gates", alias: "mid" },
    "e2b i-det-gates": { variant: "i-det-gates", version: "2+cold", alias: "small" },
}
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {}
}
const latest = new Map(Object.keys(ARMS).map((l) => [l, new Map()]))
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")), crlfDelay: Infinity })
for await (const line of rl) {
    if (!line.includes('"s6-det-') && !line.includes('"i-det-gates"')) continue
    const m = line.match(/"set":"([^"]+)"/)
    if (!m || !SETS.includes(m[1])) continue
    const r = JSON.parse(line)
    if (!FINAL_STATUSES.has(r.status) || setOf.get(r.questionKey) !== r.set) continue
    for (const [label, arm] of Object.entries(ARMS))
        if (r.variant === arm.variant && r.version === (arm.version ?? "1+cold") && r.alias === arm.alias) latest.get(label).set(r.questionKey, r)
}
const score = (r) => {
    if (!r) return null
    if (preGrade(r)) return 0
    const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge))
    return v ? (v.verdict === "CORRECT" ? 1 : 0) : null
}
const main = ["e2b pb", "e2b gates", "e4b pb", "e4b gates"]
const rows = [], missRows = []
for (const [k, set] of setOf) {
    const rec = pool.byKey.get(k)
    const s = Object.fromEntries(Object.keys(ARMS).map((l) => [l, score(latest.get(l).get(k))]))
    if (main.some((l) => s[l] === null)) continue
    const row = { k, set, user: rec.user, s, wall: Object.fromEntries(main.map((l) => [l, latest.get(l).get(k).wallMs])), same: latest.get("e2b gates").get(k)?.answer === latest.get("e2b i-det-gates").get(k)?.answer }
    if (rec.stratum === "hit") rows.push(row); else missRows.push(row)
}
const f = (x) => (100 * x).toFixed(2)
const mean = (xs) => xs.reduce((t, x) => t + x, 0) / Math.max(xs.length, 1)
console.log(`${SETS.join(",")}: ${rows.length} hits and ${missRows.length} misses graded under all four arms`)
for (const set of [...SETS, "pooled"]) {
    const xs = set === "pooled" ? rows : rows.filter((r) => r.set === set)
    if (!xs.length) continue
    console.log(`  ${set} hits (n ${xs.length}): ` + main.map((l) => `${l} ${f(mean(xs.map((r) => r.s[l])))} (${Math.round(mean(xs.map((r) => r.wall[l])))} ms)`).join(" | "))
}
const withI = rows.filter((r) => r.s["e2b i-det-gates"] !== null)
console.log(`  s6-det-gates (e2b) vs i-det-gates: identical texts ${withI.filter((r) => r.same).length}/${withI.length}, accuracy ${f(mean(withI.map((r) => r.s["e2b gates"])))} vs ${f(mean(withI.map((r) => r.s["e2b i-det-gates"])))}`)
if (missRows.length) console.log(`  misses (n ${missRows.length}): ` + main.map((l) => `${l} ${missRows.filter((r) => r.s[l] === 1).length}`).join(" | "))

const C = {
    "PRIMARY e2b gates − e4b P-B": (s) => s["e2b gates"] - s["e4b pb"],
    "P-B, e4b − e2b": (s) => s["e4b pb"] - s["e2b pb"],
    "gates − P-B, e2b": (s) => s["e2b gates"] - s["e2b pb"],
    "gates − P-B, e4b": (s) => s["e4b gates"] - s["e4b pb"],
    "gain difference, e4b − e2b": (s) => (s["e4b gates"] - s["e4b pb"]) - (s["e2b gates"] - s["e2b pb"]),
    "e4b gates − e2b gates": (s) => s["e4b gates"] - s["e2b gates"],
}
const rnd = mulberry32(20260922)
const users = [...new Set(rows.map((r) => r.user))]
const byUser = new Map(users.map((u) => [u, rows.filter((r) => r.user === u)]))
const bySet = SETS.map((s) => rows.filter((r) => r.set === s)).filter((g) => g.length)
for (const [name, fn] of Object.entries(C)) {
    for (const scope of [...(SETS.length > 1 ? SETS : []), "pooled"]) {
        const xs = scope === "pooled" ? rows : rows.filter((r) => r.set === scope)
        if (!xs.length) continue
        const d = mean(xs.map((r) => fn(r.s)))
        let line = `${name} [${scope}]: ${f(d)}  (+${xs.filter((r) => fn(r.s) > 0).length}/−${xs.filter((r) => fn(r.s) < 0).length})`
        if (scope === "pooled") {
            const qb = [], cb = []
            for (let b = 0; b < BOOT_B; b++) {
                let t = 0
                for (const g of bySet) for (let j = 0; j < g.length; j++) t += fn(g[Math.floor(rnd() * g.length)].s)
                qb.push(t / rows.length)
                let tc = 0, n = 0
                for (let j = 0; j < users.length; j++) for (const r of byUser.get(users[Math.floor(rnd() * users.length)])) { tc += fn(r.s); n++ }
                cb.push(tc / n)
            }
            qb.sort((x, y) => x - y); cb.sort((x, y) => x - y)
            line += `  question [${f(pctSorted(qb, 0.025))}, ${f(pctSorted(qb, 0.975))}]  mailbox [${f(pctSorted(cb, 0.025))}, ${f(pctSorted(cb, 0.975))}]`
        }
        console.log(line)
    }
}
