// Worker s6: abstention and negation rates per arm (exact ABSTAIN reply, and "does not mention/specify"-style
// negations), by stratum. Development sets only.
//   node benchmarks/premise2/explore2/tools/s6-abstain.js --sets FULL-0
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { isAbstain } from "../../prompts.js"

const args = process.argv.slice(2)
const SETS = (args.includes("--sets") ? args[args.indexOf("--sets") + 1] : "FULL-0").split(",")
for (const s of SETS) if (!/^(S100-\d|S300-[1-5]|FULL-[0-3])$/.test(s)) throw new Error(`${s} is not a development set`)
const ARMS = [["pb", "1", "small"], ["gates", "1+cold", "small"], ["oracles", "1+cold", "small"], ["pbs", "1+cold", "small"], ["oracle", "1", "small"],
    ["s6-det-pb", "1+cold", "mid"], ["s6-det-gates", "1+cold", "mid"], ["s6-det-oracles", "1+cold", "mid"], ["s6-det-pbs", "1+cold", "mid"], ["s6-det-oracle", "1+cold", "mid"], ["pb", "1", "large"]]
const pool = loadPool(".data/premise2")
const keys = new Set(SETS.flatMap((s) => loadSet(".data/premise2", s, pool).questionKeys))
const NEG = /\b(does not|doesn't|do not|did not|is not|are not)\s+(mention|specify|state|say|include|contain|provide|indicate)|not (specified|mentioned|stated)|no mention of/i
const latest = new Map()
const rl = createInterface({ input: createReadStream(".data/premise2/explore/answers.jsonl") })
for await (const line of rl) {
    if (!line) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!SETS.includes(r.set) || !keys.has(r.questionKey) || !FINAL_STATUSES.has(r.status)) continue
    if (!ARMS.some(([v, ver, a]) => r.variant === v && String(r.version) === ver && r.alias === a)) continue
    latest.set(r.key, r)
}
console.log("| arm | stratum | n | exact abstain | negation phrase | retry used (gates) |")
console.log("|---|---|---|---|---|---|")
for (const [v, ver, a] of ARMS) for (const st of ["hit", "miss"]) {
    const items = [...latest.values()].filter((r) => r.variant === v && String(r.version) === ver && r.alias === a && pool.byKey.get(r.questionKey).stratum === st)
    if (!items.length) continue
    const ab = items.filter((r) => isAbstain(r.answer)).length
    const neg = items.filter((r) => !isAbstain(r.answer) && NEG.test(r.answer)).length
    const used2 = items.filter((r) => (r.used ?? 1) > 1).length
    console.log(`| ${v}@${a} | ${st} | ${items.length} | ${ab} (${(100 * ab / items.length).toFixed(1)}%) | ${neg} (${(100 * neg / items.length).toFixed(1)}%) | ${v.includes("gates") ? used2 : ""} |`)
}
