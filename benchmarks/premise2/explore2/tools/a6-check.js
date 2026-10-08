// Worker a6: stub check of the a6-g-* variants (no GPU). For every question of a set, run
// i-det-gates and the a6 variant on a stub generator and compare the prompt logs: on
// questions that do not split, the logs must be identical; on split ones, the a6 log must
// be gates' log followed by the form's prompts, each holding exactly gates' final context.
//   node benchmarks/premise2/explore2/tools/a6-check.js <variant> <set> [n] [abstain-first]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS as A, splitParts } from "../variants/a6-surgery.js"
import { VARIANTS as I } from "../variants/i-det.js"
import { pool, dataDir, openEmails } from "./a6-lib.js"
import { ABSTAIN } from "../../prompts.js"

const [id = "a6-g-dec", setName = "S300-4", nArg = "300", abst = ""] = process.argv.slice(2)
const store = await openEmails()
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
function makeCtx(log) {
    let n = 0
    return {
        dataDir, bm25, emailOf: store.emailOf, emailMap: { get: store.emailOf },
        search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path),
        resource: async () => null,
        generate: async ({ prompt }) => { log.push(prompt); const real = !prompt.startsWith("§"); if (real) n++; return { status: "ok", answer: real && abst && n === 1 ? ABSTAIN : real ? `stub ${n}` : "x" } },
    }
}
let same = 0, fired = 0, bad = 0, total = 0
for (const key of loadSet(dataDir, setName, pool).questionKeys.slice(0, Number(nArg))) {
    const r = pool.byKey.get(key)
    total++
    const la = [], lb = []
    const out = await A[id].run(makeCtx(la), r)
    await I["i-det-gates"].run(makeCtx(lb), r)
    const parts = splitParts(r.question)
    if (!parts) { if (JSON.stringify(la) === JSON.stringify(lb)) same++; else { bad++; console.log("DIFF on non-split", key) } continue }
    fired++
    const prefixOk = JSON.stringify(la.slice(0, lb.length)) === JSON.stringify(lb)
    const extra = la.slice(lb.length).filter((p) => !p.startsWith("§"))
    const final = out.used === 1 ? out.contextPaths : out.readPaths.slice(out.contextPaths.length)
    const ctxOk = extra.every((p) => final.every((path) => p.includes(store.emailOf(path))) && (p.match(/^\[\d\]$/gm) ?? []).length === final.length)
    const nOk = extra.length === (id === "a6-g-plist" ? 1 : parts.length)
    if (!prefixOk || !ctxOk || !nOk) { bad++; console.log("BAD", key, { prefixOk, ctxOk, nOk, extra: extra.length, parts: parts.length }) }
    if (fired <= 2) console.log(`--- ${key} parts ${JSON.stringify(parts)}\nanswer: ${out.answer}\nlast prompt tail: ${la[la.length - 1].slice(-400)}`)
}
console.log({ id, setName, total, nonSplitIdentical: same, fired, bad })
bm25.close(); store.close()
