// Worker x: where is the answer-bearing (AB) email on k3's false-stop / no-found misses?
// node benchmarks/premise2/explore2/tools/x-recall.js
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()

for (const set of ["S300-2", "S300-1"]) {
    const load = (v) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
    const G = load("gates@1+cold"), K = load("k3@1+cold"), A = load("g5@1+cold"), N = load("n-g5@1+cold"), W = load("w7@1+cold")
    const cells = {}
    const add = (name, flags) => { const c = (cells[name] ??= { n: 0 }); c.n++; for (const [f, v] of Object.entries(flags)) c[f] = (c[f] ?? 0) + (v ? 1 : 0) }
    for (const [key, k] of K) {
        const rec = k.record, a = A.get(key), g = G.get(key), n = N.get(key), w = W.get(key)
        const ab = bearing(rec)
        const log = k.answer.log ?? []
        const listed = new Set(log.flatMap((l) => l.listed ?? []))
        const searched = new Set(log.flatMap((l) => l.results ?? []))
        const opened = log.filter((l) => l.act === "check").map((l) => l.path)
        const checks = log.filter((l) => l.act === "check")
        const yes = checks.find((c) => c.yes)
        let cell = k.answer.step
        if (cell === "commit") cell = yes && ab(yes.path) ? "commit-trueYES" : "commit-falseYES"
        const W0 = k.answer.step === "commit" ? k.answer.contextPaths : null
        const flags = {
            k3ok: k.correct, g5ok: a.correct, gatesOk: g.correct, unsure: n.answer.unsure,
            yesAt1: yes && checks.indexOf(yes) === 0,
            abInW0: (n.answer.contextPaths ?? []).some(ab),
            g5shownAB: (a.answer.shownPaths ?? []).some(ab), g5finalAB: (a.answer.readPaths ?? []).some(ab),
            k3listedAB: [...listed].some(ab), k3searchAB: [...searched].some(ab), k3openAB: opened.some(ab),
            w7candAB: w ? (w.answer.candidates ?? []).some(ab) : null,
            w7yesAB: w ? (w.answer.yes ?? []).some(ab) : null,
            w7yesCount: w ? (w.answer.yes ?? []).length : null,
        }
        add(`${rec.stratum}/${cell}`, flags)
    }
    console.log(`\n== ${set}`)
    for (const [name, c] of Object.entries(cells).sort()) console.log(name.padEnd(22), JSON.stringify(c))
}
process.exit(0)
