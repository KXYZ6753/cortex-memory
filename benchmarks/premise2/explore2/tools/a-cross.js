// Cross-tab two variants' correctness on a set (paired), e.g. gates vs oracles on FULL-0,
// with optional dump of questions where A is wrong and B right.
//   node .../a-cross.js gates@1+cold oracles@1+cold FULL-0 [--dump N]
import { openAll } from "./a-lib.js"
const [a, b, setName = "FULL-0"] = process.argv.slice(2)
const { graded, emails } = await openAll()
const A = new Map(graded(a, setName).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
const B = new Map(graded(b, setName).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
const tab = {}
for (const [key, x] of A) {
    const y = B.get(key)
    if (!y) continue
    const cell = `${x.record.stratum} A${x.correct}B${y.correct}`
    tab[cell] = (tab[cell] ?? 0) + 1
}
console.log(a, "vs", b, setName, tab)
const n = Number(process.argv[process.argv.indexOf("--dump") + 1] || 0)
if (process.argv.includes("--dump")) {
    let shown = 0
    for (const [key, x] of A) {
        const y = B.get(key)
        if (!y || x.correct || !y.correct || shown++ >= n) continue
        console.log(JSON.stringify({ st: x.record.stratum, q: x.record.question, gold: x.record.gold, A: x.answer.answer, B: y.answer.answer, ctx: x.answer.contextPaths, gp: x.record.path }))
    }
}
emails.close()
