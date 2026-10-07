// Worker d: where x1's wrong answers sit, from stored x1 answers + J1 verdicts (pool
// records only). Per stratum and x1 path: n, correct, AB (gold, twin or answer-bearing)
// in the final reading context, wrong with no AB in the final context (the part a
// retrieval change can address at all).
//   node benchmarks/premise2/explore2/tools/d-where.js [sets...]
import { openAll } from "./a-lib.js"

const SCREEN = new Set(["S300-4", "S300-5", "FULL-2", "DEMO-1", "DEMO-2"])
const sets = (process.argv.slice(2).length ? process.argv.slice(2) : ["S300-1", "S300-2", "S300-3", "FULL-0", "FULL-1", "S100-4", "S100-5"]).filter((s) => !SCREEN.has(s))
const { graded, bearing } = await openAll()

export const finalContext = (a) => {
    if (String(a.step ?? "").startsWith("commit-")) return a.readPaths ?? []
    return a.readPaths ?? a.contextPaths ?? []
}
const pathOf = (a) => (a.step === "commit" ? "commit" : String(a.step ?? "").startsWith("commit-") ? "handover" : a.step)

const tab = {}
const add = (k, f) => { const t = (tab[k] ??= { n: 0, ok: 0, abIn: 0, wrongNoAb: 0, wrongAb: 0 }); t.n++; t.ok += f.ok; t.abIn += f.abIn; t.wrongNoAb += !f.ok && !f.abIn; t.wrongAb += !f.ok && f.abIn }
for (const set of sets) {
    const items = graded("x1@1+cold", set).filter((i) => i.correct !== null)
    for (const it of items) {
        const ab = bearing(it.record)
        const ctx = finalContext(it.answer)
        const f = { ok: it.correct, abIn: ctx.some(ab) }
        const s = it.record.stratum
        add(`${s} | all`, f)
        add(`${s} | ${pathOf(it.answer)}`, f)
        add(`all | all`, f)
    }
}
console.log(`x1 on ${sets.join(", ")}`)
console.log("stratum | path".padEnd(24), "n".padStart(5), "ok".padStart(5), "AB-in".padStart(6), "wrong&AB".padStart(9), "wrong&noAB".padStart(11))
for (const [k, t] of Object.entries(tab).sort()) console.log(k.padEnd(24), String(t.n).padStart(5), String(t.ok).padStart(5), String(t.abIn).padStart(6), String(t.wrongAb).padStart(9), String(t.wrongNoAb).padStart(11))
process.exit(0)
