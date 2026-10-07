// Worker l: evaluate the verification diagnostics (l-v1 / l-v2 logs) against J1 verdicts.
// Per score key (evidence-form): within-question pairwise accuracy on (right, wrong) pairs,
// AUC (pooled, and mean within-question), calibration of P(YES), and selection by argmax
// among several candidate subsets vs x1.
//   node benchmarks/premise2/explore2/tools/l-eval.js <variant@version> <sets> [--noabs]
import { loadCandidates, norm, auc, bootstrapPairs, fmtCi } from "./l-lib.js"
import { isAbstain } from "../../prompts.js"

const [vv, setArg, ...flags] = process.argv.slice(2)
const sets = setArg.split(",")
const noAbs = flags.includes("--noabs")
const { env, Q, verdictOf } = await loadCandidates(sets)
const ms = env.missShare
// lexical baseline: share of the answer's content words (not in the question) found in the email
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.@'-]*/g) ?? []).filter((w) => w.length > 2)
const lex = (question, answer, email) => {
    const qs = new Set(words(question)), es = new Set(words(email))
    const ws = [...new Set(words(answer))].filter((w) => !qs.has(w))
    return ws.length ? Math.round(1000 * ws.filter((w) => es.has(w)).length / ws.length) / 1000 : 0
}
const rows = []
for (const q of Q.values()) {
    const a = q.by[vv]
    if (!a || a.skipped || !a.verify) continue
    const cands = a.verify.map((c) => {
        const full = [...q.cands.values()].find((x) => x.text.startsWith(c.text) && x.text.slice(0, 300) === c.text)
        const text = full?.text ?? c.text
        return { ...c, text, correct: full?.correct ?? verdictOf(q.record, c.text), abs: isAbstain(text), "B-len": { s: text.length }, "B-lexY": a.yesPath ? { s: lex(q.record.question, text, env.emails.emailOf(a.yesPath)) } : null, "B-lexG": { s: lex(q.record.question, text, env.emails.emailOf(q.record.path)) } }
    })
    rows.push({ q, a, cands: noAbs ? cands.filter((c) => !c.abs) : cands })
}
const keys = [...new Set(rows.flatMap((r) => r.cands.flatMap((c) => Object.keys(c).filter((k) => /^[GYOB]-/.test(k)))))]
console.log(`${vv} on ${sets.join(",")}: ${rows.length} scored questions (${rows.filter((r) => r.q.record.stratum === "hit").length} hits)${noAbs ? ", abstentions removed" : ""}`)
const sc = (c, k) => c[k]?.s ?? null
for (const k of keys) {
    for (const strat of ["all", "hit", "miss"]) {
        let pairs = 0, wins = 0, qAcc = [], items = [], qAuc = []
        for (const r of rows) {
            if (strat !== "all" && r.q.record.stratum !== strat) continue
            const cs = r.cands.filter((c) => sc(c, k) !== null && c.correct !== null)
            const R = cs.filter((c) => c.correct === 1), W = cs.filter((c) => c.correct === 0)
            for (const c of cs) items.push({ y: c.correct, s: sc(c, k) })
            if (!R.length || !W.length) continue
            let w = 0
            for (const x of R) for (const y of W) w += sc(x, k) > sc(y, k) ? 1 : sc(x, k) === sc(y, k) ? 0.5 : 0
            pairs += R.length * W.length; wins += w; qAcc.push(w / (R.length * W.length))
        }
        const mean = (l) => l.reduce((s, x) => s + x, 0) / l.length
        console.log(`${k.padEnd(9)} ${strat.padEnd(4)} mixed q ${String(qAcc.length).padStart(3)}  pairwise ${(100 * wins / pairs).toFixed(1)}% of ${pairs} pairs, per-question mean ${(100 * mean(qAcc)).toFixed(1)}%  AUC pooled ${auc(items).toFixed(3)}`)
    }
    // calibration (all candidates)
    const buckets = [[-Infinity, -4], [-4, -2], [-2, 0], [0, 2], [2, 4], [4, Infinity]]
    const cal = buckets.map(([lo, hi]) => {
        const xs = rows.flatMap((r) => r.cands).filter((c) => sc(c, k) !== null && c.correct !== null && sc(c, k) >= lo && sc(c, k) < hi)
        return `[${lo},${hi}) ${xs.length ? (100 * xs.filter((c) => c.correct === 1).length / xs.length).toFixed(0) : "-"}% of ${xs.length}`
    })
    console.log(`  calibration (s = lpYES - lpNO): ${cal.join(" | ")}`)
}
// selection among subsets
const SUBSETS = {
    "all candidates": () => true,
    "x1-core (x1, x1.commit, g5, gates)": (c) => c.sources.some((s) => ["x1", "x1.commit", "g5", "gates"].includes(s)),
    "x1 + x1.commit": (c) => c.sources.some((s) => ["x1", "x1.commit"].includes(s)),
    "x1 + gold-only reads (oracles, u-ocad5)": (c) => c.sources.some((s) => ["x1", "oracles", "u-ocad5"].includes(s)),
}
for (const k of keys) {
    console.log(`selection by argmax ${k}:`)
    for (const [name, f] of Object.entries(SUBSETS)) {
        const pairsD = []
        let fix = 0, brk = 0, changed = 0
        for (const r of rows) {
            const x1text = norm(r.q.by["x1@1+cold"]?.answer)
            const pool = r.cands.filter((c) => f(c) && sc(c, k) !== null)
            const x1c = r.cands.find((c) => c.text === x1text)
            if (!x1c || pool.length < 2) { pairsD.push({ stratum: r.q.record.stratum, d: 0 }); continue }
            const best = pool.reduce((b, c) => (sc(c, k) > sc(b, k) ? c : b), x1c)
            const d = (best.correct ?? 0) - (x1c.correct ?? 0)
            if (best !== x1c) changed++
            if (d > 0) fix++
            if (d < 0) brk++
            pairsD.push({ stratum: r.q.record.stratum, d })
        }
        console.log(`  ${name.padEnd(42)} changed ${changed}, fixes ${fix}, breaks ${brk}`)
    }
}
