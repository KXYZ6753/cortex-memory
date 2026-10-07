// Worker s: recognition diagnostics for s-gold. On questions where MC/YN acted: did the
// options contain a gold span (an option whose text occurs in the reference answer and
// not in the question)? Accuracy of mc / yn / clz / base by that split, how often the
// pick equals clz's own span, and the pick's "gold-span" rate.
//   node benchmarks/premise2/explore2/tools/s-mcdiag.js <sets>
import { latestAnswers } from "../../explore/grade.js"
import { pool, dataDir, verdictOf } from "./c-lib.js"
import { NONE } from "../variants/s-cloze.js"
const sets = process.argv[2].split(",")
const VERSION = process.env.SVER ?? "3+cold"
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9$%@./]+/g, " ").replace(/\.(?=\s|$)/g, "").trim()} `
const T = {}
const add = (k, f, v) => { T[k] ??= {}; T[k][f] = (T[k][f] ?? 0) + v }
for (const a of latestAnswers(dataDir)) {
    if (!sets.includes(a.set) || a.variant !== "s-gold" || a.version !== VERSION || !a.renders || (a.s?.options?.length ?? 0) < 2) continue
    const r = pool.byKey.get(a.questionKey)
    const golds = [r.gold, ...(r.alternates ?? [])].map(norm)
    const q = norm(r.question)
    const isGold = (t) => t !== NONE && golds.some((g) => g.includes(norm(t))) && !q.includes(norm(t))
    const has = a.s.options.some(isGold) ? "gold-in-options" : "no-gold-option"
    for (const k of [has, "all"]) {
        add(k, "n", 1)
        for (const f of ["base", "clz", "mc", "yn"]) add(k, f, verdictOf(r, a.renders[f].answer) ?? 0)
        for (const f of ["mc", "yn"]) {
            const pick = a.s[f]?.pick
            add(k, `${f}None`, pick === NONE ? 1 : 0)
            add(k, `${f}=clzSpan`, pick && a.s.clzSpan && norm(pick) === norm(a.s.clzSpan) ? 1 : 0)
            add(k, `${f}PickGold`, pick && isGold(pick) ? 1 : 0)
        }
        add(k, "clzSpanGold", a.s.clzSpan && isGold(a.s.clzSpan) ? 1 : 0)
    }
}
for (const [k, v] of Object.entries(T)) console.log(k, JSON.stringify(v))
