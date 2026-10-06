// Worker t: anatomy of x1/k3 explore episodes: which open found the YES email, whether it
// came from the model-written search, and accuracy by that path.
//   node benchmarks/premise2/explore2/tools/t-explore.js S300-2 x1@1+cold
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const [set, v] = process.argv.slice(2)
const items = graded(v, set).filter((i) => ["found", "nofound", "nopick"].includes(i.answer.step))
const tab = {}
const add = (k, i) => { tab[k] ??= { n: 0, hit: 0, hitC: 0, miss: 0, missC: 0, ab: 0 }; const t = tab[k]; t.n++; t[i.record.stratum]++; if (i.correct) t[`${i.record.stratum}C`]++; if (i.answer.foundPath && bearing(i.record)(i.answer.foundPath)) t.ab++ }
for (const i of items) {
    const log = i.answer.log ?? []
    const picks = log.filter((l) => l.act === "pick")
    const search = log.find((l) => l.act === "search")
    if (i.answer.step !== "found") { add(`${i.answer.step} (picks ${picks.length})`, i); continue }
    const idx = picks.findIndex((p) => p.path === i.answer.foundPath)
    const fromSearch = search && (search.results ?? []).includes(i.answer.foundPath)
    const inFirstList = picks[0]?.listed?.includes(i.answer.foundPath)
    add(`found@open${idx + 1}${fromSearch ? " srch" : ""}${inFirstList ? " list0" : ""}`, i)
}
for (const [k, t] of Object.entries(tab).sort()) console.log(`${k.padEnd(28)} n ${t.n} | hit ${t.hitC}/${t.hit} miss ${t.missC}/${t.miss} | foundAB ${t.ab}`)
process.exit(0)
