// Worker s: evaluate the gold-only forms of s-gold on hits (J1 verdicts of the renders,
// graded by c-grade.js into the shared verdict store): accuracy per form, paired flips
// and bootstrap CI vs base and vs the placebo (pad), by set, by MC-applicable subset /
// question type, on the hand-labelled error classes (tools/s-labels.json: base-wrong
// answers labelled with j's taxonomy) and on j's x1 WF questions; wall time per form.
//   node benchmarks/premise2/explore2/tools/s-eval.js <sets> [variant=s-gold] [FLIPS=clz,mc]
import { existsSync, readFileSync } from "node:fs"
import { questionType } from "../../text.js"
import { latestAnswers } from "../../explore/grade.js"
import { pool, dataDir, verdictOf } from "./c-lib.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"
import { isMultiPart, NONE, FALLBACK_STEM } from "../variants/s-cloze.js"

// Derived forms (rules fixed after S300-1, before S300-2 was graded; exact offline replays
// from the stored renders):
//   clzS  clz on single-part questions with a non-fallback stem, else base
//   clzW  clz on who-questions (MC type who), else base
//   mcB   mc's span answer when its pick is a real option with mean prob >= 0.8 over the
//         two orderings, else base
//   ynB   yn's span answer when its best option has logP(YES) - logP(NO) >= 2, else base
function derived(a, record) {
    const R = a.renders, S = a.s ?? {}
    const pick = (cond, name) => (cond && R[name] ? R[name] : R.base)
    const mcBest = S.mc ? Math.max(...S.mc.scores) : -Infinity
    const ynBest = S.yn ? Math.max(...S.yn.scores) : -Infinity
    return {
        clzS: pick(!isMultiPart(record.question) && S.stem !== FALLBACK_STEM, "clz"),
        clzW: pick(S.type === "who", "clz"),
        mcB: pick(S.mc && S.mc.pick !== NONE && mcBest >= Math.log(0.8), "mc"),
        ynB: pick(S.yn && S.yn.pick !== NONE && ynBest >= 2, "yn"),
    }
}

const [setsArg, variant = "s-gold"] = process.argv.slice(2)
const sets = setsArg.split(",")
const labels = existsSync(new URL("./s-labels.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./s-labels.json", import.meta.url), "utf8")) : {}
const jwf = existsSync(new URL("./s-jwf.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./s-jwf.json", import.meta.url), "utf8")) : {}
const rows = []
const VERSION = process.env.SVER ?? "3+cold" // only this version's answers (earlier versions had a broken rewrite)
for (const a of latestAnswers(dataDir)) {
    if (!sets.includes(a.set) || a.variant !== variant || !a.renders || a.version !== VERSION) continue
    const r = pool.byKey.get(a.questionKey)
    if (!process.env.NODERIVED) a.renders = { ...a.renders, ...derived(a, r) }
    const v = Object.fromEntries(Object.entries(a.renders).map(([k, x]) => [k, x.status === "ok" || x.status === "output_limit" ? verdictOf(r, x.answer) : 0]))
    rows.push({ key: a.questionKey, set: a.set, qt: questionType(r.question), type: a.s?.type ?? null, acted: (a.s?.options?.length ?? 0) >= 2, v, a })
}
const names = [...new Set(rows.flatMap((x) => Object.keys(x.v)))]
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : "-")
function boot(diffs) {
    if (!diffs.length) return ["-", "-"]
    const rnd = mulberry32(20261007)
    const out = []
    for (let b = 0; b < BOOT_B; b++) { let s = 0; for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)]; out.push(s / diffs.length) }
    out.sort((x, y) => x - y)
    return [pctSorted(out, 0.025), pctSorted(out, 0.975)].map((x) => (100 * x).toFixed(1))
}
function cmp(sub, name, ref) {
    const g = sub.filter((x) => x.v[name] != null && x.v[ref] != null)
    const plus = g.filter((x) => x.v[name] === 1 && x.v[ref] === 0).length
    const minus = g.filter((x) => x.v[name] === 0 && x.v[ref] === 1).length
    const [lo, hi] = boot(g.map((x) => x.v[name] - x.v[ref]))
    return { n: g.length, plus, minus, d: g.length ? (100 * (plus - minus)) / g.length : 0, lo, hi }
}
function table(label, sel) {
    const sub = rows.filter(sel)
    if (!sub.length) return
    console.log(`\n## ${label} (n = ${sub.length})`)
    console.log("form   acc    vs base: Δ [95% CI] (+/−)          vs pad: Δ [95% CI] (+/−)          changed text  ungraded")
    for (const name of names) {
        const g = sub.filter((x) => x.v[name] != null)
        const ok = g.filter((x) => x.v[name] === 1).length
        const b = cmp(sub, name, "base"), p = cmp(sub, name, "pad")
        const changed = sub.filter((x) => x.a.renders[name] && x.a.renders[name].answer !== x.a.renders.base.answer).length
        const fmt = (c) => `${c.d >= 0 ? "+" : ""}${c.d.toFixed(1)} [${c.lo}, ${c.hi}] (+${c.plus}/−${c.minus})`.padEnd(34)
        console.log(`${name.padEnd(6)} ${pct(ok, g.length).padStart(5)}  ${name === "base" ? "".padEnd(34) : fmt(b)} ${name === "pad" || !names.includes("pad") ? "".padEnd(34) : fmt(p)} ${String(changed).padStart(5)}  ${sub.length - g.length || ""}`)
    }
}
table("all hits", () => true)
for (const s of sets) table(`set ${s}`, (x) => x.set === s)
table("MC acted (typed question, >= 2 options)", (x) => x.acted)
for (const t of ["who", "when", "number", "url-contact", "entity"]) table(`MC type ${t}`, (x) => x.type === t)
table("no MC type", (x) => !x.type)
// error classes of the base answer (hand labels, j's taxonomy)
const classes = [...new Set(Object.values(labels).map((l) => l.label))]
if (classes.length) {
    console.log("\n## base-wrong answers by hand label: forms right / n")
    for (const c of classes.sort()) {
        const sub = rows.filter((x) => labels[x.key]?.label === c && x.v.base === 0)
        if (!sub.length) continue
        console.log(`${c.padEnd(7)} n ${String(sub.length).padStart(3)}  ${names.filter((n) => n !== "base").map((n) => `${n} ${sub.filter((x) => x.v[n] === 1).length}`).join("  ")}`)
    }
}
const jk = Object.entries(jwf).filter(([k]) => rows.some((x) => x.key === k))
if (jk.length) {
    console.log(`\n## j's x1 wrong-hit labels on these sets (n = ${jk.length}): forms right / n`)
    for (const c of [...new Set(jk.map(([, l]) => l))].sort()) {
        const sub = rows.filter((x) => jwf[x.key] === c)
        console.log(`${c.padEnd(7)} n ${String(sub.length).padStart(3)}  ${names.map((n) => `${n} ${sub.filter((x) => x.v[n] === 1).length}`).join("  ")}`)
    }
}
// cost per hit question (ms), from the stored per-form timings and wall time
const mean = (l) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0)
console.log(`\n## wall per hit question: total ${mean(rows.map((x) => x.a.wallMs))} ms; calls ${mean(rows.map((x) => x.a.calls))} + raw ${mean(rows.map((x) => x.a.s?.raw ?? 0))}`)
const keys = [...new Set(rows.flatMap((x) => Object.keys(x.a.s?.t ?? {})))]
console.log(keys.map((k) => `${k} ${mean(rows.filter((x) => x.a.s?.t?.[k] != null).map((x) => x.a.s.t[k]))} (n ${rows.filter((x) => x.a.s?.t?.[k] != null).length})`).join(" | "))
console.log(`stems: fallback ${rows.filter((x) => x.a.s?.stem === "The answer is").length} of ${rows.length}`)
if (process.env.FLIPS) for (const name of process.env.FLIPS.split(",")) {
    console.log(`\n### flips ${name} vs base`)
    for (const x of rows) if (x.v[name] != null && x.v.base != null && x.v[name] !== x.v.base) {
        const r = pool.byKey.get(x.key)
        console.log(`${x.v[name] ? "+" : "-"} ${x.set} ${x.key} [${x.qt}${x.type ? `/${x.type}` : ""}] Q: ${r.question}\n   GOLD: ${r.gold}\n   BASE: ${x.a.renders.base.answer}\n   ${name.toUpperCase()}: ${x.a.renders[name].answer}${x.a.s?.stem ? `\n   STEM: ${x.a.s.stem}` : ""}${x.a.s?.options ? `\n   OPTS: ${x.a.s.options.join(" | ")}` : ""}`)
    }
}
