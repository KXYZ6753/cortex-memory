// v6 (aux): does an extractive QA encoder have a selection signal among e2b's own candidates?
//   node v6-eval.js pairs <A|B> [evidence: ctx|yes]     pairwise accuracy on (right, wrong) pairs
//   node v6-eval.js policy A                            gates + T2 alternative, switch on encoder margin
//   node v6-eval.js policy B <parent>                   det parent + its commit answer (and others)
// Evidence is always deployable: the emails the candidates were read from (pool A: gates' 5-email
// context; pool B: the union of the det runs' contexts, or the commit-check YES email). Never gold.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OUT, bootPairwise, bootDelta, fmt } from "./v6-lib.js"
import { features, emails } from "./v6-feat.js"

const [mode = "pairs", poolName = "A", arg3, arg4] = process.argv.slice(2)
const pools = JSON.parse(readFileSync(join(OUT, "v6-pools.json"), "utf8"))
const MISS_SHARE = 0.068

const SCORES = ["ef", "ef5", "max", "top1", "lex", "prox", "len"]

if (mode === "pairs") {
    const evMode = arg3 ?? "ctx"
    const res = { hit: {}, miss: {} }
    const hard = {}
    let nq = { hit: 0, miss: 0 }, np = { hit: 0, miss: 0 }, skipped = 0
    for (const q of pools[poolName]) {
        const right = q.cands.filter((c) => c.correct), wrong = q.cands.filter((c) => !c.correct)
        if (!right.length || !wrong.length) continue
        const paths = evMode === "yes" ? (q.yes ? [q.yes] : null) : q.evidence
        if (!paths) { skipped++; continue }
        const texts = q.cands.map((c) => c.text)
        const f = features(q, paths, texts)
        if (!f) { skipped++; continue }
        const st = q.stratum
        nq[st]++
        const idx = new Map(texts.map((t, i) => [t, i]))
        for (const s of SCORES) {
            let w = 0, n = 0, wh = 0, nh = 0
            for (const r of right) for (const x of wrong) {
                const a = f[idx.get(r.text)][s], b = f[idx.get(x.text)][s]
                const win = a > b ? 1 : a === b ? 0.5 : 0
                w += win; n++
                const isHard = f[idx.get(r.text)].lex >= 0.8 && f[idx.get(x.text)].lex >= 0.8
                if (isHard) { wh += win; nh++ }
            }
            ;(res[st][s] ??= []).push({ wins: w, n })
            if (nh) ((hard[`${st}`] ??= {})[s] ??= []).push({ wins: wh, n: nh })
            if (s === "ef") np[st] += n
        }
    }
    console.log(`pool ${poolName}, evidence ${evMode}: mixed questions hit ${nq.hit} / miss ${nq.miss} (pairs ${np.hit} / ${np.miss}); skipped (unread or no evidence) ${skipped}`)
    console.log(`score | hits pairwise [95% CI, question-clustered] | hits hard pairs (both >= 80% grounded) | misses`)
    for (const s of SCORES) {
        const h = bootPairwise(res.hit[s] ?? []), m = bootPairwise(res.miss[s] ?? [])
        const hh = hard.hit?.[s] ? bootPairwise(hard.hit[s]) : null
        const nh = hard.hit?.[s]?.reduce((a, x) => a + x.n, 0) ?? 0
        console.log(`${s.padEnd(5)} | ${h.point.toFixed(1)} [${h.lo.toFixed(1)}, ${h.hi.toFixed(1)}] | ${hh ? `${hh.point.toFixed(1)} [${hh.lo.toFixed(1)}, ${hh.hi.toFixed(1)}] (${nh} pairs, ${hard.hit[s].length} q)` : "-"} | ${m.point.toFixed(1)} [${m.lo.toFixed(1)}, ${m.hi.toFixed(1)}]`)
    }
}

// Policy: keep the parent's answer; switch to the alternative only if score(alt) - score(parent) > m.
function simulate(rows, score, m) {
    const items = []
    let fix = { hit: 0, miss: 0 }, brk = { hit: 0, miss: 0 }, sw = 0
    for (const r of rows) {
        let d = 0
        if (r.f && r.f.alt[score] - r.f.par[score] > m) {
            sw++
            d = r.altC - r.parC
            if (d > 0) fix[r.stratum]++
            if (d < 0) brk[r.stratum]++
        }
        items.push({ stratum: r.stratum, d, user: r.user, set: r.set })
    }
    return { items, fix, brk, sw }
}

if (mode === "policy" && poolName === "A") {
    // parent = gates, alternative = the T2 prompt on the same context (gatea / gate / pb with gates' context)
    const rows = []
    let unread = 0
    for (const q of pools.A) {
        if (q.t2 === null) continue
        const parC = q.cands.find((c) => c.text === q.parent).correct
        const altC = q.cands.find((c) => c.text === q.t2).correct
        let f = null
        if (q.parent !== q.t2 && parC !== altC) {
            const ff = features(q, q.evidence, [q.parent, q.t2])
            if (!ff) unread++
            else f = { par: ff[0], alt: ff[1] }
        }
        rows.push({ set: q.set, key: q.key, stratum: q.stratum, user: q.user, parC, altC, f })
    }
    const hits = rows.filter((r) => r.stratum === "hit")
    const disc = rows.filter((r) => r.parC !== r.altC)
    console.log(`policy A: gates + T2 on the same context; questions ${rows.length} (hits ${hits.length}); verdict-discordant ${disc.length} (hits: T2 right ${disc.filter((r) => r.stratum === "hit" && r.altC).length}, gates right ${disc.filter((r) => r.stratum === "hit" && r.parC).length}); unread ${unread}`)
    console.log(`oracle (always the right one of the two): hits +${(100 * disc.filter((r) => r.stratum === "hit" && r.altC).length / hits.length).toFixed(2)} hit points`)
    for (const s of ["ef", "ef5", "max", "lex", "prox"]) {
        for (const m of s === "max" ? [0, 1, 2, 4] : s === "ef" || s === "ef5" ? [0, 0.1, 0.2, 0.3, 0.5] : [0, 0.1, 0.2, 0.3]) {
            const r = simulate(rows, s, m)
            const hitOnly = bootDelta(r.items.filter((i) => i.stratum === "hit"), MISS_SHARE, { hitOnly: true })
            const hitCl = bootDelta(r.items.filter((i) => i.stratum === "hit"), MISS_SHARE, { hitOnly: true, cluster: true })
            const w = bootDelta(r.items, MISS_SHARE)
            console.log(`${s.padEnd(5)} m ${String(m).padEnd(4)} hits ${fmt(hitOnly)} (mailbox-cluster ${hitCl.lo.toFixed(2)}, ${hitCl.hi.toFixed(2)}) | weighted ${fmt(w)} | hit +${r.fix.hit}/-${r.brk.hit} miss +${r.fix.miss}/-${r.brk.miss}`)
        }
    }
}

if (mode === "policy" && poolName === "B") {
    const parent = arg3 ?? "q-det-q1"
    const altSrc = (arg4 ?? "commit").split(",") // commit | i-det-gates | i-det-x1 | ...
    const rows = []
    let unread = 0
    for (const q of pools.B) {
        const P = q.sys[parent]
        if (!P) continue
        const parC = q.cands.find((c) => c.text === P.text)?.correct
        if (parC === undefined) continue
        const alts = []
        for (const a of altSrc) {
            const t = a === "commit" ? P.commit : q.sys[a]?.text
            if (!t || t === P.text) continue
            const c = q.cands.find((x) => x.text === t)?.correct
            if (c === undefined) continue
            alts.push({ text: t, c })
        }
        const gatesCtx = q.sys["i-det-gates"]?.ctx ?? []
        const ev = [...new Set([...P.ctx, ...P.read, ...(P.yes ? [P.yes] : []), ...(altSrc.includes("commit") || altSrc.includes("i-det-gates") ? gatesCtx : [])])]
        let f = null, best = null
        if (alts.some((a) => a.c !== parC)) {
            const ff = features(q, ev, [P.text, ...alts.map((a) => a.text)])
            if (!ff) unread++
            else f = { par: ff[0], alts: ff.slice(1) }
        }
        rows.push({ set: q.set, key: q.key, stratum: q.stratum, user: q.user, parC, alts, f, step: P.step })
    }
    const hits = rows.filter((r) => r.stratum === "hit")
    const fixable = (st) => rows.filter((r) => r.stratum === st && !r.parC && r.alts.some((a) => a.c)).length
    const breakable = (st) => rows.filter((r) => r.stratum === st && r.parC && r.alts.some((a) => !a.c)).length
    console.log(`policy B: parent ${parent}, alternatives ${altSrc.join("+")}; questions ${rows.length} (hits ${hits.length}); hits fixable ${fixable("hit")} breakable ${breakable("hit")}; misses fixable ${fixable("miss")} breakable ${breakable("miss")}; unread ${unread}`)
    for (const s of ["ef", "ef5", "max", "lex", "prox"]) {
        for (const m of s === "max" ? [0, 1, 2, 4] : s.startsWith("ef") ? [0, 0.1, 0.2, 0.3, 0.5] : [0, 0.1, 0.2, 0.3]) {
            const items = []
            const fix = { hit: 0, miss: 0 }, brk = { hit: 0, miss: 0 }
            for (const r of rows) {
                let d = 0
                if (r.f) {
                    let bi = -1, bv = -Infinity
                    r.f.alts.forEach((a, i) => { if (a[s] > bv) { bv = a[s]; bi = i } })
                    if (bi >= 0 && bv - r.f.par[s] > m) {
                        d = r.alts[bi].c - r.parC
                        if (d > 0) fix[r.stratum]++
                        if (d < 0) brk[r.stratum]++
                    }
                }
                items.push({ stratum: r.stratum, d, user: r.user })
            }
            const hitOnly = bootDelta(items.filter((i) => i.stratum === "hit"), MISS_SHARE, { hitOnly: true })
            const w = bootDelta(items, MISS_SHARE)
            console.log(`${s.padEnd(5)} m ${String(m).padEnd(4)} hits ${fmt(hitOnly)} | weighted ${fmt(w)} | hit +${fix.hit}/-${brk.hit} miss +${fix.miss}/-${brk.miss}`)
        }
    }
}
emails.close?.()
