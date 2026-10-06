// e: where would a vote help? breakdown by x1's step (commit&sure / commit&unsure->g5 / explore)
import { table, sim, W, fmt } from "./e-lib.js"
const set = process.argv[2] ?? "S300-2"
const TH = 0.5
const ids = ["gates@1+cold", "x1@1+cold", "k3@1+cold", "g5@1+cold", "r5@1+cold", "n-g5@1+cold", "r4@1+cold"]
if (set !== "FULL-0") ids.push("p3@1+cold", "o4@1+cold", "h4@1+cold", "o12@1+cold")
const T = table(set, ids)
const names = [...T.keys()]
const keys = [...T.get("gates").keys()].filter((k) => names.every((n) => T.get(n).has(k)))
const get = (n, k) => T.get(n).get(k)
const cat = (k) => { const a = get("x1", k).a; return a.step === "commit" ? "commit-sure" : a.step === "commit-g5" ? "commit-unsure" : "explore:" + a.step }
const groups = new Map()
for (const k of keys) { const c = cat(k).startsWith("explore") ? "explore" : cat(k); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(k) }
console.log(set)
for (const [c, ks] of groups) {
    const m = ks.filter((k) => get("x1", k).record.stratum === "miss").length
    const line = names.map((n) => { const ok = ks.filter((k) => get(n, k).correct); const mm = ok.filter((k) => get(n, k).record.stratum === "miss").length; return `${n} ${mm}/${ok.length - mm}` }).join("  ")
    const any = ks.filter((k) => names.some((n) => get(n, k).correct)); const am = any.filter((k) => get("x1", k).record.stratum === "miss").length
    console.log(`${c.padEnd(14)} n=${ks.length} (miss ${m}/hit ${ks.length - m})  right miss/hit: ${line}  ANY ${am}/${any.length - am}`)
}
// on commit-unsure: x1 = g5 answer; gates answer = a.gatesAnswer. Compare via stored gates verdict when text matches
const cu = groups.get("commit-unsure") ?? []
let same = 0, agree = 0
for (const k of cu) { const a = get("x1", k).a; if (a.gatesAnswer === get("gates", k).text) same++; if (sim(get("x1", k).text, a.gatesAnswer, get("x1", k).record.question) >= TH) agree++ }
console.log(`commit-unsure: x1.gatesAnswer == stored gates text ${same}/${cu.length}; x1(g5) ~ gatesAnswer ${agree}/${cu.length}`)
