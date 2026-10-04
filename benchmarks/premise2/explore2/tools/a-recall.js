// Offline recall of candidate sets on FULL-0 pool records (no GPU): gates' contexts
// vs the a2 list (first + second context + header-reranked mailbox top 20, <= N lines).
import { openAll } from "./a-lib.js"
import { byHeaderRank } from "../../explore/variants.js"
import { loadSet } from "../../explore/sets.js"
const setName = process.argv[2] ?? "FULL-0"
const { pool, emails, bearing, missShare } = await openAll()
const records = loadSet(".data/premise2", setName, pool).questionKeys.map((k) => pool.byKey.get(k))
const rows = { gatesFirst: [], gatesBoth: [], list10: [], list15: [], list20: [], mailbox20: [] }
for (const r of records) {
    const isB = bearing(r)
    const global = r.lists.global.slice(0, 5)
    const mailbox = byHeaderRank(r.question, r.lists.user, emails.emailOf, { k: 20 })
    const switched = !global[0]?.startsWith(`${r.user}/`)
    const first = switched ? mailbox.slice(0, 5) : global
    const second = switched ? global : mailbox.slice(0, 5)
    const list = [...new Set([...first, ...second, ...mailbox])]
    const add = (k, paths) => rows[k].push({ record: r, v: paths.some(isB) ? 1 : 0 })
    add("gatesFirst", first); add("gatesBoth", [...first, ...second]); add("list10", list.slice(0, 10)); add("list15", list.slice(0, 15)); add("list20", list.slice(0, 20)); add("mailbox20", r.lists.user)
}
for (const [k, l] of Object.entries(rows)) {
    const m = l.filter((x) => x.record.stratum === "miss"), h = l.filter((x) => x.record.stratum === "hit")
    const mean = (a) => a.reduce((s, x) => s + x.v, 0) / a.length
    console.log(`${k.padEnd(12)} miss ${(100 * mean(m)).toFixed(1)} hit ${(100 * mean(h)).toFixed(1)} weighted ${(100 * (missShare * mean(m) + (1 - missShare) * mean(h))).toFixed(1)}`)
}
emails.close()
