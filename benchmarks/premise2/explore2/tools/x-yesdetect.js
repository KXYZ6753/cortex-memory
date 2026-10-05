// Worker x: how well does the YES-token logprob (x1 logs) separate false-YES commits from true ones?
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const set = process.argv[2] ?? "S300-2"
const rows = graded("x1@1+cold", set).flatMap((x) => {
    const yes = (x.answer.log ?? []).find((l) => l.act === "check" && l.yes)
    if (!yes || !String(x.answer.step).startsWith("commit")) return []
    return [{ st: x.record.stratum, ab: bearing(x.record)(yes.path), lp: yes.yesLp ?? 0, unsure: !!x.answer.unsure, rank: x.answer.yesAt }]
})
for (const m of [-0.05, -0.1, -0.2, -0.3, -0.5]) {
    const f = rows.filter((r) => r.lp < m)
    const cnt = (l, st, ab) => l.filter((r) => r.st === st && r.ab === ab).length
    console.log(`yesLp<${m}: fires ${f.length}: false-YES miss ${cnt(f, "miss", false)}/${cnt(rows, "miss", false)}, true-YES miss ${cnt(f, "miss", true)}/${cnt(rows, "miss", true)}, true-YES hit ${cnt(f, "hit", true)}/${cnt(rows, "hit", true)}, false-YES hit ${cnt(f, "hit", false)}/${cnt(rows, "hit", false)}`)
}
const auc = (pos, neg) => { let s = 0; for (const p of pos) for (const n of neg) s += p < n ? 1 : p === n ? 0.5 : 0; return s / (pos.length * neg.length) }
const fal = rows.filter((r) => !r.ab).map((r) => r.lp), tru = rows.filter((r) => r.ab).map((r) => r.lp)
console.log(`AUC (low yesLp -> false YES): ${auc(fal, tru).toFixed(2)}  n false ${fal.length} true ${tru.length}`)
const ua = (pos, neg) => auc(pos.map((x) => (x ? 0 : 1)), neg.map((x) => (x ? 0 : 1)))
console.log(`answer-lp gate (unsure) AUC: ${ua(rows.filter((r) => !r.ab).map((r) => r.unsure), rows.filter((r) => r.ab).map((r) => r.unsure)).toFixed(2)}`)
process.exit(0)
