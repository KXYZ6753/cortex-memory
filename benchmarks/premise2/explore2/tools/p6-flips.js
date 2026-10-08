// Worker p6: where the flips of an arm vs its reference sit (no GPU).
//   node benchmarks/premise2/explore2/tools/p6-flips.js <set,set> <ref|alt> <arm> [--dump N]
// Gold-only (hits): flips by the parent's prompt length in tokens (det-recorded prompt_eval_count
// of the answer call; sliding-window layers see 512 tokens), by question type.
// End to end: flips by stratum x path (switched first context, abstention retry used), by the
// gold email's position in the first context, and whether the first context changed.
// --dump N prints N flipped questions each way (question, gold, ref answer, arm answer).
import { loadAnswers, correctOf, setKeys, grading } from "./p6-lib.js"
import { questionType } from "../../text.js"

const args = process.argv.slice(2)
const [setsArg, refArg, arm] = args
const dump = args.includes("--dump") ? Number(args[args.indexOf("--dump") + 1]) : 0
const sets = setsArg.split(",")
const refAlts = refArg.split("|")
const A = await loadAnswers([...refAlts, arm])
const { pool } = grading()
const rows = []
for (const set of sets) for (const qk of setKeys(set)) {
    const key = `${set}|${qk}`
    const ref = refAlts.map((s) => A.get(s).get(key)).find(Boolean)
    const a = A.get(arm).get(key)
    if (!ref || !a) continue
    const rec = pool.byKey.get(qk)
    const cr = correctOf(ref), ca = correctOf(a)
    if (cr === null || ca === null) continue
    const gold = new Set([rec.path, ...(rec.twins ?? [])])
    const pos = (paths) => (paths ?? []).findIndex((p) => gold.has(p))
    rows.push({
        key, rec, ref, a, d: ca - cr, cr, ca,
        tokens: (ref.det?.evaluated?.[0] ?? 0) + (ref.det?.cached?.[0] ?? 0),
        qtype: questionType(rec.question),
        path: `${rec.stratum}|${ref.switched ? "switched" : "global"}${(ref.used ?? 1) > 1 || (a.used ?? 1) > 1 ? "+retry" : ""}`,
        goldPos: pos(ref.contextPaths), ctxSame: JSON.stringify(ref.contextPaths) === JSON.stringify(a.contextPaths),
        same: ref.answer === a.answer,
    })
}
const table = (title, keyOf) => {
    const groups = new Map()
    for (const r of rows) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) }
    console.log(`\n${title}\n| group | n | ref right | arm right | +fixed | −broken | identical texts |\n|---|---|---|---|---|---|---|`)
    for (const [k, l] of [...groups].sort((x, y) => String(x[0]).localeCompare(String(y[0]), undefined, { numeric: true }))) {
        console.log(`| ${k} | ${l.length} | ${l.filter((r) => r.cr).length} | ${l.filter((r) => r.ca).length} | ${l.filter((r) => r.d > 0).length} | ${l.filter((r) => r.d < 0).length} | ${l.filter((r) => r.same).length} |`)
    }
}
console.log(`${arm} vs ${refArg} on ${setsArg}: ${rows.length} graded pairs`)
const goldOnly = rows.every((r) => r.rec.stratum === "hit") && rows.every((r) => (r.ref.contextPaths ?? []).length === 1)
if (goldOnly) {
    const bucket = (t) => (t <= 450 ? "a ≤450" : t <= 550 ? "b 451-550" : t <= 700 ? "c 551-700" : t <= 1000 ? "d 701-1000" : "e >1000")
    table("by parent prompt tokens (gold email + ~130 template/rules/question tokens)", (r) => bucket(r.tokens))
    table("by question type", (r) => r.qtype)
} else {
    table("by stratum x path (ref's route; +retry if either arm retried)", (r) => r.path)
    table("by gold position in ref's first context (-1 = not in it)", (r) => `${r.rec.stratum} pos ${r.goldPos < 0 ? "-1" : r.goldPos}`)
    table("by first context unchanged / changed", (r) => `${r.rec.stratum} ${r.ctxSame ? "same ctx" : "ctx changed"}`)
    table("hits by question type", (r) => (r.rec.stratum === "hit" ? r.qtype : "miss"))
}
if (dump) for (const sign of [1, -1]) {
    console.log(`\n==== ${sign > 0 ? "fixed by" : "broken by"} ${arm} ====`)
    for (const r of rows.filter((x) => x.d === sign).slice(0, dump)) console.log(`\n[${r.key}] (${r.qtype}, ${r.tokens} tok)\nQ: ${r.rec.question}\nGOLD: ${r.rec.gold}\nREF: ${r.ref.answer}\nARM: ${r.a.answer}`)
}
process.exit(0)
