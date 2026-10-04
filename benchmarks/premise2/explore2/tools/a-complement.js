// Offline: does agent a2's pick reach evidence gates' final context lacks (misses),
// and how often does a2's pick land in gates' final context (agreement)?
//   node .../a-complement.js [agent@version] [set]
import { openAll } from "./a-lib.js"
import { gatesContextsOffline } from "./a-gatesctx.js"
const [agent = "a2@1+cold", setName = "S300-2"] = process.argv.slice(2)
const { graded, bearing, emails } = await openAll()
const g = new Map(graded("gates@1+cold", setName).map((i) => [i.record.questionKey, i]))
const tab = {}
for (const i of graded(agent, setName)) {
    const gi = g.get(i.record.questionKey)
    if (!gi) continue
    const isB = bearing(i.record)
    const { final } = gatesContextsOffline(i.record, gi.answer.used ?? 1, emails.emailOf)
    const read = i.answer.readPaths ?? []
    const inFinal = read.length === 1 && final.includes(read[0])
    const k = `${i.record.stratum} gatesFinalBearing=${final.some(isB)} agentReadBearing=${read.length === 1 ? isB(read[0]) : "multi"} pickInGatesFinal=${inFinal}`
    tab[k] ??= { n: 0, gatesC: 0, agentC: 0, graded: 0 }
    tab[k].n++
    if (gi.correct !== null && i.correct !== null) { tab[k].graded++; tab[k].gatesC += gi.correct; tab[k].agentC += i.correct }
}
for (const [k, v] of Object.entries(tab).sort()) console.log(`${k}: n ${v.n}; graded ${v.graded}: gates ${v.gatesC}, agent ${v.agentC}`)
emails.close()
