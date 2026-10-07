// det() diagnostics of stored answers: resets per question, reset time, and where real
// calls resumed (server cached-token count: 0 = full re-processing, small = a checkpoint
// inside a shared prefix, large = own-conversation reuse). Also wall time and calls.
//   node benchmarks/premise2/explore2/tools/i-detstats.js <set> <variant,variant,...> [--first N]
import { answersOf, setOf, mean } from "./i-lib.js"

const [setName, list, ...rest] = process.argv.slice(2)
const firstN = rest.includes("--first") ? Number(rest[rest.indexOf("--first") + 1]) : Infinity
const keys = setOf(setName).questionKeys.slice(0, firstN)
const q = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }
console.log("| variant | n | wall ms (p50 / p95) | calls | resets/q | reset ms/q | real calls resumed at 0 | 1 | 2-99 | >=100 | null | pert ms/q | core ms/q |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const variant of list.split(",")) {
    const answers = answersOf(setName, variant)
    const items = keys.filter((k) => answers.has(k)).map((k) => answers.get(k))
    if (!items.length) { console.log(`| ${variant} | 0 |`); continue }
    const cached = items.flatMap((a) => a.det?.cached ?? [])
    const bins = [0, 0, 0, 0, 0]
    for (const c of cached) bins[c == null ? 4 : c === 0 ? 0 : c === 1 ? 1 : c < 100 ? 2 : 3]++
    const walls = items.map((a) => a.wallMs)
    const share = (k) => (cached.length ? `${bins[k]} (${(100 * bins[k] / cached.length).toFixed(0)}%)` : "–")
    console.log(`| ${variant} | ${items.length} | ${Math.round(mean(walls))} (${q(walls, 0.5)} / ${q(walls, 0.95)}) | ${mean(items.map((a) => a.calls)).toFixed(2)} | ${mean(items.map((a) => a.det?.resets ?? 0)).toFixed(2)} | ${Math.round(mean(items.map((a) => a.det?.resetMs ?? 0)))} | ${share(0)} | ${share(1)} | ${share(2)} | ${share(3)} | ${share(4)} | ${items[0].pert ? Math.round(mean(items.map((a) => a.pert.ms))) : "–"} | ${items[0].coreMs != null ? Math.round(mean(items.map((a) => a.coreMs))) : "–"} |`)
    const resetCached = items.flatMap((a) => a.det?.resetCached ?? [])
    if (resetCached.length) {
        const counts = new Map()
        for (const c of resetCached) counts.set(c, (counts.get(c) ?? 0) + 1)
        console.log(`    reset cached-token counts: ${[...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => `${c}: ${n}`).join(", ")}`)
    }
    if (items[0].pert) {
        const kinds = new Map()
        for (const a of items) kinds.set(a.pert.kind, (kinds.get(a.pert.kind) ?? 0) + 1)
        console.log(`    perturbations: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`)
    }
}
