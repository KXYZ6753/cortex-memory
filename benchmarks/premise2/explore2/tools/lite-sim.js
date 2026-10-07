// Worker lite (round 5): exact offline simulation of the lite stacks from stored det answers
// (no GPU). Behind det an identical call sequence gives byte-identical answers (i.md §7), so a
// lite variant's answer on a question equals a stored det answer whenever its prompts equal
// that parent's prompts on that question:
//   - sure commit, no m2 recovery            -> q-det-q1's answer (= det x1 = det t-lk)
//   - m2 recovery accepted E (within recN)   -> q-det-q1's recover answer (same probes, same E prompt)
//   - no E / m2 not fired / q1 handed to g5   -> A = gates' prompt over W0 = det t-lk's commit answer
//                                               (lite-b: q1's seeded g5 kept where q1's m2 probed first)
//   - explore, q1 found at open 1, nofound with the first pick, nopick -> q-det-q1's answer
//     (lean explore issues the same pick/probe/final prompts; d6 list in both)
//   - explore, q1 found at open 2-3: lean explore ends "nofound" with the first pick: det t-lk's
//     answer if its first pick is the same email, else unknown (counted, left out).
// Recovery with recN < 6 is exact too: q1 logs every recovery probe in order (accept rule
// unchanged: first YES with yesLp >= yes1's).
// Cost (estimate): per question, parent-record wall and genMs; lite drops det x1's g5 part
// (x1 − t-lk on the same question) and (6 − recN) probes on a no-E firing (~129 ms each incl.
// reset); lean explore = det t-lk's explore + q1's d6 extra ms.
//   node benchmarks/premise2/explore2/tools/lite-sim.js [S300-1] [--paths]
import { openAll, weightedOf } from "./a-lib.js"
import { pairedBootstrap } from "../../explore/analyze.js"

const set = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "S300-1"
const { graded, missShare } = await openAll()
const byKey = (v) => new Map(graded(v, set).filter((i) => i.correct !== null).map((i) => [i.record.questionKey, i]))
const X = byKey("i-det-x1@2+cold"), T = byKey("i-det-tlk@2+cold"), Q = byKey("q-det-q1@1+cold"), G = byKey("i-det-gates@2+cold")
const isExplore = (s) => ["found", "nofound", "nopick"].includes(s)
const firstPick = (a) => (a.log ?? []).find((l) => l.act === "pick") ?? null
const PROBE_MS = 129
// two-term GPU power model fitted on worker i's measured det/plain runs (tools/lite-power.js)
const GEN_W = 0.1109, REST_W = 0.0335

// opt: m2 "all" (doubted yes1) | "unsure" (doubted yes1 and A unsure) | "none"; recN; keepDoubtedG5; fullExplore
function simulate(q, t, x, { m2 = "all", recN = 6, keepDoubtedG5 = false, fullExplore = false } = {}) {
    const qa = q.answer, s = qa.step
    if (s === "commit" || s.startsWith("recover") || s === "commit-g5") {
        const unsure = Boolean(qa.unsure)
        const fired = Boolean(qa.q?.m2Fired)
        const rec = (qa.log ?? []).filter((l) => l.act === "rec")
        const ePos = qa.q?.recovered ? rec.findIndex((l) => l.path === qa.q.recovered) + 1 : 0
        const fires = fired && (m2 === "all" || (m2 === "unsure" && unsure))
        const gotE = fires && ePos > 0 && ePos <= recN
        if (t.answer.gatesAnswer !== qa.gatesAnswer) return { src: null, path: "A mismatch" }
        const g5Wall = s === "commit-g5" ? Math.max(0, x.answer.wallMs - t.answer.wallMs) : 0
        const g5Gen = s === "commit-g5" ? Math.max(0, x.answer.genMs - t.answer.genMs) : 0
        const m2Wall = fired ? qa.wallMs - t.answer.wallMs - g5Wall : 0
        const m2Gen = fired ? qa.genMs - t.answer.genMs - g5Gen : 0
        const tag = `${unsure ? "unsure" : "sure"} commit`
        if (gotE) return { src: q, path: `${tag}, m2 E`, wall: qa.wallMs - g5Wall, gen: qa.genMs - g5Gen }
        const saved = fires ? (6 - Math.min(recN, 6)) * PROBE_MS : 0
        const lost = fired && ePos > recN && fires ? " (E beyond recN)" : ""
        const m2w = fires ? m2Wall - saved : 0, m2g = fires ? m2Gen - saved : 0
        if (keepDoubtedG5 && unsure && fires && s === "commit-g5") return { src: q, path: `${tag}, m2 no E -> seeded g5`, wall: qa.wallMs - saved, gen: qa.genMs - saved }
        if (keepDoubtedG5 && unsure && fires && s.startsWith("recover")) return { src: null, path: "E beyond recN, g5 unknown" }
        return { src: t, path: `${tag}${fires ? ", m2 no E" : fired ? ", m2 skipped" : ""} -> A${lost}`, wall: t.answer.wallMs + m2w, gen: t.answer.genMs + m2g }
    }
    if (isExplore(s)) {
        if (fullExplore) return { src: q, path: `explore ${s}`, wall: qa.wallMs, gen: qa.genMs }
        const p = firstPick(qa)
        const opened = qa.openedPaths ?? []
        const lean = { wall: t.answer.wallMs + (qa.dExtraMs ?? 0), gen: t.answer.genMs }
        if (s === "nopick" && (!p || !p.path)) return { src: q, path: "explore nopick", ...lean }
        if (p && p.path && opened[0] === p.path) {
            if (s === "found" && qa.foundPath === p.path) return { src: q, path: "explore found@1", ...lean }
            if (s === "nofound") return { src: q, path: "explore nofound", ...lean }
            const tp = firstPick(t.answer)
            if (t.answer.step === "nofound" && tp?.path === p.path) return { src: t, path: "explore q1 found@2-3 -> nofound (= det t-lk)", ...lean }
            return { src: null, path: "explore q1 found@2-3 -> nofound (unknown)" }
        }
        return { src: null, path: "explore first pick unparsed (unknown)" }
    }
    return { src: null, path: `other ${s}` }
}

const designs = {
    "lite-a: t-lk + d6 + m2 (doubted yes1), recN 6; no g5": { m2: "all" },
    "lite-a3: as lite-a, recN 3": { m2: "all", recN: 3 },
    "lite-u: t-lk + d6 + m2 only on doubted AND unsure commits, recN 6; no g5": { m2: "unsure" },
    "lite-u3: as lite-u, recN 3": { m2: "unsure", recN: 3 },
    "lite-b: lite-a + seeded g5 on doubted unsure commits without E": { m2: "all", keepDoubtedG5: true },
    "lite-ub: lite-u + seeded g5 on doubted unsure commits without E": { m2: "unsure", keepDoubtedG5: true },
    "t-lk + d6 only (no m2, no g5)": { m2: "none" },
}
const pct = (x) => (100 * x).toFixed(1)
const sg = (x, d = 2) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}`
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const verbose = process.argv.includes("--paths")
const summary = []
for (const [name, opt] of Object.entries(designs)) {
    const rows = []
    const paths = {}
    let unknown = 0
    for (const [key, q] of Q) {
        const t = T.get(key), x = X.get(key), g = G.get(key)
        if (!t || !x || !g) continue
        const r = simulate(q, t, x, opt)
        const p = (paths[`${q.record.stratum} | ${r.path}`] ??= { n: 0, vsX: [0, 0], vsT: [0, 0], vsQ: [0, 0], wall: [] })
        p.n++
        if (!r.src) { unknown++; continue }
        const c = r.src.correct
        p.vsX[0] += c > x.correct; p.vsX[1] += c < x.correct
        p.vsT[0] += c > t.correct; p.vsT[1] += c < t.correct
        p.vsQ[0] += c > q.correct; p.vsQ[1] += c < q.correct
        p.wall.push(r.wall)
        rows.push({ record: q.record, c, x: x.correct, t: t.correct, q: q.correct, g: g.correct, wall: r.wall, gen: r.gen })
    }
    const w = weightedOf(rows.map((r) => ({ record: r.record, correct: r.c })), missShare)
    const pair = (ref) => pairedBootstrap(rows.map((r) => ({ user: r.record.user, stratum: r.record.stratum, a: r.c, b: r[ref] })), missShare)
    const line = [`${name}`, `n ${rows.length} (unknown ${unknown})`, `W ${pct(w.weighted)} (miss ${pct(w.miss)}, hit ${pct(w.hit)})`]
    for (const [ref, label] of [["x", "x1"], ["q", "q1"], ["t", "t-lk"], ["g", "gates"]]) { const b = pair(ref); line.push(`vs det ${label} ${sg(b.weighted)} [${sg(b.low, 1)}, ${sg(b.high, 1)}]`) }
    line.push(`wall ${Math.round(mean(rows.map((r) => r.wall)))} gen ${Math.round(mean(rows.map((r) => r.gen)))}`)
    const dw = (f) => missShare * mean(rows.filter((r) => r.record.stratum === "miss").map(f)) + (1 - missShare) * mean(rows.filter((r) => r.record.stratum === "hit").map(f))
    const J = dw((r) => GEN_W * r.gen + REST_W * (r.wall - r.gen))
    line.push(`design-weighted wall ${Math.round(dw((r) => r.wall))}, model GPU ${J.toFixed(0)} J/q, ${(J / w.weighted).toFixed(0)} J per correct`)
    summary.push(line)
    if (verbose) {
        console.log(`\n## ${name}\n${line.slice(1).join("; ")}`)
        console.log(`| stratum | path | n | vs det x1 +/− | vs det t-lk +/− | vs det q1 +/− | wall est. |`)
        for (const [k, p] of Object.entries(paths).sort()) console.log(`| ${k} | ${p.n} | +${p.vsX[0]}/−${p.vsX[1]} | +${p.vsT[0]}/−${p.vsT[1]} | +${p.vsQ[0]}/−${p.vsQ[1]} | ${p.wall.length ? Math.round(mean(p.wall)) : "–"} |`)
    }
}
// --check: compare a real det run with the replay's predicted answer, question by question
const CHECK = { "lite-det-a": "lite-a: t-lk + d6 + m2 (doubted yes1), recN 6; no g5", "lite-det-u": "lite-u: t-lk + d6 + m2 only on doubted AND unsure commits, recN 6; no g5", "lite-det-ub": "lite-ub: lite-u + seeded g5 on doubted unsure commits without E" }
for (const vid of Object.keys(CHECK).filter((v) => process.argv.includes(`--check=${v}`))) {
    const R = new Map(graded(`${vid}@1+cold`, set).map((i) => [i.record.questionKey, i]))
    const tally = {}
    const walls = []
    for (const [key, q] of Q) {
        const real = R.get(key), t = T.get(key), x = X.get(key)
        if (!real || !t || !x) continue
        const r = simulate(q, t, x, designs[CHECK[vid]])
        const k = r.src ? (real.answer.answer === r.src.answer.answer ? "same text" : "DIFFERENT text") : "unknown (no stored prediction)"
        const e = (tally[`${r.path} | ${k}`] ??= { n: 0, verdictDiff: 0, keys: [] })
        e.n++
        if (r.src && real.correct !== r.src.correct) e.verdictDiff++
        if (k === "DIFFERENT text") e.keys.push(key)
        if (Number.isFinite(r.wall)) walls.push([real.answer.wallMs, r.wall])
    }
    console.log(`\n## ${vid}: real run vs replay prediction (${set}, ${R.size} answers)`)
    for (const [k, e] of Object.entries(tally).sort()) console.log(`  ${k}: ${e.n}${e.verdictDiff ? ` (verdicts differ ${e.verdictDiff})` : ""}${e.keys.length ? ` ${e.keys.slice(0, 4).join(", ")}` : ""}`)
    console.log(`  wall real ${Math.round(mean(walls.map((w) => w[0])))} ms vs estimated ${Math.round(mean(walls.map((w) => w[1])))} ms (n ${walls.length})`)
}
const all = [...Q.keys()].filter((k) => T.get(k) && X.get(k) && G.get(k))
const dwM = (M, f) => missShare * mean(all.filter((k) => M.get(k).record.stratum === "miss").map((k) => f(M.get(k).answer))) + (1 - missShare) * mean(all.filter((k) => M.get(k).record.stratum === "hit").map((k) => f(M.get(k).answer)))
const accM = (M) => dwM(M, () => 0) + missShare * mean(all.filter((k) => M.get(k).record.stratum === "miss").map((k) => M.get(k).correct)) + (1 - missShare) * mean(all.filter((k) => M.get(k).record.stratum === "hit").map((k) => M.get(k).correct))
const ref = (M) => { const J = dwM(M, (a) => GEN_W * a.genMs + REST_W * (a.wallMs - a.genMs)); return `${Math.round(mean(all.map((k) => M.get(k).answer.wallMs)))} / ${Math.round(mean(all.map((k) => M.get(k).answer.genMs)))} (dw wall ${Math.round(dwM(M, (a) => a.wallMs))}, model ${J.toFixed(0)} J/q, ${(J / accM(M)).toFixed(0)} J/correct)` }
console.log(`\n${set}: parents (wall / gen ms): det x1 ${ref(X)}, det q1 ${ref(Q)}, det t-lk ${ref(T)}, det gates ${ref(G)}`)
for (const l of summary) console.log(`- ${l.join("; ")}`)
process.exit(0)
