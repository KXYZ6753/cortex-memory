// Worker d: the offline recall lab (pool records only; no GPU).
//   node benchmarks/premise2/explore2/tools/d-lab.js [--gold] [--sets S300-1,...] [--json out]
// AB = gold, twin or answer-bearing email (EvidenceCache), as everywhere; --gold = gold or twin only.
//
// A. Mailbox ranking, recall@1/5/10/15/30 (no exclusion), by stratum.
// B. "Where it lands in gates": AB in W0, AB in W0 ∪ W1, when the mailbox context is the
//    top 5 of method m instead of gates' header-reranked BM25 top 20 (switch rule unchanged).
// C. "Where it lands in x1": explore lists (W0 excluded) top 5/10/15 on all questions, and
//    on x1's explore-path questions (no YES in W0) with x1's own first list from its log.
import { writeFileSync } from "node:fs"
import { openLab, rrf, uniq, storedRows, DEV } from "./d-lib.js"

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt }
const goldOnly = process.argv.includes("--gold")
const sets = new Set((arg("--sets", DEV.join(","))).split(","))
const lab = await openLab()
const x1 = storedRows("x1", "1+cold")
const EXPLORE = new Set(["found", "nofound", "nopick"])
const records = lab.records.filter((r) => sets.has(lab.setOf.get(r.questionKey)))

// thread expansion: each of the list's top `m` items is followed by its unseen siblings
export const threadExpand = (lab, list, m = 5, cap = 3) => {
    const out = []
    const seen = new Set()
    list.forEach((p, i) => {
        if (!seen.has(p)) { out.push(p); seen.add(p) }
        if (i < m) for (const s of lab.siblings(p).slice(0, cap)) if (!seen.has(s) && s.startsWith(p.split("/")[0] + "/")) { out.push(s); seen.add(s) }
    })
    return out
}

export function methodLists(lab, record) {
    const f = lab.feat.get(record.questionKey)
    const g = lab.gatesOf(record)
    const ce = lab.ce[record.questionKey] ?? {}
    const byCe = (paths) => { const u = uniq(paths); return u.every((p) => ce[p] !== undefined) ? u.sort((a, b) => ce[b] - ce[a]) : null }
    const bm = g.mbox
    const hdrbm = uniq([...g.hdr, ...bm])
    const L = { bm, hdr: hdrbm, strip: f.strip, subj: f.subj, ent: f.ent }
    const dq = lab.denseList(record.questionKey, record.user, { which: "q", k: 100 })?.map((h) => h.path)
    const ds = lab.denseList(record.questionKey, record.user, { which: "s", k: 100 })?.map((h) => h.path)
    if (dq) {
        L.dq = dq
        if (ds) L.ds = ds
        L["rrf(bm,dq)"] = rrf([bm, dq])
        L["rrf10(bm,dq)"] = rrf([bm, dq], 10)
        L["rrf(hdr,dq)"] = rrf([hdrbm, dq])
        L["rrf(bm,dq,strip,subj)"] = rrf([bm, dq, f.strip, f.subj])
        if (ds) L["rrf(bm,ds)"] = rrf([bm, ds])
    }
    L["thr(bm)"] = threadExpand(lab, bm)
    L["thr(hdr)"] = threadExpand(lab, hdrbm)
    // CE lists (null when a score is missing)
    L["ce(W1+bm30)"] = byCe([...g.W1, ...bm.slice(0, 30)])                       // x1's explore order
    L["ce(bm20)"] = byCe(bm.slice(0, 20))
    L["ce(W1+bm50)"] = byCe([...g.W1, ...bm.slice(0, 50)])
    if (record.stratum === "miss" || EXPLORE.has(x1.get(record.questionKey)?.step)) L["ce(W1+bm100)"] = byCe([...g.W1, ...bm.slice(0, 100)])
    if (dq) {
        L["ce(W1+bm30+dq20)"] = byCe([...g.W1, ...bm.slice(0, 30), ...dq.slice(0, 20)])
        L["ce(W1+bm30+dq30)"] = byCe([...g.W1, ...bm.slice(0, 30), ...dq.slice(0, 30)])
        L["ce(W1+bm50+dq30)"] = byCe([...g.W1, ...bm.slice(0, 50), ...dq.slice(0, 30)])
        L["ce(W1+bm30+dq20+ds20)"] = ds ? byCe([...g.W1, ...bm.slice(0, 30), ...dq.slice(0, 20), ...ds.slice(0, 20)]) : null
    }
    L["ce(W1+bm30+thr)"] = byCe([...g.W1, ...bm.slice(0, 30), ...uniq([...bm.slice(0, 10), ...g.W0, ...g.W1].flatMap((p) => lab.siblings(p))).slice(0, 15)])
    L["ce(W1+bm30+strip20+subj20)"] = byCe([...g.W1, ...bm.slice(0, 30), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20)])
    L["ce(W1+bm30+ent10)"] = byCe([...g.W1, ...bm.slice(0, 30), ...f.ent.slice(0, 10)])
    // mailbox-only pools (W1's foreign emails dropped: on misses they never hold AB)
    const own = (ps) => ps.filter((p) => p.startsWith(`${record.user}/`))
    L["ce(own:W1+bm30)"] = byCe([...own(g.W1), ...bm.slice(0, 30)])
    L["ce(own:W1+bm50)"] = byCe([...own(g.W1), ...bm.slice(0, 50)])
    if (dq) {
        L["ce(own:W1+bm30+dq20)"] = byCe([...own(g.W1), ...bm.slice(0, 30), ...dq.slice(0, 20)])
        L["ce(own:W1+bm50+dq30)"] = byCe([...own(g.W1), ...bm.slice(0, 50), ...dq.slice(0, 30)])
        L["ce(own:W1+bm30+dq20+strip20+subj20)"] = byCe([...own(g.W1), ...bm.slice(0, 30), ...dq.slice(0, 20), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20)])
        L["ce(rrf4 top40)"] = byCe(rrf([bm, dq, f.strip, f.subj]).slice(0, 40))
    }
    L["rrf(bm,strip,subj)"] = rrf([bm, f.strip, f.subj])
    L["rrf10(bm,strip,subj)"] = rrf([bm, f.strip, f.subj], 10)
    L["rrf(hdr,strip,subj)"] = rrf([hdrbm, f.strip, f.subj])
    L["ce(own:W1+bm30+strip20+subj20)"] = byCe([...own(g.W1), ...bm.slice(0, 30), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20)])
    L["ce(own:W1+bm50+strip20+subj20)"] = byCe([...own(g.W1), ...bm.slice(0, 50), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20)])
    if (L["ce(W1+bm100)"]) {
        L["ce(own:W1+bm100)"] = byCe([...own(g.W1), ...bm.slice(0, 100)])
        if (dq) L["ce(W1+bm100+dq20)"] = byCe([...g.W1, ...bm.slice(0, 100), ...dq.slice(0, 20)])
        if (dq) L["ce(own:W1+bm100+dq20)"] = byCe([...own(g.W1), ...bm.slice(0, 100), ...dq.slice(0, 20)])
    }
    const ceX = L["ce(W1+bm30)"]
    if (ceX && dq) L["rrf(ceX,dq)"] = rrf([ceX, dq], 10)
    for (const k of Object.keys(L)) if (!L[k]) delete L[k]
    return { L, g }
}

const byCeOf = (record, paths) => { const ce = lab.ce[record.questionKey] ?? {}; const u = uniq(paths); return u.every((p) => ce[p] !== undefined) ? u.sort((a, b) => ce[b] - ce[a]) : null }
const isAB = (record) => (p) => (goldOnly ? p === record.path || (record.twins ?? []).includes(p) : lab.answerBearing(record, p))
const KS = [1, 5, 10, 15, 30]
const acc = {}
const bump = (table, group, name, hitAt) => {
    const t = (((acc[table] ??= {})[group] ??= {})[name] ??= { n: 0, at: {} })
    t.n++
    for (const [k, v] of Object.entries(hitAt)) t.at[k] = (t.at[k] ?? 0) + (typeof v === "number" ? v : v ? 1 : 0)
}
let nDense = 0
for (const record of records) {
    const ab = isAB(record)
    const { L, g } = methodLists(lab, record)
    if (L.dq) nDense++
    const s = record.stratum
    const xrow = x1.get(record.questionKey)
    const exploreQ = xrow && EXPLORE.has(xrow.step)
    // A. ranking recall (no exclusion)
    for (const [name, list] of Object.entries(L)) {
        const r = list.findIndex(ab)
        bump("A", s, name, Object.fromEntries(KS.map((k) => [k, r >= 0 && r < k])))
    }
    // B. gates contexts with the mailbox context from method m
    for (const [name, list] of Object.entries({ gates: g.mailbox, ...Object.fromEntries(Object.entries(L).map(([n, l]) => [n, l.slice(0, 5)])) })) {
        const mb = list.slice(0, 5)
        const [W0, W1] = g.switched ? [mb, g.global] : [g.global, mb]
        bump("B", s, name, { W0: W0.some(ab), W01: [...W0, ...W1].some(ab) })
        if (name !== "gates") continue
        bump("B", `${s}/${g.switched ? "switched" : "unswitched"}`, name, { W0: W0.some(ab), W01: [...W0, ...W1].some(ab) })
    }
    // E. global list alternatives (gates' W0 when not switched): AB in top 5, and whether the
    //    top-5 set differs from P-B's (= a changed prompt)
    const dg = lab.denseList(record.questionKey, record.user, { which: "q", k: 20, scope: "global" })?.map((h) => h.path)
    if (dg && !g.switched) {
        const fg = lab.feat.get(record.questionKey).glob
        const pb = fg.slice(0, 5)
        const alts = { "P-B (BM25 global)": pb, "rrf10(bmG,dG)": rrf([fg, dg], 10), "rrf60(bmG,dG)": rrf([fg, dg], 60), "bmG4+dG1": uniq([...fg.slice(0, 4), ...dg.filter((p) => !fg.slice(0, 4).includes(p))]) }
        const top4 = new Set(fg.slice(0, 4))
        if (L.dq) alts["bmG4+dM1"] = [...fg.slice(0, 4), ...L.dq.filter((p) => !top4.has(p))]
        const cm = L["ce(bm20)"] ? byCeOf(record, g.mbox.slice(0, 30)) : null
        if (cm) alts["bmG4+ceM1 (r5-like)"] = [...fg.slice(0, 4), ...cm.filter((p) => !top4.has(p))]
        if (cm && L.dq) alts["bmG3+ceM1+dM1"] = uniq([...fg.slice(0, 3), ...cm.filter((p) => !fg.slice(0, 3).includes(p)).slice(0, 1), ...L.dq.filter((p) => !fg.slice(0, 3).includes(p))])
        for (const [name, list] of Object.entries(alts)) {
            const top = list.slice(0, 5)
            bump("E", s, name, { top5: top.some(ab), changed: top.slice().sort().join() !== pb.slice().sort().join() })
        }
    }
    // C. explore lists (W0 excluded)
    const W0 = new Set(g.W0)
    const groups = [`${s}/all`]
    if (exploreQ) groups.push(`${s}/x1-explore`)
    if (xrow && !EXPLORE.has(xrow.step)) groups.push(`${s}/x1-commit`)
    const lists = Object.entries(L).filter(([n]) => n.startsWith("ce(") || n.startsWith("rrf") || n === "dq" || n === "bm" || n === "hdr" || n.startsWith("thr"))
    if (exploreQ) {
        const firstPick = (xrow.log ?? []).find((l) => l.act === "pick")
        const shown = uniq((xrow.log ?? []).flatMap((l) => (l.act === "pick" ? l.listed ?? [] : [])))
        bump("C", `${s}/x1-explore`, "x1 log: first list", { 5: (firstPick?.listed ?? []).slice(0, 5).some(ab), 10: (firstPick?.listed ?? []).slice(0, 10).some(ab), 15: (firstPick?.listed ?? []).some(ab) })
        bump("C", `${s}/x1-explore`, "x1 log: any list shown", { 5: false, 10: false, 15: shown.some(ab) })
        bump("C", `${s}/x1-explore`, "x1 log: W0", { 5: g.W0.some(ab), 10: false, 15: false })
    }
    // D. pool recall (AB anywhere in the candidate pool, W0 excluded): the upper bound of any ordering
    const f = lab.feat.get(record.questionKey)
    const bmL = g.mbox
    const dqL = L.dq ?? []
    const thrL = uniq([...bmL.slice(0, 10), ...g.W0, ...g.W1].flatMap((p) => lab.siblings(p))).slice(0, 15)
    const pools = {
        "W1+bm30 (x1)": [...g.W1, ...bmL.slice(0, 30)],
        "W1+bm50": [...g.W1, ...bmL.slice(0, 50)],
        "W1+bm100": [...g.W1, ...bmL.slice(0, 100)],
        "W1+bm200": [...g.W1, ...bmL.slice(0, 200)],
        "W1+bm30+dq10": [...g.W1, ...bmL.slice(0, 30), ...dqL.slice(0, 10)],
        "W1+bm30+dq20": [...g.W1, ...bmL.slice(0, 30), ...dqL.slice(0, 20)],
        "W1+bm30+dq30": [...g.W1, ...bmL.slice(0, 30), ...dqL.slice(0, 30)],
        "W1+bm50+dq30": [...g.W1, ...bmL.slice(0, 50), ...dqL.slice(0, 30)],
        "W1+bm30+strip20+subj20": [...g.W1, ...bmL.slice(0, 30), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20)],
        "W1+bm30+ent10": [...g.W1, ...bmL.slice(0, 30), ...f.ent.slice(0, 10)],
        "W1+bm30+thr15": [...g.W1, ...bmL.slice(0, 30), ...thrL],
        "W1+bm50+dq30+strip20+subj20+thr15": [...g.W1, ...bmL.slice(0, 50), ...dqL.slice(0, 30), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20), ...thrL],
    }
    for (const [name, pool] of Object.entries(pools)) {
        const ex = uniq(pool).filter((p) => !W0.has(p))
        for (const grp of groups) bump("D", grp, name, { in: ex.some(ab), size: ex.length })
    }
    for (const [name, list] of lists) {
        const ex = list.filter((p) => !W0.has(p))
        const hit = { 5: ex.slice(0, 5).some(ab), 10: ex.slice(0, 10).some(ab), 15: ex.slice(0, 15).some(ab) }
        for (const grp of groups) bump("C", grp, name, hit)
    }
}

const fmt = (t, keys) => keys.map((k) => String(t.at[k] ?? 0).padStart(5)).join(" ")
console.log(`recall lab: ${records.length} questions (${nDense} with dense vectors), AB = ${goldOnly ? "gold/twin" : "answer-bearing"}`)
for (const [table, keys, title] of [["A", KS, "A. mailbox ranking: AB in top 1/5/10/15/30"], ["B", ["W0", "W01"], "B. gates contexts: AB in W0 / W0∪W1 (mailbox context = top 5 of the method)"], ["C", [5, 10, 15], "C. explore list, W0 excluded: AB in top 5/10/15"], ["D", ["in", "size"], "D. candidate pool, W0 excluded: AB anywhere in the pool / total pool size"], ["E", ["top5", "changed"], "E. global list (W0 when not switched): AB in top 5 / top-5 set differs from P-B's"]]) {
    console.log(`\n${title}`)
    for (const [grp, byName] of Object.entries(acc[table] ?? {}).sort()) {
        console.log(`  [${grp}]`)
        for (const [name, t] of Object.entries(byName)) console.log(`    ${name.padEnd(28)} n=${String(t.n).padStart(4)}  ${fmt(t, keys)}`)
    }
}
const out = arg("--json", null)
if (out) writeFileSync(out, JSON.stringify(acc, null, 1))
process.exit(0)
