// Worker l: build the stored-candidate file for the verification diagnostic (l-diag.js).
// Per question of each set: up to K distinct stored answer texts (priority sources first,
// then by how many variants produced the text), each with its own reading context, plus
// x1's YES email and W0. If the full pool is mixed but the first K are not, the most
// supported candidate of the missing class replaces the last one (diagnostic only: the
// file carries no per-candidate verdicts, only a per-question "mixed" flag).
//   node benchmarks/premise2/explore2/tools/l-build.js S300-2,S300-1 [K]
import { writeFileSync, existsSync, readFileSync } from "node:fs"
import { loadCandidates, yesPathOf } from "./l-lib.js"

const sets = process.argv[2].split(",")
const K = Number(process.argv[3] ?? 8)
const OUT = ".data/premise2/explore/l-cands.json"
const PRIO = ["x1", "x1.commit", "g5", "gates", "oracles", "u-ocad5", "c-xT", "c-fin1", "d8r", "y1", "j2", "t-lk", "k3", "p3", "u-orep"]
const GOLDONLY = /^(oracles|u-o|b-o|c-gold)/
const { Q } = await loadCandidates(sets)
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {}
let nq = 0, nmixed = 0, ncand = 0, forced = 0
for (const [key, q] of Q) {
    const x1 = q.by["x1@1+cold"]
    if (!x1) continue
    const gates = q.by["gates@1+cold"]
    const W0 = gates?.contextPaths ?? null
    const ctxOf = (a) => {
        if (a.used === 2 && a.readPaths?.length > (a.contextPaths?.length ?? 0)) return a.readPaths.slice(a.contextPaths.length)
        return a.readPaths?.length ? a.readPaths : a.contextPaths
    }
    const all = [...q.cands.values()].map((c) => {
        const srcs = [...c.sources]
        const rank = Math.min(...srcs.map((s) => { const i = PRIO.indexOf(s); return i < 0 ? 99 : i }))
        let ctx = null
        for (const s of [...PRIO, ...srcs]) {
            if (!srcs.includes(s)) continue
            if (s === "x1.commit") { ctx = W0; break }
            const a = Object.entries(q.by).find(([vv]) => vv.split("@")[0] === s.replace(/\.single$/, ""))?.[1]
            if (s.endsWith(".single")) { ctx = c.ctx[s] ?? null; if (ctx) break; continue }
            if (a && String(a.answer ?? "").trim() === c.text) { ctx = ctxOf(a); if (ctx?.length) break }
        }
        if (!ctx?.length && srcs.every((s) => GOLDONLY.test(s))) ctx = [q.record.path]
        return { text: c.text, sources: srcs, ctx: ctx ?? W0, rank, support: srcs.length, correct: c.correct }
    }).sort((a, b) => a.rank - b.rank || b.support - a.support || a.text.localeCompare(b.text))
    const mixedAll = all.some((c) => c.correct === 1) && all.some((c) => c.correct === 0)
    let pick = all.slice(0, K)
    if (mixedAll && !(pick.some((c) => c.correct === 1) && pick.some((c) => c.correct === 0))) {
        const missing = pick.some((c) => c.correct === 1) ? 0 : 1
        const add = all.slice(K).filter((c) => c.correct === missing).sort((a, b) => b.support - a.support)[0]
        pick = [...pick.slice(0, K - 1), add]
        forced++
    }
    nq++; if (mixedAll) nmixed++; ncand += pick.length
    out[key] = {
        set: q.set, mixed: mixedAll,
        x1: { answer: x1.answer, step: x1.step, yesPath: yesPathOf(x1), firstMean: x1.firstMean ?? null, W0 },
        cands: pick.map(({ text, sources, ctx }) => ({ text, sources, ctx })),
    }
}
writeFileSync(OUT, JSON.stringify(out))
console.log(`${sets.join(",")}: ${nq} questions, ${nmixed} mixed, ${(ncand / nq).toFixed(1)} candidates/q, forced ${forced}; file has ${Object.keys(out).length} questions`)
