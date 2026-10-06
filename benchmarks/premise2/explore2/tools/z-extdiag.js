// z: z-ext1 diagnostics: does the email e2b names (with a verified quote) bear the answer,
// and is the extracted answer more often right when it names an AB email? Also thinking stats.
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const set = process.argv[2] ?? "S300-2"
const c = {}
const add = (k) => (c[k] = (c[k] ?? 0) + 1)
for (const i of graded("z-ext1@1+cold", set)) {
    const a = i.answer; if (a.x1Step === "commit") continue
    const ab = bearing(i.record)
    const ctxAB = (a.x1Step === "commit-g5" ? a.readPaths : a.contextPaths).some(ab)
    add(`${i.record.stratum} ctxAB=${ctxAB} named=${a.extPath ? (ab(a.extPath) ? "AB" : "nonAB") : "none"} fb=${a.fallback ?? "-"} ok=${i.correct}`)
}
for (const [k, v] of Object.entries(c).sort()) console.log(k.padEnd(52), v)
const t = graded("z-think1@1+cold", set).filter((i) => i.answer.x1Step !== "commit")
const tok = t.map((i) => i.answer.thinkTokens ?? 0).sort((a, b) => a - b)
console.log("think tokens p50/p90/max", tok[Math.floor(tok.length / 2)], tok[Math.floor(tok.length * 0.9)], tok.at(-1), "budget-out", t.filter((i) => i.answer.fallback).length, "ms mean", Math.round(t.reduce((s, i) => s + (i.answer.thinkMs ?? 0), 0) / t.length))
process.exit(0)
