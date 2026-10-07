// Worker b: gold answers vs x1 / gates hit answers on the development sets (offline).
//   node benchmarks/premise2/explore2/tools/b-gold.js [variants=x1,gates] [sets=S300-1,S300-2,S300-3,FULL-1] [dump]
// Prints accuracy by question type, answer/gold length, J1 parts and missing reasons, and
// how often the gold's numbers / capitalised names are absent from wrong vs right answers.
import { pool, loadTable, verdictRow, DEV_SETS, specifics, sentences, recordsOf, DEMO_SETS, emails } from "./b-lib.js"

const variants = (process.argv[2] ?? "x1,gates").split(",")
const sets = process.argv[3] ? process.argv[3].split(",") : DEV_SETS
const dump = process.argv[4] === "dump"
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "-")
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

for (const variant of variants) {
    const rows = []
    for (const setName of sets) {
        const { table, keys } = loadTable(setName, [variant])
        const V = table.get(variant)
        if (!V) { console.log(`${variant}: no answers on ${setName}`); continue }
        for (const key of keys) {
            const r = pool.byKey.get(key)
            const v = V.get(key)
            if (!v || v.correct === null) continue
            const j = verdictRow(r, v.answer)
            rows.push({ set: setName, r, v, j })
        }
    }
    const hits = rows.filter((x) => x.r.stratum === "hit")
    console.log(`\n=== ${variant}: ${hits.length} graded hits, ${hits.filter((x) => x.v.correct).length} right (${pct(hits.filter((x) => x.v.correct).length, hits.length)}%)`)
    // by type
    const types = [...new Set(hits.map((x) => x.r.type))]
    console.log("type      n   acc   wrong")
    for (const t of types) { const h = hits.filter((x) => x.r.type === t); const ok = h.filter((x) => x.v.correct).length; console.log(`${t.padEnd(12)}${String(h.length).padStart(4)} ${pct(ok, h.length).padStart(5)} ${String(h.length - ok).padStart(5)}`) }
    // multi-part questions
    const multi = (q) => /\band (what|who|when|how|where|which|why)\b|\?.*\?|\band\b.*\b(reason|purpose|why)\b/i.test(q)
    for (const [label, f] of [["multi-part", (x) => multi(x.r.question)], ["single", (x) => !multi(x.r.question)], ["partsAsked>1", (x) => (x.j?.partsAsked ?? 1) > 1]]) {
        const h = hits.filter(f); const ok = h.filter((x) => x.v.correct).length
        console.log(`${label.padEnd(14)} n ${h.length} acc ${pct(ok, h.length)}`)
    }
    // lengths
    const right = hits.filter((x) => x.v.correct), wrong = hits.filter((x) => !x.v.correct)
    console.log(`answer chars median: right ${med(right.map((x) => x.v.answer.length))}, wrong ${med(wrong.map((x) => x.v.answer.length))}; gold chars median ${med(hits.map((x) => x.r.gold.length))}`)
    console.log(`answer sentences median: right ${med(right.map((x) => sentences(x.v.answer)))}, wrong ${med(wrong.map((x) => sentences(x.v.answer)))}; gold ${med(hits.map((x) => sentences(x.r.gold)))}`)
    // answer shorter than gold
    const shorter = (x) => x.v.answer.length < 0.6 * x.r.gold.length
    for (const [label, h] of [["right", right], ["wrong", wrong]]) console.log(`${label}: answer < 0.6 x gold length: ${h.filter(shorter).length}/${h.length}`)
    // specifics of the gold missing from the answer
    const missingSpec = (x) => {
        const g = specifics(x.r.gold), a = x.v.answer.toLowerCase()
        const q = x.r.question.toLowerCase()
        const nums = g.nums.filter((n) => !q.includes(n.toLowerCase()))
        const caps = g.caps.filter((c) => !q.includes(c.toLowerCase()))
        return { numMiss: nums.filter((n) => !a.includes(n.toLowerCase().replace(/^\$/, ""))).length, numN: nums.length, capMiss: caps.filter((c) => !a.includes(c.toLowerCase().split(" ")[0])).length, capN: caps.length }
    }
    for (const [label, h] of [["right", right], ["wrong", wrong]]) {
        const m = h.map(missingSpec)
        const withNum = m.filter((x) => x.numN > 0)
        const withCap = m.filter((x) => x.capN > 0)
        console.log(`${label}: gold has a new number in ${withNum.length}; answer lacks >=1 of them in ${withNum.filter((x) => x.numMiss > 0).length} (${pct(withNum.filter((x) => x.numMiss > 0).length, withNum.length)}%). gold has new names in ${withCap.length}; answer lacks >=1 in ${withCap.filter((x) => x.capMiss > 0).length} (${pct(withCap.filter((x) => x.capMiss > 0).length, withCap.length)}%)`)
    }
    // J1 parts / missing
    const partsShort = wrong.filter((x) => x.j && x.j.partsCorrect > 0 && x.j.partsCorrect < x.j.partsAsked).length
    const zeroParts = wrong.filter((x) => x.j && x.j.partsCorrect === 0).length
    console.log(`wrong: some parts right but not all ${partsShort}, no part right ${zeroParts}, J1 'missing' non-empty ${wrong.filter((x) => x.j?.missing).length}`)
    if (dump) for (const x of wrong) console.log(JSON.stringify({ set: x.set, type: x.r.type, q: x.r.question, gold: x.r.gold, ans: x.v.answer, parts: x.j ? `${x.j.partsCorrect}/${x.j.partsAsked}` : null, missing: x.j?.missing, reason: x.j?.reason, step: x.v.a.step }))
}

// demo bank overview
const store = await emails()
const bank = DEMO_SETS.flatMap(recordsOf)
const types = {}
for (const r of bank) types[r.type] = (types[r.type] ?? 0) + 1
const lens = bank.map((r) => store.emailOf(r.path).length)
console.log(`\nDEMO bank: ${bank.length} questions (${bank.filter((r) => r.stratum === "hit").length} hits); types ${JSON.stringify(types)}`)
console.log(`gold email chars: p25 ${med(lens.filter((l, i, a) => l <= med(a)))} median ${med(lens)} p90 ${[...lens].sort((a, b) => a - b)[Math.floor(lens.length * 0.9)]}; <= 1500: ${lens.filter((l) => l <= 1500).length}, <= 2500: ${lens.filter((l) => l <= 2500).length}`)
console.log(`gold answer chars median ${med(bank.map((r) => r.gold.length))}; users ${new Set(bank.map((r) => r.user)).size}`)
