// Round 6, lead: exact offline derivation of "q1 + sure-YES email read alone" (q1yas) from
// q-det-q1 + lead-ya/lead-yas records. Behind det every call starts from a reset, so a live
// q1yas would issue q1's commit-check probes (the same prompt, W0 and order as lead-ya's;
// checked per question below) and, on a sure first YES, lead-ya's single sandwich read of that
// email; its answer is that read when accepted (ok, not abstain, not hedge), q1's otherwise.
//   mode all     the accepted alone-read replaces q1 on every sure first YES
//   mode commit  only where q1 itself committed with a sure gates answer (step "commit");
//                sure-YES questions q1 hands to g5 keep the g5 answer
// Prints q1yas − q-det-q1 (and − i-det-gates where present), question-stratified bootstrap.
// A different det parent can be named: node lead-q1yas.js <sets> <mode> [variant@version]
// (e.g. lite-det-ub@1+cold, whose sure-YES commits keep gates' answer A).
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { FINAL_STATUSES } from "../../explore/run.js"
import { answerVerdictKey } from "../../explore/grade.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { mulberry32, BOOT_B, pctSorted } from "./rng.js"
if (existsSync(".env")) process.loadEnvFile(".env")
const dataDir = ".data/premise2"
const SETS = (process.argv[2] ?? "S300-4,S300-5,FULL-2,FULL-3").split(",")
const MODE = process.argv[3] ?? "all"
const TAU = -0.1
const [PARENT, PARENT_VERSION] = (process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : "q-det-q1@1+cold").split("@")
if (SETS.includes("H6-C") && !process.argv.includes("--allow-h6c")) throw new Error("H6-C is the lead's confirmation set; pass --allow-h6c")
const pool = loadPool(dataDir)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const keys = new Set(SETS.flatMap((s) => loadSet(dataDir, s, pool).questionKeys.map((k) => `${s}|${k}`)))
const verdicts = new Map()
for (const line of readFileSync(join(dataDir, "explore", "verdicts.jsonl"), "utf8").split("\n")) { if (!line) continue; try { const e = JSON.parse(line); if (e.verdict) verdicts.set(e.vkey, e) } catch {} }
const ya = new Map(), q1 = new Map(), g = new Map()
for (const line of readFileSync(join(dataDir, "explore", "answers.jsonl"), "utf8").split("\n")) {
    if (!line || !(line.includes("\"lead-ya") || line.includes("\"i-det-gates\"") || line.includes(`"${PARENT}"`))) continue
    const r = JSON.parse(line); const k = `${r.set}|${r.questionKey}`
    if (!keys.has(k) || !FINAL_STATUSES.has(r.status) || r.alias !== "small") continue
    if (r.variant === "lead-ya" && !ya.has(k)) ya.set(k, r)
    else if (r.variant === "lead-yas" && !ya.has(k)) ya.set(k, r)
    else if (r.variant === PARENT && r.version === PARENT_VERSION) q1.set(k, r)
    else if (r.variant === "i-det-gates" && r.version === "2+cold") g.set(k, r)
}
const sc = (r) => { if (preGrade(r)) return 0; const v = verdicts.get(answerVerdictKey(r, pool.byKey.get(r.questionKey), judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const items = []
let mismatch = 0, ungraded = 0
for (const [k, b] of q1) {
    const a = ya.get(k); if (!a) continue
    // the parent's W0 commit check must equal lead-ya's probe for probe (lead-ya stops at the
    // first YES or after W0; a parent with no YES in W0 goes on probing its explore list)
    const yaChecks = (a.log ?? []).filter((l) => l.act === "check")
    const pChecks = (b.log ?? []).filter((l) => l.act === "check").slice(0, yaChecks.length)
    if (pChecks.length !== yaChecks.length || pChecks.some((l, i) => l.path !== yaChecks[i].path || l.yesLp !== yaChecks[i].yesLp || l.yes !== yaChecks[i].yes)) { mismatch++; continue }
    const yes1 = yaChecks.find((l) => l.yes) ?? null
    const sure = yes1 && (yes1.yesLp ?? -Infinity) >= TAU
    // lead-ya's alone read on a sure YES; a lead-ya record with a doubted YES has its read too, but it is not used
    const accepted = sure && a.step === "yes-alone"
    const acts = accepted && (MODE === "all" || b.step === "commit")
    const sa = sc(acts ? a : b), sb = sc(b), sg = g.has(k) ? sc(g.get(k)) : null
    if (sa === null || sb === null) { ungraded++; continue }
    const rec = pool.byKey.get(b.questionKey)
    const extraCalls = sure ? (MODE === "all" ? 1 : b.step === "commit" ? 1 : 0) : 0
    items.push({ set: b.set, stratum: rec.stratum, user: rec.user, a: sa, b: sb, g: sg, step: b.step, acts, yesPath: yes1?.path ?? null, gold: rec.path ?? null, wall: b.wallMs, extraCalls })
}
const wd = (list, x, y) => { let d = 0; for (const s of ["miss", "hit"]) { const xs = list.filter((i) => i.stratum === s); if (!xs.length) continue; d += (s === "miss" ? missShare : 1 - missShare) * xs.reduce((t, i) => t + i[x] - i[y], 0) / xs.length } return d }
const boot = (list, x, y) => {
    const rnd = mulberry32(20260922)
    const groups = new Map(); for (const i of list) { const k = `${i.set}|${i.stratum}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i) }
    const bs = []; for (let b = 0; b < BOOT_B; b++) { const s = []; for (const gr of groups.values()) for (let j = 0; j < gr.length; j++) s.push(gr[Math.floor(rnd() * gr.length)]); bs.push(wd(s, x, y)) }
    bs.sort((p, q) => p - q); return [pctSorted(bs, 0.025), pctSorted(bs, 0.975)]
}
const f = (x) => (100 * x).toFixed(2)
const line = (label, list, x, y) => { const [lo, hi] = boot(list, x, y); console.log(`${label}: Δ ${f(wd(list, x, y))} [${f(lo)}, ${f(hi)}]  n ${list.length}`) }
console.log(`${PARENT} + sure-YES alone (mode ${MODE}, derived) on ${SETS.join(",")}; probe mismatches skipped ${mismatch}, ungraded ${ungraded}`)
line(`derived − ${PARENT}`, items, "a", "b")
const withG = items.filter((i) => i.g !== null)
if (withG.length) { line("derived − i-det-gates", withG, "a", "g"); line(`${PARENT} − i-det-gates`, withG, "b", "g") }
for (const s of ["miss", "hit"]) { const xs = items.filter((i) => i.stratum === s); console.log(`  ${s}: n ${xs.length} acts ${xs.filter((i) => i.acts).length} flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}  acc q1 ${f(xs.reduce((t, i) => t + i.b, 0) / xs.length)} q1yas ${f(xs.reduce((t, i) => t + i.a, 0) / xs.length)}`) }
for (const set of SETS) { const xs = items.filter((i) => i.set === set); if (xs.length) console.log(`  ${set}: Δ ${f(wd(xs, "a", "b"))} flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}`) }
const steps = [...new Set(items.filter((i) => i.acts).map((i) => i.step))]
for (const st of steps) { const xs = items.filter((i) => i.acts && i.step === st); console.log(`  acts on q1 step ${st}: n ${xs.length} flips +${xs.filter((i) => i.a > i.b).length}/−${xs.filter((i) => i.a < i.b).length}`) }
console.log(`  extra model calls per question (live, upper bound): ${(items.reduce((t, i) => t + i.extraCalls, 0) / items.length).toFixed(2)}`)
