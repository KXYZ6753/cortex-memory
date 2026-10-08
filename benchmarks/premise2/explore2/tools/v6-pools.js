// v6 (aux): build candidate pools of e2b answers with J1 verdicts and their deployable evidence.
//   Pool A ("same context"): gates' answer plus every stored one-shot reader with a different prompt
//     on exactly gates' first context (T2 = gate/gatea/pb, o4, rules variants, demos, thread labels,
//     CAD, repetition, ...). Evidence = gates' 5 context emails (what every candidate read).
//   Pool B ("det family"): det runs of gates, x1, q1, q2, lite plus the x1-family commit answer
//     (gates' prompt on W0). Evidence = union of the emails those runs read, and separately the
//     commit-check YES email.
// Writes .data/premise2/explore/v6-pools.json. Development sets only.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { openV6, norm, sameCtx, yesPath, OUT } from "./v6-lib.js"

const A_SETS = ["FULL-0", "FULL-1", "S300-1", "S300-2", "S300-3", "S100-2", "S100-7", "S100-8", "S100-9"]
const A_ALTS = ["gate", "gatea", "pb", "pbs", "gatesi", "gatesm", "gatesf", "gates6", "o1", "o2", "o4", "o5", "o7", "o9", "b-g2c", "b-g4f", "b-g4s", "c-gT", "c-gC", "u-gcad", "u-grep", "i-det-gates", "i-e-gates", "n-lp0"]
const T2 = ["gatea", "gate", "pb"] // the T2 prompt on gates' first context, in order of preference
const B_SETS = ["S300-1", "S300-2", "S300-3", "S300-4", "S300-5", "FULL-2", "FULL-3"]
const B_SYS = ["i-det-gates", "i-det-x1", "q-det-q1", "q-det-q2", "lite-det-ub"]

const env = await openV6()
const out = { A: [], B: [] }
const stats = {}
const bump = (k, by = 1) => { stats[k] = (stats[k] ?? 0) + by }

for (const set of A_SETS) {
    const keys = env.setKeys(set)
    const m = env.bySet.get(set)
    if (!m) continue
    for (const key of keys) {
        const by = m.get(key)
        const g = by?.gates
        if (!g || (g.used ?? 1) !== 1) continue
        const record = env.pool.byKey.get(key)
        const cands = new Map()
        const add = (variant, a) => {
            const t = norm(a.answer)
            const c = env.verdictOf(record, a.answer, a.status)
            if (c === null) return false
            if (!cands.has(t)) cands.set(t, { text: t, correct: c, sources: [] })
            cands.get(t).sources.push(variant)
            return true
        }
        if (!add("gates", g)) continue
        let t2 = null
        for (const v of A_ALTS) {
            const a = by[v]
            if (!a || !sameCtx(a, g)) continue
            if (add(v, a) && !t2 && T2.includes(v)) t2 = v
        }
        if (!t2) for (const v of T2) if (by[v] && sameCtx(by[v], g) && env.verdictOf(record, by[v].answer, by[v].status) !== null) { t2 = v; break }
        const list = [...cands.values()]
        bump(`A.${record.stratum}`)
        if (list.some((c) => c.correct) && list.some((c) => !c.correct)) bump(`A.mixed.${record.stratum}`)
        // gates' answer confidence: mean token logprob of the same text from an x1-family run's commit answer
        let conf = null
        for (const v of ["x1", "i-det-x1", "q-det-q1", "lite-det-ub", "q1", "k3", "y1", "t-lk"]) {
            const a = by[v]
            if (a?.firstMean != null && norm(a.gatesAnswer) === norm(g.answer)) { conf = a.firstMean; break }
        }
        out.A.push({ set, key, stratum: record.stratum, user: record.user, question: record.question, evidence: g.contextPaths, parent: norm(g.answer), t2: t2 ? norm(by[t2].answer) : null, t2From: t2, conf, cands: list })
    }
}

for (const set of B_SETS) {
    const keys = env.setKeys(set)
    const m = env.bySet.get(set)
    if (!m) continue
    for (const key of keys) {
        const by = m.get(key)
        if (!by) continue
        const record = env.pool.byKey.get(key)
        const cands = new Map()
        const sys = {}
        const add = (src, text, status = "ok") => {
            const t = norm(text)
            if (!t && status === "ok") return
            const c = env.verdictOf(record, text, status)
            if (c === null) return
            if (!cands.has(t)) cands.set(t, { text: t, correct: c, sources: [] })
            cands.get(t).sources.push(src)
        }
        const ev = new Set()
        let yes = null
        for (const v of B_SYS) {
            const a = by[v]
            if (!a) continue
            add(v, a.answer, a.status)
            if (a.gatesAnswer) add(`${v}.commit`, a.gatesAnswer)
            for (const p of [...(a.contextPaths ?? []), ...(a.readPaths ?? [])]) ev.add(p)
            const y = yesPath(a)
            if (y) { ev.add(y); yes = yes ?? y }
            sys[v] = { text: norm(a.answer), commit: a.gatesAnswer ? norm(a.gatesAnswer) : null, step: a.step ?? null, firstMean: a.firstMean ?? null, unsure: a.unsure ?? null, yes: y, ctx: a.contextPaths ?? [], read: a.readPaths ?? [], wallMs: a.wallMs, calls: a.calls }
        }
        if (!Object.keys(sys).length) continue
        const list = [...cands.values()]
        bump(`B.${record.stratum}`)
        if (list.some((c) => c.correct) && list.some((c) => !c.correct)) bump(`B.mixed.${record.stratum}`)
        out.B.push({ set, key, stratum: record.stratum, user: record.user, question: record.question, evidence: [...ev], yes, sys, cands: list })
    }
}
writeFileSync(join(OUT, "v6-pools.json"), JSON.stringify(out))
console.log(stats)
const per = (pool, set) => pool.filter((q) => q.set === set)
for (const set of A_SETS) { const l = per(out.A, set); if (l.length) console.log(`A ${set}: ${l.length} q, hits ${l.filter((q) => q.stratum === "hit").length}, cands/q ${(l.reduce((s, q) => s + q.cands.length, 0) / l.length).toFixed(2)}, t2 ${l.filter((q) => q.t2 !== null).length}, conf ${l.filter((q) => q.conf !== null).length}`) }
for (const set of B_SETS) { const l = per(out.B, set); if (l.length) console.log(`B ${set}: ${l.length} q, hits ${l.filter((q) => q.stratum === "hit").length}, cands/q ${(l.reduce((s, q) => s + q.cands.length, 0) / l.length).toFixed(2)}, ev/q ${(l.reduce((s, q) => s + q.evidence.length, 0) / l.length).toFixed(1)}`) }
env.emails.close?.()
