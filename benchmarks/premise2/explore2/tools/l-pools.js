// Worker l: candidate pools on the dev sets. Distinct answer texts per question, mixed
// questions (>= 1 right and >= 1 wrong candidate), oracle-selection bound vs x1.
//   node benchmarks/premise2/explore2/tools/l-pools.js [sets] [sourceList|all]
import { loadCandidates, DEV, yesPathOf } from "./l-lib.js"

const sets = process.argv[2] ? process.argv[2].split(",") : DEV
const srcArg = process.argv[3] ?? "all"
const SOURCES = {
    all: null,
    deploy: ["x1", "x1.commit", "g5", "gates", "j1", "j2", "j1.single", "j2.single", "c-fin1", "c-xT", "u-xcad", "u-xrep", "d8r", "y1", "t-lk", "k3"],
    x1core: ["x1", "x1.commit", "g5", "gates"],
}
const keep = srcArg === "all" ? null : (SOURCES[srcArg] ?? srcArg.split(","))
const { env, Q } = await loadCandidates(sets)
const ms = env.missShare
for (const set of [...sets, "ALL"]) {
    const qs = [...Q.values()].filter((q) => (set === "ALL" || q.set === set) && q.by["x1@1+cold"])
    const S = { miss: { n: 0, x1: 0, any: 0, mixed: 0, nc: 0 }, hit: { n: 0, x1: 0, any: 0, mixed: 0, nc: 0 } }
    const mixedByStep = {}
    for (const q of qs) {
        const st = S[q.record.stratum]
        const x1 = q.by["x1@1+cold"]
        const cands = [...q.cands.values()].filter((c) => !keep || [...c.sources].some((s) => keep.includes(s)))
        const x1c = q.cands.get(String(x1.answer ?? "").trim())?.correct ?? 0
        const any = cands.some((c) => c.correct === 1) ? 1 : 0
        const mixed = any && cands.some((c) => c.correct === 0)
        st.n++; st.x1 += x1c; st.any += any; st.mixed += mixed ? 1 : 0; st.nc += cands.length
        if (mixed) { const k = `${q.record.stratum}:${x1.step}:${x1c ? "x1right" : "x1wrong"}`; mixedByStep[k] = (mixedByStep[k] ?? 0) + 1 }
    }
    const w = (f) => (ms * S.miss[f] / S.miss.n + (1 - ms) * S.hit[f] / S.hit.n) * 100
    console.log(`${set}: n ${S.miss.n}m/${S.hit.n}h, cands/q ${((S.miss.nc + S.hit.nc) / (S.miss.n + S.hit.n)).toFixed(1)}, mixed miss ${S.miss.mixed} hit ${S.hit.mixed}; x1 ${w("x1").toFixed(1)} (${(100 * S.miss.x1 / S.miss.n).toFixed(1)}/${(100 * S.hit.x1 / S.hit.n).toFixed(1)}), oracle-select ${w("any").toFixed(1)} (${(100 * S.miss.any / S.miss.n).toFixed(1)}/${(100 * S.hit.any / S.hit.n).toFixed(1)})`)
    if (set === "ALL") console.log("  mixed by stratum:x1 step:x1 correctness", JSON.stringify(Object.fromEntries(Object.entries(mixedByStep).sort())))
}
