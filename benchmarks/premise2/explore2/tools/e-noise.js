// e: noise floor of "oracle any-right": two runs of the same algorithm (x1 vs k3 outside
// x1's handover step, where x1 == k3 by construction; n-lp0 vs gates = gates rerun).
import { table, W, fmt } from "./e-lib.js"
for (const set of ["S300-2", "S300-1", "FULL-0"]) {
    const T = table(set, ["x1@1+cold", "k3@1+cold", "gates@1+cold", "n-lp0@1+cold", "g5@1+cold"])
    const x = T.get("x1"), k = T.get("k3")
    const same = [...x.keys()].filter((q) => k.has(q) && x.get(q).a.step !== "commit-g5")
    const sc = (ks, f) => W(ks.map((q) => ({ record: x.get(q).record, correct: f(q) })))
    const diffTxt = same.filter((q) => x.get(q).text !== k.get(q).text).length
    console.log(set, `x1≡k3 questions ${same.length} (texts differ ${diffTxt}): x1 ${fmt(sc(same, (q) => x.get(q).correct))} k3 ${fmt(sc(same, (q) => k.get(q).correct))} oracle ${fmt(sc(same, (q) => x.get(q).correct || k.get(q).correct ? 1 : 0))}`)
    const n = T.get("n-lp0"), g = T.get("gates")
    if (n) { const ks = [...g.keys()].filter((q) => n.has(q)); console.log(`   gates rerun (n-lp0) ${ks.length}: texts differ ${ks.filter((q) => n.get(q).text !== g.get(q).text).length}, oracle ${fmt(sc(ks, (q) => g.get(q).correct || n.get(q).correct ? 1 : 0))} vs gates ${fmt(sc(ks, (q) => g.get(q).correct))}`) }
}
