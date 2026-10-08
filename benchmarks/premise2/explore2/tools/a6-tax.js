// Worker a6: fresh taxonomy of wrong hit answers on the dev sets S300-4, S300-5, FULL-2,
// FULL-3 (none used by j.md), for det gates / x1 / q1 / lite, with the det gold-only
// oracle (a6-det-oracle) as the reading reference. Automatic classes per wrong answer:
//   ABST   abstained or hedged ("does not specify"), n's HEDGE
//   PART   J1 counts >= 2 requested parts and at least one right (incomplete)
//   WE     the answer's novel words come from another email of the read context (a-common
//          attribute share > gold's share + 0.2, gold share < 0.5)
//   WRONG  everything else (wrong fact / relation from the right email, judge strictness,
//          granularity; split by hand on samples)
// Question features (deployable, no gold): question type (text.js), multi-part
// (s-cloze isMultiPart), header-field question (asks for sender / recipient / subject),
// gold-email thread size (c-render segmentThread; uses the gold path: analysis only).
//   node benchmarks/premise2/explore2/tools/a6-tax.js [sets] [dump.jsonl]
import { writeFileSync } from "node:fs"
import { loadRuns, setKeys, pool, openEmails } from "./a6-lib.js"
import { attribute } from "../variants/a-common.js"
import { isMultiPart } from "../variants/s-cloze.js"
import { segmentThread } from "../variants/c-render.js"
import { HEDGE } from "../variants/n-conf.js"
import { questionType, contentWords, normaliseForMatch } from "../../text.js"
import { isAbstain } from "../../prompts.js"
import { splitParts } from "../variants/a6-surgery.js"
const NAMEFORM = /last name|full name|name (?:incomplete|mismatch|format)|incomplete name|spelling|typo|format|leading 1|missing ['"]?inc|abbreviat|extension/i
const OMIT = /omit|missing|lacks|no mention|not mention|incomplete|only (?:one|1|two|part)|does not (?:state|provide|include|mention|give|specify|identify)|not provided|absent|without|vague/i

const sets = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3").split(",")
const dumpPath = process.argv[3] ?? null
export const SYS = { gates: "i-det-gates@2+cold", x1: "i-det-x1@2+cold", q1: "q-det-q1@1+cold", lite: "lite-det-ub@1+cold", oracle: "a6-det-oracle@1+cold" }
const runs = loadRuns(sets, [...Object.values(SYS), "oracles@1+cold"])
// the stored (non-det) gold-only run stands in where a6-det-oracle has not run
for (const [k, x] of runs.get("oracles@1+cold")) if (!runs.get(SYS.oracle).has(k)) runs.get(SYS.oracle).set(k, x)
const emails = await openEmails()

export const HDR_Q = /\bwho (?:sent|wrote|forwarded|is the sender|was the sender|is the author|authored)\b|\b(?:sender|recipients?|addressee)\b|\bto whom\b|\bwho (?:received|was (?:the (?:email|message|memo) )?(?:sent|addressed|forwarded|copied|cc'?d)|were (?:the (?:email|message) )?(?:sent|addressed|copied))\b|\b(?:sent|addressed|forwarded|copied|cc'?d) to\b|\bsubject (?:line|of)\b/i

const rows = []
for (const set of sets) {
    for (const key of setKeys(set)) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const email = emails.emailOf(r.path)
        const seg = segmentThread(email)
        const head = String(email).split("\n=====")[0]
        const qw = new Set(contentWords(r.question))
        const gnovel = contentWords(r.gold).filter((w) => !qw.has(w))
        const headN = normaliseForMatch(head)
        const goldInHead = gnovel.length ? gnovel.filter((w) => headN.includes(w)).length / gnovel.length : 0
        const row = { set, key, user: r.user, q: r.question, gold: r.gold, qtype: questionType(r.question), multi: isMultiPart(r.question), hdrQ: HDR_Q.test(r.question), goldInHead: +goldInHead.toFixed(2), nMsg: seg.blocks.length + 1, split: !!splitParts(r.question), sys: {} }
        for (const [name, vAt] of Object.entries(SYS)) {
            const x = runs.get(vAt).get(key)
            if (!x) continue
            const a = x.a
            let cls = null
            if (x.correct === 0) {
                const read = [...new Set([...(a.readPaths ?? []), ...(a.contextPaths ?? [])])]
                const ab = new Set([r.path, ...(r.twins ?? [])])
                const att = read.length ? attribute(a.answer, r.question, read, emails.emailOf) : null
                const goldAtt = attribute(a.answer, r.question, [r.path], emails.emailOf)
                const why = String(x.row?.reason ?? "") + " " + String(x.row?.missing ?? "")
                if (a.status === "output_limit") cls = "TRUNC"
                else if (isAbstain(a.answer) || HEDGE.test(a.answer)) cls = "ABST"
                else if (att && !ab.has(att.path) && att.share > (goldAtt?.share ?? 0) + 0.2 && (goldAtt?.share ?? 0) < 0.5) cls = "WE"
                else if (NAMEFORM.test(x.row?.reason ?? "")) cls = "NAME"
                else if ((x.row?.partsAsked ?? 1) >= 2 && (x.row?.partsCorrect ?? 0) >= 1) cls = "PART"
                else if (OMIT.test(why) && (x.row?.partsCorrect ?? 0) === 0 && OMIT.test(x.row?.reason ?? "")) cls = "OMIT"
                else cls = "WRONG"
            }
            row.sys[name] = { c: x.correct, cls, ans: a.answer, step: a.step ?? null, pa: x.row?.partsAsked ?? null, pc: x.row?.partsCorrect ?? null, miss: x.row?.missing ?? null, why: x.row?.reason ?? null }
        }
        rows.push(row)
    }
}
emails.close()
if (dumpPath) writeFileSync(dumpPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "–")
const N = rows.length
console.log(`hits: ${N} (${sets.map((s) => `${s} ${rows.filter((r) => r.set === s).length}`).join(", ")}); oracle answered on ${rows.filter((r) => r.sys.oracle).length}`)
console.log("\nAccuracy on hits by system:")
for (const name of Object.keys(SYS)) { const l = rows.filter((r) => r.sys[name]?.c != null); console.log(`  ${name}: ${pct(l.filter((r) => r.sys[name].c).length, l.length)} (n ${l.length})`) }

console.log("\nWrong-hit classes per system: n wrong (share of all hits) | oracle right on them")
const CLS = ["TRUNC", "ABST", "WE", "NAME", "PART", "OMIT", "WRONG"]
console.log(`| class | ${Object.keys(SYS).filter((s) => s !== "oracle").join(" | ")} |`)
for (const c of CLS) {
    const cells = Object.keys(SYS).filter((s) => s !== "oracle").map((s) => {
        const l = rows.filter((r) => r.sys[s]?.cls === c)
        const o = l.filter((r) => r.sys.oracle?.c != null)
        return `${l.length} (${pct(l.length, N)}%) | or ${o.filter((r) => r.sys.oracle.c).length}/${o.length}`
    })
    console.log(`| ${c} | ${cells.join(" | ")} |`)
}

console.log("\nQuestion cells: n (share) | accuracy gates / x1 / q1 / lite / oracle")
const cell = (label, f) => {
    const l = rows.filter(f)
    const acc = (s) => { const m = l.filter((r) => r.sys[s]?.c != null); return pct(m.filter((r) => r.sys[s].c).length, m.length) }
    console.log(`  ${label.padEnd(34)} ${String(l.length).padStart(4)} (${pct(l.length, N)}%) | ${["gates", "x1", "q1", "lite", "oracle"].map(acc).join(" / ")}`)
}
cell("all", () => true)
for (const t of ["who", "when", "number", "url-contact", "other"]) cell(`qtype ${t}`, (r) => r.qtype === t)
cell("multi-part (isMultiPart)", (r) => r.multi)
cell("multi-part (splitParts)", (r) => r.split)
cell("not split", (r) => !r.split)
cell("who & not split", (r) => r.qtype === "who" && !r.split)
cell("single-part", (r) => !r.multi)
cell("header-field question", (r) => r.hdrQ)
cell("gold mostly in file header (>=.5)", (r) => r.goldInHead >= 0.5)
cell("who & chain (gold >=2 msgs)", (r) => r.qtype === "who" && r.nMsg >= 2)
cell("who & single", (r) => r.qtype === "who" && r.nMsg < 2)
cell("chain >=2", (r) => r.nMsg >= 2)
cell("chain >=3", (r) => r.nMsg >= 3)
cell("single message", (r) => r.nMsg < 2)
cell("multi & chain", (r) => r.multi && r.nMsg >= 2)
