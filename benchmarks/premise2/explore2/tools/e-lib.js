// e: shared offline helpers (ensembles / answer agreement). Pool records + exploration answers only.
import { openAll, weightedOf } from "./a-lib.js"
import { mulberry32, BOOT_B } from "./rng.js"

export const ctx = await openAll()
export const { missShare } = ctx

export { sim, toks, novel } from "../variants/e-common.js"
import { sim } from "../variants/e-common.js"

// Map variant@version -> Map(questionKey -> { correct, text, a, record })
export function table(setName, ids) {
    const out = new Map()
    for (const id of ids) {
        const m = new Map()
        for (const g of ctx.graded(id, setName)) if (g.correct != null) m.set(g.record.questionKey, { correct: g.correct, text: g.answer.answer, a: g.answer, record: g.record })
        out.set(id.split("@")[0], m)
    }
    return out
}
export const W = (items) => weightedOf(items, missShare)
export const fmt = (s) => `${(100 * s.weighted).toFixed(1)} (miss ${(100 * s.miss).toFixed(0)} hit ${(100 * s.hit).toFixed(1)})`

// paired bootstrap CI on the weighted difference (stratified)
export function bootDelta(rows, fa, fb, B = BOOT_B, seed = 7) {
    const rnd = mulberry32(seed) // was a double-precision LCG with period 10,466 (ci-erratum.md)
    const miss = rows.filter((r) => r.record.stratum === "miss"), hit = rows.filter((r) => r.record.stratum === "hit")
    const d = (l) => l.map((r) => fa(r) - fb(r))
    const dm = d(miss), dh = d(hit)
    const mean = (l) => l.reduce((x, y) => x + y, 0) / l.length
    const point = missShare * mean(dm) + (1 - missShare) * mean(dh)
    const res = []
    for (let i = 0; i < B; i++) {
        let sm = 0, sh = 0
        for (let j = 0; j < dm.length; j++) sm += dm[Math.floor(rnd() * dm.length)]
        for (let j = 0; j < dh.length; j++) sh += dh[Math.floor(rnd() * dh.length)]
        res.push(missShare * sm / dm.length + (1 - missShare) * sh / dh.length)
    }
    res.sort((a, b) => a - b)
    return { d: 100 * point, lo: 100 * res[Math.floor(0.025 * B)], hi: 100 * res[Math.floor(0.975 * B)] }
}
