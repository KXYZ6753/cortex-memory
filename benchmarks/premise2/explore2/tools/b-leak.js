// Worker b: leakage check for similarity-chosen demos (offline). For each question of the
// given sets: do the chosen demos' gold answers or emails carry the question's own answer
// (a number / name of the question's gold that is not in the question)? Also prints the
// distribution of demo similarity and how often a demo shares the asker's subject line.
//   node benchmarks/premise2/explore2/tools/b-leak.js [sets] [mode=sim] [k=4]
import { loadBank, selectDemos } from "../variants/b-common.js"
import { recordsOf, emails, dataDir, specifics, DEV_SETS } from "./b-lib.js"

const sets = process.argv[2] ? process.argv[2].split(",") : DEV_SETS
const mode = process.argv[3] ?? "sim"
const k = Number(process.argv[4] ?? 4)
const store = await emails()
const bank = loadBank(dataDir)
const subj = (e) => (String(e).match(/^Subject:(.*)$/m)?.[1] ?? "").trim().toLowerCase().replace(/^(re|fw|fwd):\s*/g, "")
let n = 0, ansLeak = 0, mailLeak = 0, sameSubj = 0
const examples = []
for (const setName of sets) {
    for (const r of recordsOf(setName)) {
        n++
        const demos = selectDemos(bank, r, { k, mode })
        const g = specifics(r.gold)
        const q = r.question.toLowerCase()
        const specific = [...g.nums, ...g.caps].filter((t) => t.length >= 4 && !q.includes(t.toLowerCase()))
        const inAns = demos.some((d) => specific.some((t) => d.gold.toLowerCase().includes(t.toLowerCase())))
        const inMail = demos.some((d) => specific.some((t) => store.emailOf(d.path).toLowerCase().includes(t.toLowerCase())))
        const s = subj(store.emailOf(r.path))
        const ss = s.length > 5 && demos.some((d) => subj(store.emailOf(d.path)) === s)
        if (inAns) { ansLeak++; if (examples.length < 12) examples.push({ q: r.question, gold: r.gold, demo: demos.find((d) => specific.some((t) => d.gold.toLowerCase().includes(t.toLowerCase())))?.gold, tok: specific.filter((t) => demos.some((d) => d.gold.toLowerCase().includes(t.toLowerCase()))) }) }
        if (inMail) mailLeak++
        if (ss) sameSubj++
    }
}
console.log(`${n} questions, mode ${mode} k ${k}: a demo's gold answer contains a specific token of the question's gold ${ansLeak} (${(100 * ansLeak / n).toFixed(1)}%); a demo email contains one ${mailLeak} (${(100 * mailLeak / n).toFixed(1)}%); a demo email has the same subject ${sameSubj}`)
for (const e of examples) console.log(JSON.stringify(e))
