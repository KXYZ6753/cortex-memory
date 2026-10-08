// v6 (aux encoder selection): which stored variants share gates' (or a det parent's) exact context,
// and how often they are right on hits where the parent is wrong. Offline, pool records only.
import { loadCandidates } from "./l-lib.js"
const sets = (process.argv[2] ?? "S300-1,S300-2,S300-3,FULL-0,FULL-1,S300-4,S300-5,FULL-2,FULL-3").split(",")
const parent = process.argv[3] ?? "gates"
const { Q } = await loadCandidates(sets, { exclude: /^(c-gold|cascg|oracle|p-o)/ })
const per = new Map()
for (const [key, q] of Q) {
    if (q.record.stratum !== "hit") continue
    const p = Object.entries(q.by).find(([vv]) => vv.startsWith(parent + "@"))?.[1]
    if (!p) continue
    const pc = JSON.stringify(p.contextPaths ?? [])
    const pText = String(p.answer ?? "").trim()
    const pCorrect = q.cands.get(pText)?.correct
    if (pCorrect === undefined) continue
    for (const [vv, a] of Object.entries(q.by)) {
        const id = `${q.set}|${vv}`
        if (!per.has(id)) per.set(id, { n: 0, same: 0, right: 0, fix: 0, brk: 0, graded: 0 })
        const s = per.get(id)
        s.n++
        if (JSON.stringify(a.contextPaths ?? []) === pc) s.same++
        const c = q.cands.get(String(a.answer ?? "").trim())?.correct
        if (c === undefined) continue
        s.graded++
        s.right += c
        if (c === 1 && pCorrect === 0) s.fix++
        if (c === 0 && pCorrect === 1) s.brk++
    }
}
for (const [id, s] of [...per].sort()) if (s.n >= 50) console.log(`${id.padEnd(40)} n ${s.n} sameCtx ${(100 * s.same / s.n).toFixed(0)}% graded ${s.graded} hitAcc ${(100 * s.right / Math.max(1, s.graded)).toFixed(1)} fix ${s.fix} brk ${s.brk}`)
