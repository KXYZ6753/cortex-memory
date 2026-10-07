// Worker b: print the questions whose J1 verdict differs between two variants (offline),
// with both answers, the gold, and (for b-* variants) the demo questions used.
//   node benchmarks/premise2/explore2/tools/b-flipdump.js <A> <B> <set,set> [hit|miss|all] [stats]
import { pool, loadTable, sentences } from "./b-lib.js"

const [A, B, setsArg, stratum = "hit", stats] = process.argv.slice(2)
const bank = new Map()
try { for (const d of JSON.parse((await import("node:fs")).readFileSync(".data/premise2/explore/b-bank.json", "utf8"))) bank.set(d.key, d) } catch {}
const len = { A: [], B: [] }, sent = { A: [], B: [] }
let same = 0, n = 0
for (const setName of setsArg.split(",")) {
    const { table, keys } = loadTable(setName, [A, B])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (stratum !== "all" && r.stratum !== stratum) continue
        const x = table.get(A)?.get(key), y = table.get(B)?.get(key)
        if (!x || !y) continue
        n++
        len.A.push(x.answer.length); len.B.push(y.answer.length); sent.A.push(sentences(x.answer)); sent.B.push(sentences(y.answer))
        if (x.answer.trim() === y.answer.trim()) same++
        if (stats || x.correct === null || y.correct === null || x.correct === y.correct) continue
        console.log(`\n[${setName} ${r.type} ${x.correct ? "+" : "-"}${A}] Q: ${r.question}\n  G: ${r.gold}\n  ${A}: ${x.answer}\n  ${B}: ${y.answer}`)
        const demos = x.a.bDemo?.keys ?? []
        for (const k of demos) if (bank.get(k)) console.log(`    demo: ${bank.get(k).question}`)
    }
}
const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length
console.log(`\n${n} ${stratum} questions; identical text ${same}; answer chars median ${A} ${med(len.A)} / ${B} ${med(len.B)}; mean sentences ${mean(sent.A).toFixed(2)} / ${mean(sent.B).toFixed(2)}`)
