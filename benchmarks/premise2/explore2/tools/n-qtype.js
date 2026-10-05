// Offline: accuracy by question type (text.js questionType) for chosen variants.
import { pool, loadTable } from "./n-lib.js"
import { questionType } from "../../text.js"
const [setName = "FULL-0", list = "gates,oracles"] = process.argv.slice(2)
const vs = list.split(",")
const { table, keys } = loadTable(setName, vs)
const multi = (q) => /\band (what|who|when|where|how|which|why)\b|\?.*\?|\b(and|or) (the )?(date|time|reason|name)/i.test(q)
for (const st of ["hit", "miss"]) for (const [label, fn] of [["type", (r) => questionType(r.question)], ["multi", (r) => (multi(r.question) ? "multi" : "single")]]) {
    const groups = new Map()
    for (const q of keys) { const r = pool.byKey.get(q); if (r.stratum !== st) continue; const k = fn(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q) }
    for (const [k, qs] of groups) console.log(st, label, k.padEnd(12), "n", qs.length, vs.map((v) => `${v} ${(100 * qs.reduce((s, q) => s + (table.get(v).get(q)?.correct ?? 0), 0) / qs.length).toFixed(1)}`).join(" "))
}
