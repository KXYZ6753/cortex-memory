// Round 6, lead: the live lead-liteyas against its offline derivation (lite-det-ub + lead-ya /
// lead-yas, as in tools/lead-q1yas.js) and its cost against lite-det-ub. Development sets only.
//   node benchmarks/premise2/explore2/tools/lead-liteyas-check.js <set[,set]>
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FINAL_STATUSES } from "../../explore/run.js"

const dataDir = ".data/premise2"
const SETS = new Set((process.argv[2] ?? "S300-4").split(","))
if ([...SETS].some((s) => /^(H6-C|DEMO|TEST)/i.test(s))) throw new Error("development sets only")
const live = new Map(), lite = new Map(), ya = new Map()
for (const line of readFileSync(join(dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
    if (!line || !(line.includes("\"lead-") || line.includes("\"lite-det-ub\""))) continue
    const r = JSON.parse(line)
    if (!SETS.has(r.set) || r.alias !== "small" || !FINAL_STATUSES.has(r.status)) continue
    const k = `${r.set}|${r.questionKey}`
    if (r.variant === "lead-liteyas") live.set(k, r)
    else if (r.variant === "lite-det-ub" && r.version === "1+cold") lite.set(k, r)
    else if ((r.variant === "lead-ya" || r.variant === "lead-yas") && !ya.has(k)) ya.set(k, r)
}
let same = 0, differ = 0, missing = 0
const diffs = []
const cost = { live: { wall: 0, calls: 0, real: 0 }, lite: { wall: 0, calls: 0, real: 0 }, n: 0 }
const real = (r) => (r.calls ?? 0) - (r.det?.resets ?? 0)
for (const [k, a] of live) {
    const p = lite.get(k), y = ya.get(k)
    if (!p || !y) { missing++; continue }
    const yes1 = (y.log ?? []).find((l) => l.act === "check" && l.yes) ?? null
    const derived = yes1 && (yes1.yesLp ?? -Infinity) >= -0.1 && y.step === "yes-alone" ? y.answer : p.answer
    if (derived === a.answer) same++; else { differ++; if (diffs.length < 5) diffs.push({ k, step: a.step, live: a.answer.slice(0, 120), derived: derived.slice(0, 120) }) }
    cost.n++
    cost.live.wall += a.wallMs; cost.live.calls += a.calls; cost.live.real += real(a)
    cost.lite.wall += p.wallMs; cost.lite.calls += p.calls; cost.lite.real += real(p)
}
console.log(`lead-liteyas vs derivation on ${[...SETS].join(",")}: byte-identical ${same}, differ ${differ}, missing parents ${missing}`)
for (const d of diffs) console.log("  ", JSON.stringify(d))
const per = (x) => (x / Math.max(1, cost.n))
console.log(`cost per question (n ${cost.n}): live wall ${Math.round(per(cost.live.wall))} ms, calls ${per(cost.live.calls).toFixed(2)} (real ${per(cost.live.real).toFixed(2)}) | lite-det-ub wall ${Math.round(per(cost.lite.wall))} ms, calls ${per(cost.lite.calls).toFixed(2)} (real ${per(cost.lite.real).toFixed(2)})`)
const steps = {}
for (const a of live.values()) steps[a.step] = (steps[a.step] ?? 0) + 1
console.log("live steps:", JSON.stringify(steps), "memo hits per question:", (([...live.values()].reduce((t, a) => t + (a.memoHits ?? 0), 0)) / Math.max(1, live.size)).toFixed(2))
