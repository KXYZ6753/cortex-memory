// Offline simulation of a gates + agent-escalation hybrid on S300-2 from stored,
// graded answers: use agent a2's answer instead of gates' when a trigger fires.
// Triggers combine "a2's pick is outside gates' final context" with weak question
// coverage of the email gates' answer came from.
import { openAll } from "./a-lib.js"
import { gatesContextsOffline } from "./a-gatesctx.js"
import { attribute } from "../variants/a-common.js"
import { contentWords, normaliseForMatch } from "../../text.js"
const setName = process.argv[2] ?? "S300-2"
const { graded, emails, missShare } = await openAll()
const g = new Map(graded("gates@1+cold", setName).map((i) => [i.record.questionKey, i]))
const rows = []
for (const a of graded("a2@1+cold", setName)) {
    const gi = g.get(a.record.questionKey)
    const { final } = gatesContextsOffline(a.record, gi.answer.used ?? 1, emails.emailOf)
    const pick = a.answer.step === "read1" ? a.answer.readPaths[0] : null
    const src = gi.abstain ? null : attribute(gi.answer.answer, a.record.question, final, emails.emailOf)
    const qw = contentWords(a.record.question)
    const cov = (path) => { const l = normaliseForMatch(emails.emailOf(path)); return qw.filter((w) => l.includes(w)).length / Math.max(1, qw.length) }
    rows.push({ st: a.record.stratum, outside: pick && !final.includes(pick), srcCov: src ? cov(src.path) : 0, pickCov: pick ? cov(pick) : 0, gC: gi.correct, aC: a.correct })
}
const nMiss = rows.filter((r) => r.st === "miss").length, nHit = rows.filter((r) => r.st === "hit").length
for (const [label, f] of [
    ["outside", (r) => r.outside],
    ["outside & srcCov<0.5", (r) => r.outside && r.srcCov < 0.5],
    ["outside & pickCov>srcCov", (r) => r.outside && r.pickCov > r.srcCov],
    ["outside & pickCov>=srcCov+0.15", (r) => r.outside && r.pickCov >= r.srcCov + 0.15],
]) {
    const fired = rows.filter(f)
    const d = (st) => fired.filter((r) => r.st === st).reduce((s, r) => s + r.aC - r.gC, 0)
    console.log(`${label}: fires miss ${fired.filter((r) => r.st === "miss").length}, hit ${fired.filter((r) => r.st === "hit").length}; net correct miss ${d("miss")}, hit ${d("hit")}; Δweighted ${(100 * (missShare * d("miss") / nMiss + (1 - missShare) * d("hit") / nHit)).toFixed(2)}`)
}
emails.close()
