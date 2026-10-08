// Worker s6: hit questions where two arms disagree (J1), for reading what scale fixes/breaks.
//
//   node benchmarks/premise2/explore2/tools/s6-flips.js --sets FULL-0,FULL-1 --a oracles@1+cold@small --b s6-det-oracles@1+cold@mid [--stratum hit] [--max 40]
//
// Prints question, reference answer, both answers and verdicts for the discordant pairs.
// Development sets only; pool records only.

import { createReadStream, readFileSync, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"

if (existsSync(".env") && process.env.OPENROUTER_API_KEY === undefined) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const args = process.argv.slice(2)
const opt = (name, fallback = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const SETS = opt("sets", "FULL-0").split(",")
for (const s of SETS) if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(s)) throw new Error(`${s} is not a development set`)
const parseArm = (s) => { const [variant, version, alias] = s.split("@"); return { variant, version, alias } }
const A = parseArm(opt("a", "oracles@1+cold@small"))
const B = parseArm(opt("b", "s6-det-oracles@1+cold@mid"))
const stratum = opt("stratum", "hit")
const max = Number(opt("max", "40"))

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
const of = { A: new Map(), B: new Map() }
const rl = createInterface({ input: createReadStream(join(dataDir, "explore", "answers.jsonl")) })
for await (const line of rl) {
    if (!line) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!SETS.includes(r.set) || !keys.has(r.questionKey) || !FINAL_STATUSES.has(r.status)) continue
    for (const [tag, arm] of [["A", A], ["B", B]]) if (r.variant === arm.variant && String(r.version) === arm.version && r.alias === arm.alias) of[tag].set(r.questionKey, r)
}
const verdictOf = (r) => {
    if (preGrade(r)) return { c: 0, why: "pre-graded" }
    const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge))
    return v ? { c: v.verdict === "CORRECT" ? 1 : 0, why: (v.reason ?? v.rationale ?? "").slice(0, 160) } : { c: null }
}
let fixed = 0
let broken = 0
const rows = []
for (const [key, a] of of.A) {
    const b = of.B.get(key)
    const record = pool.byKey.get(key)
    if (!b || (stratum !== "all" && record.stratum !== stratum)) continue
    const va = verdictOf(a)
    const vb = verdictOf(b)
    if (va.c === null || vb.c === null || va.c === vb.c) continue
    if (vb.c > va.c) fixed++
    else broken++
    rows.push({ dir: vb.c > va.c ? "B fixes" : "B breaks", record, a, b })
}
console.log(`${SETS.join("+")} ${stratum}: A=${A.variant}@${A.alias} B=${B.variant}@${B.alias}; B fixes ${fixed}, B breaks ${broken}`)
for (const row of rows.slice(0, max)) {
    console.log(`\n[${row.dir}] ${row.record.questionKey}  Q: ${row.record.question}`)
    console.log(`  ref: ${row.record.gold}`)
    console.log(`  A:   ${String(row.a.answer).replace(/\s+/g, " ").slice(0, 300)}`)
    console.log(`  B:   ${String(row.b.answer).replace(/\s+/g, " ").slice(0, 300)}`)
}
