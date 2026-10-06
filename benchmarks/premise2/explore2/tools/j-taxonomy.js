// Worker j: hand labels (read one by one, see j.md) for x1's wrong hit answers on
// S300-2, S300-1, FULL-0, in j-dump.js order, and their counts by x1 step.
//   node benchmarks/premise2/explore2/tools/j-dump.js <set> x1 hit > wrong-<set>.jsonl  (for each set)
//   node benchmarks/premise2/explore2/tools/j-taxonomy.js <dir with wrong-*.jsonl>
// WF wrong fact/relation from the right email; HDR header/thread (sender, recipient,
// forwarder, cc); WE another email read; PART incomplete or vague; OVER extra
// contradicting detail or several candidates; HEDGE "does not specify" despite the
// answer being there; STRICT correct-looking answer judged wrong (typo copied from the
// email, paraphrase, "you" for the recipient, restated question dropping a word, a
// literal extra sentence); GRAN other granularity/format (full number vs extension, Jim
// vs James Griffin, "RE: FW:" subject, one name split in two); TRUNC cut at 160 tokens;
// AMB ambiguous question or gold is an inference.
import { readFileSync } from "node:fs"
import { join } from "node:path"
const LABELS = {
    "S300-2": "WF WE HDR HEDGE STRICT PART HEDGE WF STRICT STRICT PART HDR WF WE STRICT WF PART GRAN HEDGE PART GRAN PART",
    "S300-1": "WE AMB WF PART WF AMB PART TRUNC PART AMB WF WF WE GRAN WF WF AMB STRICT OVER",
    "FULL-0": "WF OVER PART OVER WE WE STRICT PART WF AMB WF STRICT WF WF STRICT WF PART WF PART WF WE AMB GRAN STRICT WF STRICT HEDGE OVER STRICT WE HDR WF STRICT PART WF PART WF WF WE GRAN HDR WE PART",
}
const dir = process.argv[2] ?? "."
const total = new Map()
const byStep = new Map()
for (const [set, labels] of Object.entries(LABELS)) {
    const rows = readFileSync(join(dir, `wrong-${set}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    const L = labels.split(" ")
    if (L.length !== rows.length) throw new Error(`${set}: ${L.length} labels for ${rows.length} rows`)
    rows.forEach((row, i) => {
        const step = row.step === "commit" ? "commit(sure)" : row.step === "commit-g5" ? "handover" : "explore"
        const t = total.get(L[i]) ?? { n: 0, sets: {}, oracleRight: 0, gatesRight: 0 }
        t.n++; t.sets[set] = (t.sets[set] ?? 0) + 1; t.oracleRight += row.oracle ?? 0; t.gatesRight += row.gates ?? 0
        total.set(L[i], t)
        const k = `${L[i]} ${step}`
        byStep.set(k, (byStep.get(k) ?? 0) + 1)
    })
}
console.log("label | n | S300-2 / S300-1 / FULL-0 | gates run right | oracle right (FULL-0 only)")
for (const [l, t] of [...total].sort((a, b) => b[1].n - a[1].n)) console.log(`${l} | ${t.n} | ${t.sets["S300-2"] ?? 0} / ${t.sets["S300-1"] ?? 0} / ${t.sets["FULL-0"] ?? 0} | ${t.gatesRight} | ${t.oracleRight}`)
console.log("\nlabel step counts:")
for (const [k, n] of [...byStep].sort()) console.log(`${k}: ${n}`)
