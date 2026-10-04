// Why the free-form agents lose: outcome, protocol errors, whether the evidence was
// shown / opened, query style, on stored FULL-0 / S100 agent answers.
//   node .../a-agentfail.js agent@1 FULL-0 [--dump N]
import { openAll } from "./a-lib.js"
import { contentWords } from "../../text.js"
const [target = "agent@1", setName = "FULL-0"] = process.argv.slice(2)
const { graded, bearing, emails } = await openAll()
const items = graded(target, setName).filter((i) => i.correct !== null)
const c = (f) => { const l = items.filter(f); return `${l.length} (correct ${l.filter((i) => i.correct).length}; miss ${l.filter((i) => i.record.stratum === "miss").length})` }
for (const i of items) {
    const isB = bearing(i.record)
    i.shownHas = (i.answer.shownPaths ?? []).some(isB)
    i.openHas = (i.answer.openedPaths ?? []).some(isB)
    i.nq = (i.answer.queries ?? []).length
    i.nopen = (i.answer.openedPaths ?? []).length
    const qw = new Set(contentWords(i.record.question))
    i.qOverlap = (i.answer.queries ?? []).map((q) => { const w = contentWords(q); return w.length ? w.filter((x) => qw.has(x)).length / w.length : 0 })
    i.firstQWords = contentWords(i.answer.queries?.[0] ?? "").length
}
console.log(`${target} ${setName} n=${items.length} correct ${items.filter((i) => i.correct).length}`)
const outcomes = {}
for (const i of items) { const k = `${i.answer.outcome}`; outcomes[k] ??= [0, 0]; outcomes[k][0]++; outcomes[k][1] += i.correct }
console.log("outcomes [n, correct]:", outcomes)
console.log("abstained:", c((i) => i.abstain))
console.log("protocolErrors>0:", c((i) => i.answer.protocolErrors > 0))
console.log("no search:", c((i) => i.nq === 0), " no open:", c((i) => i.nopen === 0))
console.log("evidence shown:", c((i) => i.shownHas), " opened:", c((i) => i.openHas), " shown not opened:", c((i) => i.shownHas && !i.openHas))
console.log("answered without opening anything:", c((i) => i.nopen === 0 && !i.abstain))
console.log("mean queries", (items.reduce((s, i) => s + i.nq, 0) / items.length).toFixed(2), "mean opened", (items.reduce((s, i) => s + i.nopen, 0) / items.length).toFixed(2), "mean words in first query", (items.reduce((s, i) => s + i.firstQWords, 0) / items.length).toFixed(1))
console.log("hit stratum: P-B top5 has evidence by construction; agent opened evidence on hits:", c((i) => i.record.stratum === "hit" && i.openHas), "of", c((i) => i.record.stratum === "hit"))
const n = Number(process.argv[process.argv.indexOf("--dump") + 1] || 0)
if (process.argv.includes("--dump")) for (const i of items.filter((i) => !i.correct).slice(0, n)) {
    console.log("\n=== Q:", i.record.question, "| gold:", i.record.gold, "| shownHas", i.shownHas, "openHas", i.openHas)
    for (const m of (i.answer.transcript ?? []).slice(1)) console.log(`  [${m.role}] ${m.content.slice(0, m.role === "user" ? 300 : 200).replace(/\n/g, " / ")}`)
}
emails.close()
