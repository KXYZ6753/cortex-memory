// Worker t: ladder table. Per variant@version on a set: weighted / miss / hit (J1),
// Δ vs a reference with a paired bootstrap 95% CI, wall ms (mean, p50, p95, max),
// calls, gold-read rate (gold or twin in the emails the final answer was generated
// over; for own-answer agents: every email seen in full), and shown -> read.
// set may be "S300-2+S300-1" (pooled; bootstrap stratified over the pooled questions).
//   node benchmarks/premise2/explore2/tools/t-ladder.js S300-2 x1@1+cold agent@1+cold,... [--ref x1@1+cold]
import { openAll, weightedOf } from "./a-lib.js"
import { mulberry32, BOOT_B } from "./rng.js"
const { graded, missShare } = await openAll()
const argv = process.argv.slice(2)
const refIdx = argv.indexOf("--ref")
const ref = refIdx >= 0 ? argv[refIdx + 1] : "gates@1+cold"
const [set, list] = refIdx >= 0 ? argv.filter((_, i) => i !== refIdx && i !== refIdx + 1) : argv
const variants = list.split(",")

const isGold = (record) => (p) => p === record.path || (record.twins ?? []).includes(p)
function readSet(a) {
    if (a.variant === "agent") return a.openedPaths ?? []
    return a.readPaths ?? a.contextPaths ?? []
}
function shownSet(a) {
    const s = new Set([...(a.shownPaths ?? []), ...(a.contextPaths ?? []), ...(a.readPaths ?? [])])
    for (const l of a.log ?? []) { if (l.path) s.add(l.path); for (const p of l.listed ?? []) s.add(p); for (const p of l.results ?? []) s.add(p) }
    for (const p of a.g5?.readPaths ?? []) s.add(p)
    return s
}
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
function bootstrap(pairs, B = BOOT_B) {
    // pairs: [{ stratum, d }] d = v - ref per question; stratified resampling
    const m = pairs.filter((p) => p.stratum === "miss").map((p) => p.d), h = pairs.filter((p) => p.stratum === "hit").map((p) => p.d)
    const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
    const point = missShare * mean(m) + (1 - missShare) * mean(h)
    const rnd = mulberry32(12345) // was a double-precision LCG with period 10,466 (ci-erratum.md)
    const draws = []
    for (let b = 0; b < B; b++) {
        let sm = 0, sh = 0
        for (let i = 0; i < m.length; i++) sm += m[Math.floor(rnd() * m.length)]
        for (let i = 0; i < h.length; i++) sh += h[Math.floor(rnd() * h.length)]
        draws.push(missShare * sm / m.length + (1 - missShare) * sh / h.length)
    }
    draws.sort((a, b) => a - b)
    return { point: 100 * point, lo: 100 * draws[Math.floor(0.025 * B)], hi: 100 * draws[Math.floor(0.975 * B)] }
}
const sets = set.split("+")
const G = (v) => sets.flatMap((s) => graded(v, s))
const refItems = new Map(G(ref).map((i) => [i.record.questionKey, i]))
const rows = []
for (const v of variants) {
    const items = G(v)
    if (!items.length) { rows.push(`${v}: no answers`); continue }
    const ungraded = items.filter((i) => i.correct == null).length
    const g = items.filter((i) => i.correct != null)
    const w = weightedOf(g, missShare)
    const pairs = g.filter((i) => refItems.get(i.record.questionKey)?.correct != null).map((i) => ({ stratum: i.record.stratum, d: i.correct - refItems.get(i.record.questionKey).correct }))
    const ci = pairs.length ? bootstrap(pairs) : null
    const walls = items.map((i) => i.answer.wallMs ?? 0), calls = items.map((i) => i.answer.calls ?? 0)
    let read = 0, shown = 0, shownRead = 0
    for (const i of items) {
        const gold = isGold(i.record)
        const r = readSet(i.answer).some(gold)
        const s = r || [...shownSet(i.answer)].some(gold)
        read += r; shown += s; shownRead += s && r
    }
    const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
    rows.push([
        v.padEnd(14), `n ${items.length}${ungraded ? ` (ungraded ${ungraded})` : ""}`,
        `W ${(100 * w.weighted).toFixed(1)}`, `miss ${(100 * w.miss).toFixed(1)}`, `hit ${(100 * w.hit).toFixed(1)}`,
        ci ? `Δ ${ci.point >= 0 ? "+" : ""}${ci.point.toFixed(1)} [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]` : "",
        `wall ${Math.round(mean(walls))} (p50 ${pct(walls, 0.5)} p95 ${pct(walls, 0.95)} max ${Math.max(...walls)})`,
        `calls ${mean(calls).toFixed(2)} (p95 ${pct(calls, 0.95)} max ${Math.max(...calls)})`,
        `goldRead ${(100 * read / items.length).toFixed(1)}%`, `shown→read ${shownRead}/${shown}`,
    ].join(" | "))
}
console.log(`${set} (Δ vs ${ref})\n${rows.join("\n")}`)
process.exit(0)
