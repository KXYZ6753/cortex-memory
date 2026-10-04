// Offline: summary tables from f-anatomy.js output.
// node benchmarks/premise2/explore2/tools/f-summary.js anat.json
import { readFileSync } from "node:fs"
const { missShare, rows } = JSON.parse(readFileSync(process.argv[2], "utf8"))
const W = (list, pred) => {
    const miss = rows.filter((r) => r.stratum === "miss"), hit = rows.filter((r) => r.stratum === "hit")
    const m = list.filter((r) => r.stratum === "miss" && pred(r)).length, h = list.filter((r) => r.stratum === "hit" && pred(r)).length
    return { n: m + h, m, h, w: 100 * (missShare * m / miss.length + (1 - missShare) * h / hit.length) }
}
const f = (x) => x.toFixed(1)
const line = (label, pred, list = rows) => { const s = W(list, pred); return `| ${label} | ${s.n} | ${s.m} | ${s.h} | ${f(s.w)} |` }
const P = []
P.push("## 1. Buckets (gates@1+cold, FULL-0)", "", "| bucket | n | miss | hit | weighted pts |", "|---|---|---|---|---|")
for (const b of ["correct", "reading error", "wrong context (gold only in unused ctx)", "abstained (gold in view)", "abstained (gold not in view)", "never found"]) P.push(line(b, (r) => r.bucket === b))
P.push(`| all wrong | | | | ${f(W(rows, (r) => !r.correct).w)} |`)
const RE = rows.filter((r) => r.bucket === "reading error")
P.push("", "### Reading errors by position of first answer-bearing email in the final context", "", "| pos | n | miss | hit | weighted pts | (all questions with AB at pos: n, acc) |", "|---|---|---|---|---|---|")
for (const p of [1, 2, 3, 4, 5]) {
    const all = rows.filter((r) => r.posFinal === p)
    const s = W(RE, (r) => r.posFinal === p)
    P.push(`| ${p} | ${s.n} | ${s.m} | ${s.h} | ${f(s.w)} | ${all.length}, ${f(100 * all.filter((r) => r.correct).length / all.length)}% |`)
}
P.push("", "### Reading errors by final-context source", "", "| source | n | miss | hit | weighted pts | all qs in cell: n, acc |", "|---|---|---|---|---|---|")
const cells = [
    ["global, not switched, no retry", (r) => !r.switched && !r.retry],
    ["mailbox, switched, no retry", (r) => r.switched && !r.retry],
    ["mailbox, not switched, retry fired", (r) => !r.switched && r.retry],
    ["global, switched, retry fired", (r) => r.switched && r.retry],
]
for (const [label, pred] of cells) {
    const all = rows.filter(pred)
    const s = W(RE, pred)
    P.push(`| ${label} | ${s.n} | ${s.m} | ${s.h} | ${f(s.w)} | ${all.length}, ${f(100 * all.filter((r) => r.correct).length / all.length)}% |`)
}
P.push("", "### All buckets by cell (counts)", "", "| cell | correct | reading | wrong ctx | abst(in view) | abst(not) | never |", "|---|---|---|---|---|---|---|")
for (const [label, pred] of cells) {
    const c = (b) => rows.filter((r) => pred(r) && r.bucket === b).length
    P.push(`| ${label} | ${c("correct")} | ${c("reading error")} | ${c("wrong context (gold only in unused ctx)")} | ${c("abstained (gold in view)")} | ${c("abstained (gold not in view)")} | ${c("never found")} |`)
}
// Never found
const NF = rows.filter((r) => r.bucket === "never found" || r.bucket === "abstained (gold not in view)")
const rk = (x) => (x === null ? "none" : x <= 10 ? "6-10" : x <= 20 ? "11-20" : "21-50")
P.push("", `### Gold absent from both contexts (never found + abstained-not-in-view): n=${NF.length} (miss ${NF.filter((r) => r.stratum === "miss").length}, hit ${NF.filter((r) => r.stratum === "hit").length})`, "")
for (const key of ["global50", "mailbox50", "mailboxHeader50"]) {
    const t = {}
    for (const r of NF) { const b = rk(r.deep?.[key] ?? null); t[b] = (t[b] ?? 0) + 1 }
    P.push(`- ${key}: ${Object.entries(t).map(([k, v]) => `${k} ${v}`).join(", ")}`)
}
P.push(`- gold email is in the asker's mailbox: ${NF.filter((r) => r.deep?.goldInMailbox).length}/${NF.length}`)
P.push(`- in mailbox top 10 (BM25): ${NF.filter((r) => r.deep?.mailbox50 && r.deep.mailbox50 <= 10).length}; top 20: ${NF.filter((r) => r.deep?.mailbox50 && r.deep.mailbox50 <= 20).length}; header-reranked top 10 of top 50: ${NF.filter((r) => r.deep?.mailboxHeader50 && r.deep.mailboxHeader50 <= 10).length}`)
P.push(`- oracles correct on these: ${NF.filter((r) => r.others.oracles?.c).length}/${NF.length}`)

// 3. Gate confusion
P.push("", "## 3. Gate quality: switched × answer-bearing in global top 5", "", "| | AB in global top5 | AB not in global top5 |", "|---|---|---|")
for (const sw of [false, true]) {
    const cell = (inG) => { const l = rows.filter((r) => r.switched === sw && Boolean(r.posGlobal) === inG); const acc = l.filter((r) => r.correct).length; const mb = l.filter((r) => r.posMailbox).length; return `n=${l.length}, acc ${f(100 * acc / l.length)}%, AB in mailbox5 ${mb}, pbs acc ${f(100 * l.filter((r) => r.others.pbs?.c).length / l.length)}%, oracles ${f(100 * l.filter((r) => r.others.oracles?.c).length / l.length)}%` }
    P.push(`| ${sw ? "switched (mailbox first)" : "not switched (global first)"} | ${cell(true)} | ${cell(false)} |`)
}
// Alt: switched × AB in mailbox5
P.push("", "| | AB in mailbox top5 | not |", "|---|---|---|")
for (const sw of [false, true]) {
    const cell = (inM) => { const l = rows.filter((r) => r.switched === sw && Boolean(r.posMailbox) === inM); return `n=${l.length}, acc ${f(100 * l.filter((r) => r.correct).length / l.length)}%` }
    P.push(`| ${sw ? "switched" : "not switched"} | ${cell(true)} | ${cell(false)} |`)
}
// 4. gates loses
P.push("", "## 4. Paired with simpler/sibling variants (counts: other right & gates wrong / gates right & other wrong; net weighted)", "")
for (const o of ["pb", "pbs", "gatea", "gates6", "gatesi", "gatesm", "gatesf", "hdru", "oracles"]) {
    const l = rows.filter((r) => r.others[o] && r.others[o].c !== null)
    const lose = l.filter((r) => r.others[o].c && !r.correct), win = l.filter((r) => !r.others[o].c && r.correct)
    const net = W(l, (r) => r.correct).w - W(l, (r) => r.others[o].c).w
    const lb = {}; for (const r of lose) { const k = `${r.bucket}|${r.switched ? "sw" : "nosw"}${r.retry ? "+retry" : ""}`; lb[k] = (lb[k] ?? 0) + 1 }
    P.push(`- ${o}: lose ${lose.length} (miss ${lose.filter((r) => r.stratum === "miss").length}), win ${win.length}; gates − ${o} = ${f(net)} weighted. Losses by gates bucket: ${Object.entries(lb).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ")}`)
}
// Oracle-flips: gates wrong but oracles right
const both = rows.filter((r) => !r.correct)
P.push("", `Gates wrong: ${both.length}; of these oracles (gold only) right: ${both.filter((r) => r.others.oracles?.c).length}; oracles wrong too: ${both.filter((r) => r.others.oracles?.c === 0).length}`)
P.push(`Reading errors where oracles also wrong (gold-alone unreadable / judge / ambiguous): ${RE.filter((r) => r.others.oracles?.c === 0).length}/${RE.length}`)

// 5. Predictors
P.push("", "## 5. Predictors (all 600; and within AB-in-final-context questions)", "")
const quart = (vals) => { const s = [...vals].sort((a, b) => a - b); return [0.25, 0.5, 0.75].map((q) => s[Math.floor(q * s.length)]) }
for (const [name, get] of [["ctxChars", (r) => r.ctxChars], ["goldChars", (r) => r.goldChars], ["otherMailbox", (r) => r.otherMailbox], ["dupBodies", (r) => r.dupBodies], ["nAB", (r) => r.nAB], ["nTwins", (r) => r.nTwins]]) {
    const inView = rows.filter((r) => r.posFinal)
    const qs = quart(inView.map(get))
    const bins = name.endsWith("Chars") ? [[-Infinity, qs[0]], [qs[0], qs[1]], [qs[1], qs[2]], [qs[2], Infinity]] : [[-Infinity, 0], [0, 1], [1, 2], [2, Infinity]]
    const desc = bins.map(([lo, hi]) => {
        const l = inView.filter((r) => get(r) > lo && get(r) <= hi)
        const lab = name.endsWith("Chars") ? `(${lo === -Infinity ? 0 : Math.round(lo)},${hi === Infinity ? "∞" : Math.round(hi)}]` : `${hi === Infinity ? ">" + lo : hi}`
        return `${lab}: n=${l.length} acc ${l.length ? f(100 * l.filter((r) => r.correct).length / l.length) : "–"}%`
    })
    P.push(`- ${name} (AB in final ctx, n=${inView.length}): ${desc.join("; ")}`)
}
console.log(P.join("\n"))
