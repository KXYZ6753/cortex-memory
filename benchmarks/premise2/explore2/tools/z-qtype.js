// z: x1 accuracy by question shape (two-part questions, vague "the email" questions).
import { loadTable, pool } from "./n-lib.js"
const two = /,? and (who|what|when|where|why|how|which|whom)\b|\band (to whom|the name|what time)\b/i
const vague = /\b(the|this) (email|article|message|document)\b(?! (from|sent|about|to)\b)/i
const c = {}
for (const set of ["S300-2", "S300-1"]) {
    const { table, keys } = loadTable(set, ["x1"])
    for (const k of keys) {
        const x = table.get("x1").get(k); if (x?.correct == null) continue
        const r = pool.byKey.get(k)
        const t = two.test(r.question) ? "two-part" : "single"
        for (const key of [`${r.stratum} ${t}`, `${r.stratum} all`]) { const e = (c[key] ??= [0, 0]); e[0] += x.correct; e[1]++ }
    }
}
for (const [k, [a, n]] of Object.entries(c).sort()) console.log(k.padEnd(16), `${a}/${n}`, (100 * a / n).toFixed(1))
