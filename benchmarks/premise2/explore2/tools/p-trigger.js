// Offline (p): find a sharp trigger for the CE swap on non-switched questions, i.e. a
// signal that the global top 5 lacks the answer. Hit prompts must stay unchanged
// (any change to a hit prompt flips ~5% of hit answers at random; lead, FULL-0).
// Per non-switched question: CE of global #1 (g1), max CE of the global five (gmax),
// best / 2nd-best unseen CE among the asker's mailbox BM25 top 30 (b1, b2), BM25 scores.
// Sweeps simple rules and reports: fires on hits, fires on misses, fires on misses where
// the swapped email is answer-bearing (AB), and AB lost from global #5 on hits.
//   node benchmarks/premise2/explore2/tools/p-trigger.js <sets...> [--dump]

import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { openAll, SCRATCH, readJsonIf } from "./r-common.js"
import { headerScore } from "../../explore/variants.js"

process.env.R_ALLOW_HELDOUT = "1"
const sets = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const env = await openAll({ sets })
const pce = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
const rce = readJsonIf(join(SCRATCH, "r-ce.json"), {})
const rows = []
let noCe = 0
for (const record of env.records) {
    const qk = record.questionKey
    const cache = { ...(rce[qk]?.s ?? {}), ...(pce[qk] ?? {}) }
    const gHits = env.bm25.search(record.question, 20)
    const global = gHits.slice(0, 5).map((h) => h.path)
    if (!global[0]?.startsWith(`${record.user}/`)) continue // switched: not this trigger's business
    const mHits = env.bm25.search(record.question, 30, record.user)
    const cands = mHits.map((h) => h.path).filter((p) => !global.includes(p))
    if (cands.some((p) => cache[p] === undefined) || global.some((p) => cache[p] === undefined)) { noCe++; continue }
    const byCe = [...cands].sort((a, b) => cache[b] - cache[a])
    const ab = (p) => env.answerBearing(record, p)
    const gce = global.map((p) => cache[p])
    rows.push({
        qk, set: env.setOf.get(qk), stratum: record.stratum,
        need: !global.some(ab), abAt5only: ab(global[4]) && !global.slice(0, 4).some(ab),
        g1: gce[0], gmax: Math.max(...gce), b1: cache[byCe[0]], b2: cache[byCe[1]] ?? -99,
        b1ab: ab(byCe[0]), b2ab: byCe[1] ? ab(byCe[1]) : false, b3ab: byCe[2] ? ab(byCe[2]) : false,
        s1: gHits[0].score, s2: gHits[1]?.score ?? 0, h1: headerScore(record.question, env.emailOf(global[0])),
        hb1: headerScore(record.question, env.emailOf(byCe[0])),
    })
}
if (process.argv.includes("--dump")) writeFileSync(join(SCRATCH, "p-trigger-rows.json"), JSON.stringify(rows))
const hits = rows.filter((r) => r.stratum === "hit")
const misses = rows.filter((r) => r.stratum === "miss")
console.log(`non-switched: ${hits.length} hits, ${misses.length} misses (need: ${misses.filter((r) => r.need).length} misses, ${hits.filter((r) => r.need).length} hits); skipped (no CE) ${noCe}`)
console.log(`misses where b1 AB: ${misses.filter((r) => r.b1ab).length}, b1|b2 AB: ${misses.filter((r) => r.b1ab || r.b2ab).length}, b1-3: ${misses.filter((r) => r.b1ab || r.b2ab || r.b3ab).length}`)
const rules = {
    always: () => true,
    ...Object.fromEntries([-3, -2, -1, -0.5, 0, 1].map((t) => [`b1-gmax>${t}`, (r) => r.b1 - r.gmax > t])),
    ...Object.fromEntries([-2, -1, 0, 1, 2].map((t) => [`b1-g1>${t}`, (r) => r.b1 - r.g1 > t])),
    ...Object.fromEntries([-4, -2, 0, 2, 4].map((t) => [`gmax<${t}`, (r) => r.gmax < t])),
    ...Object.fromEntries([-4, -2, 0, 2].map((t) => [`g1<${t}`, (r) => r.g1 < t])),
    ...Object.fromEntries([[-1, 0], [-1, 2], [-2, 0], [-2, 2], [0, 4], [-1, 4]].map(([a, b]) => [`b1-gmax>${a}&gmax<${b}`, (r) => r.b1 - r.gmax > a && r.gmax < b])),
    ...Object.fromEntries([[-1, 0], [-1, 2], [0, 2]].map(([a, b]) => [`b1-g1>${a}&g1<${b}`, (r) => r.b1 - r.g1 > a && r.g1 < b])),
}
console.log("| rule | fires hit | fires miss | miss need | miss b1 AB (gain) | miss b1|b2 AB | hit AB@5 dropped |")
console.log("|---|---|---|---|---|---|---|")
for (const [name, rule] of Object.entries(rules)) {
    const fh = hits.filter(rule), fm = misses.filter(rule)
    console.log(`| ${name} | ${fh.length} (${(100 * fh.length / hits.length).toFixed(1)}%) | ${fm.length} | ${fm.filter((r) => r.need).length} | ${fm.filter((r) => r.need && r.b1ab).length} | ${fm.filter((r) => r.need && (r.b1ab || r.b2ab)).length} | ${fh.filter((r) => r.abAt5only).length} |`)
}
