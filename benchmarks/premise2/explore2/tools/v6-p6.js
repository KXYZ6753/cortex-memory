// v6 (aux): the pre-registered det test (v6.md §3). Parent i-det-gates, alternative p6-e4 (gates behind
// det with o4-layout answer prompts), both det, so p6-e4's text is what a live v6-go4 generates.
// Rule R1: p6-e4's text if ef(p6-e4) - ef(i-det-gates) > 0 on the union of both runs' read emails.
//   node v6-p6.js read <sets>     QA reads for every question whose two texts differ (CPU)
//   node v6-p6.js eval <sets>     R1, always-o4, margins (exploratory), lexical baselines; flips
// Pre-registered sets: S300-4,S300-5,FULL-2,FULL-3 (S300-1 reported separately).
import { join } from "node:path"
import { openV6, norm, readCache, appendCache, bootDelta, fmt, OUT } from "./v6-lib.js"
import { createHash } from "node:crypto"
import { loadQA, loadNLI, QA_MODEL, qaScores, lexGround, lexProx, words, content } from "../variants/v6-common.js"

const [cmd = "eval", setsArg = "S300-4,S300-5,FULL-2,FULL-3", altId = "p6-e4", parId = "i-det-gates"] = process.argv.slice(2)
const sets = setsArg.split(",")
const env = await openV6()
const cacheFile = join(OUT, "v6-qa.jsonl")
const cache = readCache(cacheFile)
const nliFile = join(OUT, "v6-nli.jsonl")
const nliCache = readCache(nliFile)
const hh = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16)
const nliKey = (r, text) => `${r.key}|${hh(r.paths.join(","))}|${hh(text)}`
// R2 (pre-registered, v6.md section 4): ef margin / 0.35 + NLI(q+a) margin / 1.71 > 1.0
const R2 = (r) => r.f && r.n && (r.f.a.ef - r.f.p.ef) / 0.35 + (r.n.a - r.n.p) / 1.71 > 1.0
const rows = []
const missing = { par: 0, alt: 0, verdict: 0 }
for (const set of sets) {
    const m = env.bySet.get(set)
    for (const key of env.setKeys(set)) {
        const by = m?.get(key)
        const P = by?.[parId], A = by?.[altId]
        if (!P) { missing.par++; continue }
        if (!A) { missing.alt++; continue }
        const rec = env.pool.byKey.get(key)
        const pc = env.verdictOf(rec, P.answer, P.status), ac = env.verdictOf(rec, A.answer, A.status)
        const pt = norm(P.answer), at = norm(A.answer)
        const paths = [...new Set([...(P.readPaths ?? P.contextPaths ?? []), ...(A.readPaths ?? A.contextPaths ?? [])])]
        if (pc === null || (ac === null && pt !== at)) { missing.verdict++; continue }
        rows.push({ set, key, stratum: rec.stratum, user: rec.user, question: rec.question, pt, at, pc, ac: pt === at ? pc : ac, paths, differ: pt !== at && P.status === "ok" && A.status === "ok" && at !== "" })
    }
}
console.log(`${parId} vs ${altId} on ${sets.join(",")}: ${rows.length} questions (hits ${rows.filter((r) => r.stratum === "hit").length}), texts differ ${rows.filter((r) => r.differ).length}; missing parent ${missing.par}, alt ${missing.alt}, verdict ${missing.verdict}`)

if (cmd === "read") {
    const qa = await loadQA({ threads: Number(process.env.V6_THREADS ?? 6) })
    let n = 0, reads = 0
    const t0 = performance.now()
    for (const r of rows.filter((x) => x.differ)) {
        for (const path of r.paths) {
            const k = `${r.key}|${path}`
            if (cache.has(k)) continue
            const t = performance.now()
            const res = await qa.read(r.question, [env.emails.emailOf(path) ?? ""])
            const rec = { k, model: QA_MODEL, ms: Math.round(performance.now() - t), windows: res.windows, null: Math.max(...res.nulls), spans: res.spans.slice(0, 40).map((s) => [s.text, Math.round(s.score * 1000) / 1000]) }
            appendCache(cacheFile, rec)
            cache.set(k, rec)
            reads++
        }
        if (++n % 50 === 0) console.log(`${n} questions, ${reads} reads, ${((performance.now() - t0) / 1000).toFixed(0)} s`)
    }
    console.log(`done: ${n} questions, ${reads} new reads`)
}

if (cmd === "nli") {
    // NLI only where it can matter: texts differ and verdicts differ
    const nli = await loadNLI({ threads: Number(process.env.V6_THREADS ?? 6) })
    let n = 0
    for (const r of rows.filter((x) => x.differ && x.pc !== x.ac)) {
        const chunks = nli.chunks(r.paths.map((p) => env.emails.emailOf(p) ?? ""))
        const cw = chunks.map((c) => new Set(words(c)))
        for (const text of [r.pt, r.at]) {
            const k = nliKey(r, text)
            if (nliCache.has(k)) continue
            const target = [...new Set([...content(r.question), ...content(text)])]
            const ranked = chunks.map((ch, i) => ({ ch, s: target.filter((w) => cw[i].has(w)).length })).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.ch)
            const [ra, rqa] = [await nli.score(ranked, [text]), await nli.score(ranked, [`${r.question} ${text}`])]
            const rec = { k, a: ra[0].margin, aE: ra[0].logpE, qa: rqa[0].margin, qaE: rqa[0].logpE }
            appendCache(nliFile, rec)
            nliCache.set(k, rec)
        }
        if (++n % 20 === 0) console.log(`nli ${n} questions`)
    }
    console.log(`nli done: ${n} discordant questions`)
}

if (cmd === "eval") {
    const feat = (r, text) => {
        const spans = []
        for (const p of r.paths) {
            const c = cache.get(`${r.key}|${p}`)
            if (!c) return null
            for (const [t, s] of c.spans) spans.push({ text: t, score: s })
        }
        spans.sort((a, b) => b.score - a.score)
        const evTexts = r.paths.map((p) => env.emails.emailOf(p) ?? "")
        const q = qaScores({ spans }, [text])[0]
        return { ef: q.ef, max: q.max, top1: q.top1, lex: lexGround(r.question, text, evTexts.join("\n")), prox: lexProx(r.question, text, evTexts) }
    }
    let unread = 0
    for (const r of rows) {
        if (!r.differ) continue
        const a = feat(r, r.at), p = feat(r, r.pt)
        if (!a || !p) { unread++; continue }
        r.f = { a, p }
        const na = nliCache.get(nliKey(r, r.at)), np = nliCache.get(nliKey(r, r.pt))
        if (na && np) r.n = { a: na.qa, p: np.qa }
    }
    const needN = rows.filter((r) => r.differ && r.pc !== r.ac && r.f && !r.n).length
    if (needN) console.log(`WARNING: ${needN} discordant questions without NLI scores (run "nli")`)
    if (unread) console.log(`WARNING: ${unread} differing questions not read yet (run "read" first)`)
    const policy = (choose) => {
        const items = [], fl = { hit: [0, 0], miss: [0, 0] }
        let sw = 0
        for (const r of rows) {
            const take = r.differ && r.f && choose(r)
            if (take) sw++
            const d = take ? r.ac - r.pc : 0
            if (d > 0) fl[r.stratum][0]++
            if (d < 0) fl[r.stratum][1]++
            items.push({ stratum: r.stratum, user: r.user, d })
        }
        return { items, fl, sw }
    }
    const show = (label, choose) => {
        const { items, fl, sw } = policy(choose)
        const h = items.filter((i) => i.stratum === "hit")
        const hasMiss = items.some((i) => i.stratum === "miss")
        console.log(`${label.padEnd(30)} switches ${String(sw).padStart(4)} | hits ${fmt(bootDelta(h, 0.068, { hitOnly: true }))} cluster ${fmt(bootDelta(h, 0.068, { hitOnly: true, cluster: true }))} | hit +${fl.hit[0]}/-${fl.hit[1]}${hasMiss ? ` | weighted ${fmt(bootDelta(items, 0.068))} miss +${fl.miss[0]}/-${fl.miss[1]}` : ""}`)
        return items
    }
    const hits = rows.filter((r) => r.stratum === "hit")
    const disc = hits.filter((r) => r.pc !== r.ac)
    console.log(`hits: parent ${(100 * hits.reduce((s, r) => s + r.pc, 0) / hits.length).toFixed(2)}, ${altId} ${(100 * hits.reduce((s, r) => s + r.ac, 0) / hits.length).toFixed(2)}; discordant ${disc.length} (alt right ${disc.filter((r) => r.ac).length}); oracle +${(100 * disc.filter((r) => r.ac).length / hits.length).toFixed(2)}`)
    {
        // discrimination on discordant hits: AUC of the alt-minus-parent margin for "alt is right"
        const dd = disc.filter((r) => r.f)
        const auc = (fn) => { const P = dd.filter((r) => r.ac).map(fn), N = dd.filter((r) => !r.ac).map(fn); let w = 0; for (const x of P) for (const y of N) w += x > y ? 1 : x === y ? 0.5 : 0; return (w / (P.length * N.length)).toFixed(3) }
        const dec = dd.filter((r) => Math.abs(r.f.a.ef - r.f.p.ef) > 0.1)
        const decRight = dec.filter((r) => (r.f.a.ef > r.f.p.ef) === (r.ac === 1)).length
        const withN = dd.filter((r) => r.n)
        console.log(`discordant hits scored ${dd.length}: AUC ef ${auc((r) => r.f.a.ef - r.f.p.ef)}, prox ${auc((r) => r.f.a.prox - r.f.p.prox)}, lex ${auc((r) => r.f.a.lex - r.f.p.lex)}${withN.length === dd.length ? `, nli ${auc((r) => r.n.a - r.n.p)}, ef+nli ${auc((r) => (r.f.a.ef - r.f.p.ef) / 0.35 + (r.n.a - r.n.p) / 1.71)}` : ""}; decisive (|ef margin| > 0.1) ${dec.length}, right ${decRight}`)
    }
    console.log("-- vs parent (Δ = policy - parent) --")
    show("always alt (= p6-e4 alone)", () => true)
    show("R1: ef > 0 (pre-registered)", (r) => r.f.a.ef - r.f.p.ef > 0)
    for (const m of [0.05, 0.1, 0.2, 0.3]) show(`ef > ${m} (exploratory)`, (r) => r.f.a.ef - r.f.p.ef > m)
    for (const m of [0, 1, 2]) show(`max > ${m} (exploratory)`, (r) => r.f.a.max - r.f.p.max > m)
    show("R2: QA+NLI > 1 sd (pre-reg. 2nd)", R2)
    show("lex > 0 (baseline)", (r) => r.f.a.lex - r.f.p.lex > 0)
    show("prox > 0 (baseline)", (r) => r.f.a.prox - r.f.p.prox > 0)
    // R1 vs the alternative alone: d = R1 choice - alt
    const items = [], fl = { hit: [0, 0], miss: [0, 0] }
    for (const r of rows) {
        const takeAlt = r.differ && r.f ? r.f.a.ef - r.f.p.ef > 0 : true
        const d = (takeAlt ? r.ac : r.pc) - r.ac
        if (d > 0) fl[r.stratum][0]++
        if (d < 0) fl[r.stratum][1]++
        items.push({ stratum: r.stratum, user: r.user, d })
    }
    const h = items.filter((i) => i.stratum === "hit")
    console.log(`-- R1 vs ${altId} alone: hits ${fmt(bootDelta(h, 0.068, { hitOnly: true }))} cluster ${fmt(bootDelta(h, 0.068, { hitOnly: true, cluster: true }))} | hit +${fl.hit[0]}/-${fl.hit[1]}`)
    for (const s of sets) {
        const rs = rows.filter((r) => r.set === s && r.stratum === "hit")
        let fx = 0, br = 0
        for (const r of rs) if (r.differ && r.f && r.f.a.ef - r.f.p.ef > 0) { if (r.ac > r.pc) fx++; if (r.ac < r.pc) br++ }
        console.log(`   ${s}: hits ${rs.length}, R1 hit flips +${fx}/-${br}`)
    }
}
env.emails.close?.()
