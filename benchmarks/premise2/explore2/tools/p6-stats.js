// Worker p6: paired det-vs-det comparisons (no GPU).
//   node benchmarks/premise2/explore2/tools/p6-stats.js <set,set,...> <base> <arm,arm,...> [--placebo spec] [--hits] [--md]
// base: "variant@ver" or alternatives "a@1|b@1" (first one present per question; where several
// are present their answer texts are compared and the agreement is printed: behind det they
// must be byte-identical). Arms are compared with the base on the questions both have; with
// --placebo every arm is also compared with the placebo arm. --hits: hit questions only.
// Weighted Δ (missShare) when misses are present, else hit points.
import { loadAnswers, correctOf, setKeys, grading, pairStats, f1, sgn, ci, mean } from "./p6-lib.js"

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const [setsArg, baseArg, armsArg] = args
const sets = setsArg.split(",")
const baseAlts = baseArg.split("|")
const placebo = opt("--placebo")
const arms = armsArg.split(",").filter(Boolean)
const hitsOnly = flag("--hits")
const specs = [...new Set([...baseAlts, ...arms, ...(placebo ? [placebo] : [])])]
const A = await loadAnswers(specs)
const { pool } = grading()

// base answer per question (+ agreement check across alternatives)
const base = new Map()
let agree = 0, disagree = 0
const disagreements = []
for (const set of sets) for (const qk of setKeys(set)) {
    const key = `${set}|${qk}`
    const found = baseAlts.map((s) => A.get(s).get(key)).filter(Boolean)
    if (!found.length) continue
    base.set(key, found[0])
    for (const other of found.slice(1)) (other.answer === found[0].answer ? agree++ : (disagree++, disagreements.push({ key, a: found[0].answer, b: other.answer })))
}
console.log(`base ${baseArg}: ${base.size} answers on ${sets.join(",")}; alternatives agree ${agree}, differ ${disagree}`)
for (const d of disagreements.slice(0, 5)) console.log(`  differ ${d.key}\n    ${d.a.slice(0, 160)}\n    ${d.b.slice(0, 160)}`)

const pairsOf = (armMap, refMap) => {
    const pairs = []
    let ungraded = 0, same = 0
    for (const [key, a] of armMap) {
        const b = refMap.get(key)
        if (!b || !sets.includes(a.set)) continue
        const rec = pool.byKey.get(a.questionKey)
        if (hitsOnly && rec.stratum !== "hit") continue
        const ca = correctOf(a), cb = correctOf(b)
        if (ca === null || cb === null) { ungraded++; continue }
        if (a.answer === b.answer) same++
        pairs.push({ key, set: a.set, user: rec.user, stratum: rec.stratum, a: ca, b: cb, aw: a.wallMs, bw: b.wallMs, ac: a.calls, bc: b.calls, ap: a.promptTokens, bp: b.promptTokens })
    }
    return { pairs, ungraded, same }
}

const rows = []
const line = (label, ref, armMap, refMap) => {
    const { pairs, ungraded, same } = pairsOf(armMap, refMap)
    if (!pairs.length) { console.log(`${label}: no graded pairs (ungraded ${ungraded})`); return }
    const s = pairStats(pairs)
    const perSet = sets.map((set) => {
        const l = pairs.filter((p) => p.set === set)
        if (!l.length) return null
        const st = pairStats(l, { B: 1 })
        return `${set} ${sgn(st.delta)} (h +${st.flips.hit[0]}/−${st.flips.hit[1]}${st.nMiss ? `, m +${st.flips.miss[0]}/−${st.flips.miss[1]}` : ""}, n ${l.length})`
    }).filter(Boolean)
    const unit = s.nMiss ? "weighted" : "hit pts"
    console.log(`\n${label} vs ${ref}: n ${s.n} (hit ${s.nHit}, miss ${s.nMiss}; ${s.users} mailboxes)${ungraded ? `, ungraded ${ungraded}` : ""}; identical texts ${same}`)
    console.log(`  hit ${f1(s.b.hit)} -> ${f1(s.a.hit)}${s.nMiss ? `; miss ${f1(s.b.miss)} -> ${f1(s.a.miss)}` : ""}`)
    console.log(`  Δ ${unit} ${sgn(s.delta, 2)}  question-stratified ${ci(s.ciQ, 2)}  mailbox-cluster ${ci(s.ciM, 2)}  (Δ hit ${sgn(s.dHit, 2)})`)
    console.log(`  flips hits +${s.flips.hit[0]}/−${s.flips.hit[1]}${s.nMiss ? `, misses +${s.flips.miss[0]}/−${s.flips.miss[1]}` : ""}`)
    console.log(`  wall ms ${Math.round(mean(pairs.map((p) => p.aw)))} vs ${Math.round(mean(pairs.map((p) => p.bw)))}; calls ${mean(pairs.map((p) => p.ac)).toFixed(2)} vs ${mean(pairs.map((p) => p.bc)).toFixed(2)}; prompt tokens ${Math.round(mean(pairs.map((p) => p.ap)))} vs ${Math.round(mean(pairs.map((p) => p.bp)))}`)
    console.log(`  per set: ${perSet.join("; ")}`)
    rows.push({ label, ref, s, same })
}

for (const arm of arms) line(arm, baseArg, A.get(arm), base)
if (placebo) for (const arm of arms.filter((a) => a !== placebo)) line(arm, placebo, A.get(arm), A.get(placebo))

if (flag("--md")) {
    console.log("\n| arm | vs | n (hit / miss) | ref hit | arm hit | Δ | question-stratified 95% CI | mailbox-cluster 95% CI | flips hits | flips misses | identical |")
    console.log("|---|---|---|---|---|---|---|---|---|---|---|")
    for (const { label, ref, s, same } of rows) console.log(`| ${label} | ${ref} | ${s.n} (${s.nHit} / ${s.nMiss}) | ${f1(s.b.hit)} | ${f1(s.a.hit)} | ${sgn(s.delta, 2)} | ${ci(s.ciQ, 2)} | ${ci(s.ciM, 2)} | +${s.flips.hit[0]}/−${s.flips.hit[1]} | ${s.nMiss ? `+${s.flips.miss[0]}/−${s.flips.miss[1]}` : "–"} | ${same} |`)
}
process.exit(0)
