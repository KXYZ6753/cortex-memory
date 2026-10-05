// Worker x: behaviour stats of x-variants (stop/handover/explore rates, gold shown -> in final, model searches).
//   node benchmarks/premise2/explore2/tools/x-stats.js S300-2 x1
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const [set, v = "x1"] = process.argv.slice(2)
const items = graded(`${v}@1+cold`, set)
const n = items.length
const cnt = (f) => items.filter(f).length
const steps = {}
for (const i of items) steps[i.answer.step] = (steps[i.answer.step] ?? 0) + 1
const fmt = (a, b) => `${a}/${b} (${((100 * a) / b).toFixed(0)}%)`
console.log(`${set} ${v} n=${n} steps`, steps)
const committed = (i) => String(i.answer.step).startsWith("commit")
console.log(`stop on own YES (commit): ${fmt(cnt(committed), n)}; kept gates' answer: ${fmt(cnt((i) => i.answer.step === "commit"), n)}; handover to g5: ${fmt(cnt((i) => i.answer.step === "commit-g5"), n)}; explored: ${fmt(cnt((i) => !committed(i)), n)}`)
for (const st of ["hit", "miss"]) {
    const s = items.filter((i) => i.record.stratum === st)
    console.log(`  ${st}: commit ${fmt(s.filter(committed).length, s.length)}, handover ${fmt(s.filter((i) => i.answer.step === "commit-g5").length, s.length)}, explore ${fmt(s.filter((i) => !committed(i)).length, s.length)}`)
}
// gold / AB shown -> in final context
let shownGold = 0, readGold = 0, shownAB = 0, readAB = 0, modelSearches = 0, picks = 0, pickAB = 0, listAB = 0
const byStratum = { hit: [0, 0], miss: [0, 0] }
for (const i of items) {
    const a = i.answer, ab = bearing(i.record), gold = i.record.path
    const log = a.log ?? []
    const shown = new Set([...(log.filter((l) => l.act === "check").map((l) => l.path)), ...log.flatMap((l) => l.listed ?? []), ...(a.g5?.readPaths ?? []), ...(a.shownPaths ?? [])])
    if (a.step === "commit" || a.step === "commit-g5") for (const p of a.contextPaths ?? []) shown.add(p) // W0 is shown (probed in order)
    const final = new Set([...(a.readPaths ?? a.contextPaths ?? [])])
    if (shown.has(gold)) { shownGold++; if (final.has(gold)) readGold++ }
    const sAB = [...shown].some(ab)
    if (sAB) { shownAB++; byStratum[i.record.stratum][0]++; if ([...final].some(ab)) { readAB++; byStratum[i.record.stratum][1]++ } }
    modelSearches += log.filter((l) => l.act === "search").length + (a.actions ?? []).filter((x) => x.name?.startsWith("search") && !x.auto).length
    for (const l of log.filter((l) => l.act === "pick")) { picks++; if (l.listed?.some(ab)) { listAB++; if (l.path && ab(l.path)) pickAB++ } }
}
console.log(`gold shown -> in final context: ${fmt(readGold, shownGold)}; AB shown -> AB in final: ${fmt(readAB, shownAB)} (hit ${byStratum.hit[1]}/${byStratum.hit[0]}, miss ${byStratum.miss[1]}/${byStratum.miss[0]})`)
console.log(`model-written searches per episode: ${(modelSearches / n).toFixed(2)}; picks ${picks}, list had AB ${listAB}, picked AB ${pickAB}`)
const calls = items.reduce((s, i) => s + (i.answer.calls ?? 0), 0) / n, wall = items.reduce((s, i) => s + (i.answer.wallMs ?? 0), 0) / n
console.log(`calls ${calls.toFixed(1)}, wall ${wall.toFixed(0)} ms`)
process.exit(0)
