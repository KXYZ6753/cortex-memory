// Offline recall table for candidate retrieval pipelines (no GPU). Reads
// <SCRATCH>/r-features.json (+ r-ce.json cross-encoder scores). For each pipeline:
// answer-bearing (AB) recall@1/@3/@5 of the context e2b reads first, union recall of
// both contexts, the gate's switch rate / precision / recall (target: global top 5
// has no AB email), weighted by the pool's miss share.
//   node benchmarks/premise2/explore2/tools/r-recall.js [set-filter]

import { join } from "node:path"
import { rrf } from "../../retrieve.js"
import { SCRATCH, readJsonIf } from "./r-common.js"

const MISS_SHARE = 0.06800407113777587
const features = readJsonIf(join(SCRATCH, `r-features${process.env.R_TAG ?? ""}.json`), [])
const ce = readJsonIf(join(SCRATCH, `r-ce${process.env.R_TAG ?? ""}.json`), {})
const filter = process.argv[2]
const items = features.filter((f) => ce[f.key] && (!filter || f.set === filter))

const own = (f, path) => path.startsWith(`${f.user}/`)
export const dedup = (f, paths, k) => {
    const seen = new Set()
    const out = []
    for (const path of paths) {
        const key = f.info[path]?.bk
        if (key && seen.has(key)) continue
        seen.add(key)
        out.push(path)
        if (out.length === k) break
    }
    return out
}
const headerList = (f, ranked) => ranked.map((path, index) => ({ path, index, h: f.info[path]?.h ?? 0 })).sort((a, b) => b.h - a.h || a.index - b.index)
const headerRank = (f, ranked, k = 5) => rrf([ranked.map((path) => ({ path })), headerList(f, ranked)], 10, k).map((hit) => hit.path)
const ceOf = (f, path) => ce[f.key].s[path] ?? -99
const byCe = (f, paths) => [...paths].sort((a, b) => ceOf(f, b) - ceOf(f, a))
const G = (f, k = 5) => f.global.slice(0, k).map((x) => x[0])
const M = (f, k = 30) => f.mailbox.slice(0, k).map((x) => x[0])
// RRF of BM25 rank, header rank and CE rank (weight wCe) over a candidate list.
const fused = (f, ranked, { kRrf = 10, wCe = 1, header = true } = {}) => {
    const lists = [ranked.map((path) => ({ path }))]
    if (header) lists.push(headerList(f, ranked))
    const ceList = byCe(f, ranked).map((path) => ({ path }))
    for (let i = 0; i < wCe; i++) lists.push(ceList)
    return rrf(lists, kRrf, ranked.length).map((hit) => hit.path)
}
const gate0 = (f) => !own(f, f.global[0]?.[0] ?? "")
const gated = (f, mb, g = G(f)) => {
    const s = gate0(f)
    return { first: s ? mb : g, second: s ? g : mb, switched: s }
}
const ceorder = (r, f) => ({ ...r, first: byCe(f, r.first), second: byCe(f, r.second) })

const P = {
    pb: (f) => ({ first: G(f), second: [] }),
    gates: (f) => gated(f, headerRank(f, M(f, 20))),
    "gates+ceorder": (f) => ceorder(P.gates(f), f),
    "gates.mbCE20": (f) => gated(f, byCe(f, M(f, 20)).slice(0, 5)),
    "gates.mbCE30": (f) => gated(f, byCe(f, M(f, 30)).slice(0, 5)),
    "gates.mbCE30+ceorder": (f) => ceorder(P["gates.mbCE30"](f), f),
    "gates.mbFuse20": (f) => gated(f, fused(f, M(f, 20)).slice(0, 5)),
    "gates.mbFuse30": (f) => gated(f, fused(f, M(f, 30)).slice(0, 5)),
    "gates.mbFuse30nohdr": (f) => gated(f, fused(f, M(f, 30), { header: false }).slice(0, 5)),
    "gates.mbFuse30ce2": (f) => gated(f, fused(f, M(f, 30), { wCe: 2 }).slice(0, 5)),
    "gates.mbFuse30ce2+ceorder": (f) => ceorder(P["gates.mbFuse30ce2"](f), f),
    "gates.mbFuse30+dedup": (f) => gated(f, dedup(f, fused(f, M(f, 30)), 5), dedup(f, f.global.map((x) => x[0]), 5)),
    "gates.mbFuse30ce2+dedup": (f) => gated(f, dedup(f, fused(f, M(f, 30), { wCe: 2 }), 5), dedup(f, f.global.map((x) => x[0]), 5)),
    // Single CE-ranked list over the union (no gate).
    ceUnion: (f) => {
        const ranked = byCe(f, [...new Set([...M(f, 30), ...G(f, 10)])])
        return { first: ranked.slice(0, 5), second: ranked.slice(5, 10), switched: !own(f, ranked[0]) }
    },
    // gate also switches when the mailbox context's best CE beats the global's best by a margin.
    ceGate2: (f) => {
        const mb = fused(f, M(f, 30), { wCe: 2 }).slice(0, 5)
        const gMax = Math.max(...G(f).map((p) => ceOf(f, p)))
        const mMax = Math.max(...mb.map((p) => ceOf(f, p)))
        const s = gate0(f) || mMax > gMax + 2
        return { first: s ? mb : G(f), second: s ? G(f) : mb, switched: s }
    },
    // Not switched: put the best mailbox-CE email first in the global context when it beats the global's best.
    "gates.mbFuse30ce2.swap": (f) => {
        const r = P["gates.mbFuse30ce2"](f)
        if (r.switched) return r
        const best = byCe(f, M(f, 30)).find((p) => !r.first.includes(p))
        const gBest = Math.max(...r.first.map((p) => ceOf(f, p)))
        if (best && ceOf(f, best) > gBest) return { ...r, first: [best, ...r.first.slice(0, 4)] }
        return r
    },
    ...Object.fromEntries([0, 1, 2, 3].flatMap((m) => ["first", "last"].map((where) => [`swap${where}.m${m}`, (f) => swapPipe(f, { where, margin: m })]))),
    ...Object.fromEntries([0, 1, 2].map((m) => [`mbCE.swaplast.m${m}`, (f) => swapPipe(f, { where: "last", margin: m, mb: (f) => byCe(f, M(f, 30)).slice(0, 5) })])),
    // r1 + the retry context shows only unseen emails (CE order over mailbox 30 ∪ global 10).
    "r1.freshRetry": (f) => {
        const r = swapPipe(f, { where: "last", margin: 0, mb: (f) => byCe(f, M(f, 30)).slice(0, 5) })
        const pool = r.switched ? [...G(f, 10), ...byCe(f, M(f, 30))] : byCe(f, M(f, 30))
        return { ...r, second: [...new Set(pool)].filter((p) => !r.first.includes(p)).slice(0, 5) }
    },
    // Non-switched: the n best unseen mailbox-CE emails replace the last n global slots
    // when each outscores the global email it replaces' context max minus `slack` (or always).
    ...Object.fromEntries([[1, -1], [2, 0], [2, -1], [2, -99], [1, -99], [3, 0]].map(([n, slack]) => [`swap${n}.s${slack}`, (f) => {
        const r = gated(f, byCe(f, M(f, 30)).slice(0, 5))
        if (r.switched) return r
        const gBest = Math.max(...r.first.map((p) => ceOf(f, p)))
        const extra = byCe(f, M(f, 30)).filter((p) => !r.first.includes(p) && ceOf(f, p) > gBest + slack).slice(0, n)
        return { ...r, first: [...r.first.slice(0, 5 - extra.length), ...extra] }
    }])),
    // gates' own contexts (header-reranked mailbox top 20) + the CE swap into the last
    // n global slots (S300-2: the CE mailbox context was a wash, the swap a clean win).
    ...Object.fromEntries([[1, 0], [1, -1], [1, -99], [2, -1], [2, -99]].map(([n, slack]) => [`gswap${n}.s${slack}`, (f) => {
        const r = P.gates(f)
        if (r.switched) return r
        const gBest = Math.max(...r.first.map((p) => ceOf(f, p)))
        const extra = byCe(f, M(f, 30)).filter((p) => !r.first.includes(p) && ceOf(f, p) > gBest + slack).slice(0, n)
        return { ...r, first: [...r.first.slice(0, 5 - extra.length), ...extra] }
    }])),
    // r5 + the same swap inside the mailbox context when switched (slot 5 = best unseen CE email).
    ...Object.fromEntries([-99, 0, 1].map((slack) => [`gswapBoth.s${slack}`, (f) => {
        const r = P["gswap1.s-99"](f)
        if (!r.switched) return r
        const best = byCe(f, M(f, 30)).find((p) => !r.first.includes(p))
        if (!best || ceOf(f, best) <= Math.max(...r.first.map((p) => ceOf(f, p))) + slack) return r
        return { ...r, first: [...r.first.slice(0, 4), best] }
    }])),
    // r1 with a 6th slot instead of the swap (gates6 failed only in the mailbox context).
    "r1.add6": (f) => {
        const r = gated(f, byCe(f, M(f, 30)).slice(0, 5))
        if (r.switched) return r
        const best = byCe(f, M(f, 30)).find((p) => !r.first.includes(p))
        return { ...r, first: [...r.first, best] }
    },
}
// Not switched: the best CE email of the mailbox top 30 not already in the global
// top 5 goes first (or last, replacing #5) when its CE beats the global best by margin.
function swapPipe(f, { where, margin, mb = (f) => fused(f, M(f, 30), { wCe: 2 }).slice(0, 5) }) {
    const r = gated(f, mb(f))
    if (r.switched) return r
    const best = byCe(f, M(f, 30)).find((p) => !r.first.includes(p))
    const gBest = Math.max(...r.first.map((p) => ceOf(f, p)))
    if (!best || ceOf(f, best) <= gBest + margin) return r
    return { ...r, first: where === "first" ? [best, ...r.first.slice(0, 4)] : [...r.first.slice(0, 4), best] }
}

const ab = (f, path) => f.info[path]?.ab === 1
const rows = []
for (const [name, pipe] of Object.entries(P)) {
    const acc = { miss: [], hit: [] }
    for (const f of items) {
        const r = pipe(f)
        const firstAb = r.first.map((p) => ab(f, p))
        const globalHasAb = G(f).some((p) => ab(f, p))
        acc[f.stratum].push({
            r1: firstAb[0] ? 1 : 0, r3: firstAb.slice(0, 3).some(Boolean) ? 1 : 0, r5: firstAb.slice(0, 5).some(Boolean) ? 1 : 0, edge: firstAb[0] || firstAb[4] ? 1 : 0,
            u: [...r.first, ...r.second].some((p) => ab(f, p)) ? 1 : 0, sw: r.switched ? 1 : 0, need: globalHasAb ? 0 : 1,
            pos1: firstAb.some(Boolean) ? (firstAb[0] ? 1 : 0) : null,
        })
    }
    const mean = (list, key) => { const v = list.map((x) => x[key]).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN }
    const w = (key) => MISS_SHARE * mean(acc.miss, key) + (1 - MISS_SHARE) * mean(acc.hit, key)
    const all = [...acc.miss.map((x) => ({ ...x, wt: MISS_SHARE / acc.miss.length })), ...acc.hit.map((x) => ({ ...x, wt: (1 - MISS_SHARE) / acc.hit.length }))]
    const sum = (pred) => all.filter(pred).reduce((s, x) => s + x.wt, 0)
    rows.push({ name, ...Object.fromEntries(["r1", "r3", "r5", "u", "edge"].flatMap((k) => [[`w${k}`, w(k)], [`m${k}`, mean(acc.miss, k)], [`h${k}`, mean(acc.hit, k)]])),
        sw: w("sw"), prec: sum((x) => x.sw && x.need) / sum((x) => x.sw), rec: sum((x) => x.sw && x.need) / sum((x) => x.need), pos1: w("pos1") })
}
const pct = (x) => (x * 100).toFixed(1)
console.log(`n=${items.length} (miss ${items.filter((f) => f.stratum === "miss").length}, hit ${items.filter((f) => f.stratum === "hit").length})${filter ? ` set ${filter}` : ""}`)
console.log("| pipeline | w@1 | w@3 | w@5 | w union | miss @1/@5/union | hit @1/@5/union | edge(1|5) | pos1 given @5 | switch rate | sw prec | sw rec |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of rows) console.log(`| ${r.name} | ${pct(r.wr1)} | ${pct(r.wr3)} | ${pct(r.wr5)} | ${pct(r.wu)} | ${pct(r.mr1)}/${pct(r.mr5)}/${pct(r.mu)} | ${pct(r.hr1)}/${pct(r.hr5)}/${pct(r.hu)} | ${pct(r.wedge)} | ${pct(r.pos1)} | ${pct(r.sw)} | ${pct(r.prec)} | ${pct(r.rec)} |`)
