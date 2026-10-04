// Offline failure analysis of gates on FULL-0 (stored answers + J1 verdicts, pool
// records only): wrong = abstained vs confident; where the evidence was; how well a
// cheap "unsupported answer" check separates correct from wrong answers.
//   node benchmarks/premise2/explore2/tools/a-fail.js [variant@version] [set]
import { openAll } from "./a-lib.js"
import { byHeaderRank } from "../../explore/variants.js"
import { contentWords, criticalSpans, spanHaystack, spanPresent, normaliseForMatch } from "../../text.js"

const target = process.argv[2] ?? "gates@1+cold"
const setName = process.argv[3] ?? "FULL-0"
const { graded, emails, bearing, missShare } = await openAll()
const items = graded(target, setName).filter((i) => i.correct !== null)
const W = (list, f) => {
    const m = list.filter((i) => i.record.stratum === "miss"), h = list.filter((i) => i.record.stratum === "hit")
    return { miss: m.filter(f).length, hit: h.filter(f).length, w: missShare * m.filter(f).length / Math.max(1, items.filter((i) => i.record.stratum === "miss").length) + (1 - missShare) * h.filter(f).length / Math.max(1, items.filter((i) => i.record.stratum === "hit").length) }
}
const fmt = (o) => `miss ${o.miss}, hit ${o.hit}, weighted ${(o.w * 100).toFixed(1)} pts`

// Support score: share of the answer's novel content words (not in the question) and
// critical spans found in the emails of the final context.
export function support(answer, question, paths, emailOf) {
    const text = paths.map(emailOf).join("\n")
    const hay = spanHaystack(text)
    const lower = normaliseForMatch(text)
    const q = new Set(contentWords(question))
    const words = contentWords(answer).filter((w) => !q.has(w))
    const spans = criticalSpans(answer)
    const wordHit = words.filter((w) => lower.includes(w)).length
    const spanHit = spans.filter((s) => spanPresent(s, hay)).length
    return { words: words.length, wordShare: words.length ? wordHit / words.length : 1, spans: spans.length, spanShare: spans.length ? spanHit / spans.length : 1, missingSpans: spans.length - spanHit }
}

for (const item of items) {
    const { record, answer } = item
    const global = record.lists.global.slice(0, 5)
    const mailbox = byHeaderRank(record.question, record.lists.user.slice(0, 20), emails.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const contexts = switched ? [mailbox, global] : [global, mailbox]
    const used = answer.used ?? 1
    item.final = contexts[used - 1]
    const isB = bearing(record)
    item.finalHas = item.final.some(isB)
    item.anyHas = contexts.flat().some(isB)
    item.user20 = record.lists.user.some(isB)
    item.global20 = record.lists.global.some(isB)
    item.switched = switched
    item.used = used
    item.consistent = answer.switched === switched
    item.sup = item.abstain ? null : support(answer.answer, record.question, item.final, emails.emailOf)
}
console.log(`${target} ${setName}: n=${items.length}, consistency of recomputed switch ${items.filter((i) => i.consistent).length}/${items.length}`)
const wrong = items.filter((i) => !i.correct)
console.log(`correct: ${fmt(W(items, (i) => i.correct))}`)
console.log(`wrong: ${fmt(W(items, (i) => !i.correct))}`)
console.log(`  abstained (after both contexts): ${fmt(W(items, (i) => !i.correct && i.abstain))}`)
console.log(`  confident wrong: ${fmt(W(items, (i) => !i.correct && !i.abstain))}`)
for (const [label, f] of [
    ["abstain, evidence in some shown context", (i) => i.abstain && i.anyHas],
    ["abstain, evidence only in mailbox top20 (not shown)", (i) => i.abstain && !i.anyHas && i.user20],
    ["abstain, evidence only in global top20 (not shown, not mailbox20)", (i) => i.abstain && !i.anyHas && !i.user20 && i.global20],
    ["abstain, not in either top20", (i) => i.abstain && !i.anyHas && !i.user20 && !i.global20],
    ["conf-wrong, evidence in final context", (i) => !i.correct && !i.abstain && i.finalHas],
    ["conf-wrong, evidence in other context only", (i) => !i.correct && !i.abstain && !i.finalHas && i.anyHas],
    ["conf-wrong, evidence in mailbox top20 not shown", (i) => !i.correct && !i.abstain && !i.anyHas && i.user20],
    ["conf-wrong, evidence nowhere in top20s", (i) => !i.correct && !i.abstain && !i.anyHas && !i.user20],
]) console.log(`  ${label}: ${fmt(W(items, f))}`)
console.log(`used=2 (second context): ${items.filter((i) => i.used === 2).length}; correct among them ${items.filter((i) => i.used === 2 && i.correct).length}`)
console.log(`switched: ${items.filter((i) => i.switched).length}`)

// Unsupported-answer trigger: ROC over thresholds.
const answered = items.filter((i) => !i.abstain)
console.log(`\nanswered ${answered.length}: correct ${answered.filter((i) => i.correct).length}, wrong ${answered.filter((i) => !i.correct).length}`)
for (const [label, flag] of [
    ["any critical span missing", (i) => i.sup.missingSpans > 0],
    ["wordShare < 0.5", (i) => i.sup.wordShare < 0.5],
    ["wordShare < 0.7", (i) => i.sup.wordShare < 0.7],
    ["wordShare < 0.8", (i) => i.sup.wordShare < 0.8],
    ["wordShare < 0.9", (i) => i.sup.wordShare < 0.9],
    ["span missing or wordShare < 0.7", (i) => i.sup.missingSpans > 0 || i.sup.wordShare < 0.7],
    ["evidence not in final context (oracle signal)", (i) => !i.finalHas],
]) {
    const fired = answered.filter(flag)
    console.log(`  ${label}: fires ${fired.length} (${(100 * fired.length / items.length).toFixed(1)}% of all), on wrong ${fired.filter((i) => !i.correct).length}/${answered.filter((i) => !i.correct).length}, on correct ${fired.filter((i) => i.correct).length}/${answered.filter((i) => i.correct).length}; wrong-and-fired with evidence in mailbox20 not shown ${fired.filter((i) => !i.correct && !i.anyHas && i.user20).length}`)
}
if (process.argv.includes("--dump")) for (const i of wrong.filter((i) => !i.abstain).slice(0, 40)) console.log(JSON.stringify({ q: i.record.question, gold: i.record.gold, a: i.answer.answer, st: i.record.stratum, finalHas: i.finalHas, anyHas: i.anyHas, u20: i.user20, sup: i.sup }))
emails.close()
