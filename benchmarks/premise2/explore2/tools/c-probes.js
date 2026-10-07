// Worker c: x1's commit-check probes on the gold email (stored logs): on hits whose gold
// is in W0, how often the gold was probed and answered NO (-> explore), and x1's
// accuracy by that outcome. Offline.  node .../c-probes.js [sets]
import { pool, loadTable, DEV_SETS } from "./c-lib.js"
const sets = process.argv[2] ? process.argv[2].split(",") : DEV_SETS
const t = {}
for (const s of sets) {
    const { table, keys } = loadTable(s, ["x1"])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        const x = table.get("x1")?.get(key)
        if (!x?.a?.log) continue
        const gold = (p) => p === r.path || (r.twins ?? []).includes(p)
        const checks = x.a.log.filter((l) => l.act === "check")
        const W0checks = x.a.yesAt != null || x.a.step ? checks : checks
        const g = checks.find((c) => gold(c.path))
        const firstYes = checks.find((c) => c.yes)
        let k
        if (!g) k = "gold not probed"
        else if (g.yes) k = firstYes === g ? "gold probed YES (first YES)" : "gold YES later"
        else k = "gold probed NO"
        const kk = `${r.stratum} ${k}`
        t[kk] ??= { n: 0, ok: 0, steps: {} }
        t[kk].n++; if (x.correct === 1) t[kk].ok++
        t[kk].steps[x.a.step] = (t[kk].steps[x.a.step] ?? 0) + 1
    }
}
for (const [k, v] of Object.entries(t).sort()) console.log(`${k.padEnd(40)} n=${String(v.n).padStart(4)} x1 right ${v.ok} (${(100 * v.ok / v.n).toFixed(0)}%)  steps ${JSON.stringify(v.steps)}`)
