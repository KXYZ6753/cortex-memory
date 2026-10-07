// Worker d: stub check of d6 (no GPU): forced explore (all W0 probes NO, pick "1"); the
// first pick list must equal the lab's "ce(own:W1+bm30+strip20+subj20)" top 15 (W0
// excluded; CE from the d-ce cache, 3-decimal scores, so near-ties may swap order).
//   node benchmarks/premise2/explore2/tools/d-stub6.js S300-1 [limit] [variant]
import { VARIANTS as D } from "../variants/d-agent.js"
import { VARIANTS as X } from "../variants/x-agent.js"
import { openLab, uniq } from "./d-lib.js"

const [setName, limit = 20, id = "d6"] = process.argv.slice(2)
const lab = await openLab({ dense: false })
const resources = new Map()
const tok = (t) => ({ message: { content: t }, done_reason: "stop", logprobs: [{ token: t, logprob: -0.01, top_logprobs: [{ token: t, logprob: -0.01 }] }] })
const mk = (calls) => ({
    dataDir: ".data/premise2", emailOf: lab.emailOf, bm25: lab.bm25,
    search: async (q, k, u = null) => { calls.search++; return lab.bm25.search(q, k, u).map((h) => h.path) },
    resource: async (name, loader) => { if (name === "r-minilm") calls.ce++; return resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name) },
    embedQuery: async () => { throw new Error("no embedding expected") },
    chatRaw: async (body) => (body.messages[0].content.startsWith("Does the email below") ? tok("NO") : tok("stub")),
    generate: async ({ prompt }) => ({ status: "ok", answer: prompt.includes("Write a search for it") ? "FROM: | TO: | ABOUT: contract" : prompt.includes("Email number:") ? "1" : "stub" }),
})
let n = 0, sameSet = 0, sameOrder = 0, sameW0 = 0, extraSearches = 0
const keys = lab.records.filter((r) => lab.setOf.get(r.questionKey) === setName).slice(0, Number(limit))
for (const record of keys) {
    const cx = { search: 0, ce: 0 }, cd = { search: 0, ce: 0 }
    const ox = await X.x1.run(mk(cx), record)
    const od = await D[id].run(mk(cd), record)
    n++
    const ld = od.log.find((l) => l.act === "pick")?.listed ?? []
    const g = lab.gatesOf(record), f = lab.feat.get(record.questionKey), ce = lab.ce[record.questionKey] ?? {}
    const own = (ps) => ps.filter((p) => p.startsWith(`${record.user}/`))
    const pool = uniq([...own(g.W1), ...g.mbox.slice(0, 30), ...f.strip.slice(0, 20), ...f.subj.slice(0, 20)]).filter((p) => !g.W0.includes(p))
    const labList = pool.every((p) => ce[p] !== undefined) ? [...pool].sort((a, b) => ce[b] - ce[a]).slice(0, 15) : null
    if (labList && [...labList].sort().join() === [...ld].sort().join()) sameSet++
    if (labList && labList.join() === ld.join()) sameOrder++
    if (JSON.stringify(ox.contextPaths.slice(0, 4)) === JSON.stringify(od.contextPaths.slice(0, 4))) sameW0++
    extraSearches += cd.search - cx.search
    if (process.env.DBG && labList) { console.log(ld.map((p) => p.split("/").slice(1).join("/") + ":" + ce[p]).join(" ")); console.log(labList.map((p) => p.split("/").slice(1).join("/") + ":" + ce[p]).join(" ")); console.log("only d6:", ld.filter((p) => !labList.includes(p)), "only lab:", labList.filter((p) => !ld.includes(p)), "in pool:", ld.filter((p) => !pool.includes(p))) }
    if (process.env.SHOW) console.log(record.questionKey, "added", od.dAdded?.length, "masked", od.dMasked, "ms", od.dExtraMs, "lab", !!labList)
}
console.log({ id, n, firstListSameSetAsLab: sameSet, sameOrder, sameW0top4: sameW0, extraSearchesPerQ: extraSearches / n })
process.exit(0)
