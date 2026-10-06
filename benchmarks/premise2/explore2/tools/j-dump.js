// Worker j: dump wrong hit answers of a variant (default x1) with references, J1 reason,
// x1 step/confidence, whether the gold email was in the reading context, and the gates /
// oracle verdicts on the same question. Offline only (pool records + stored answers).
//   node benchmarks/premise2/explore2/tools/j-dump.js S300-2 [x1] [hit|miss|all] > out.jsonl
import { pool, loadTable, verdictRow } from "./n-lib.js"

const [setName = "S300-2", variant = "x1", stratum = "hit"] = process.argv.slice(2)
const { table, keys } = loadTable(setName, [variant, "gates", "oracles", "k3", "g5"])
const V = table.get(variant)
const rows = []
for (const key of keys) {
    const r = pool.byKey.get(key)
    if (stratum !== "all" && r.stratum !== stratum) continue
    const v = V.get(key)
    if (!v || v.correct !== 0) continue
    const a = v.a
    const ab = new Set([r.path, ...(r.twins ?? [])])
    const read = a.readPaths ?? a.contextPaths ?? []
    const goldPos = (a.contextPaths ?? []).findIndex((p) => ab.has(p))
    const j = verdictRow(r, a.answer)
    rows.push({
        key, stratum: r.stratum, type: r.type, q: r.question, gold: r.gold, alts: r.alternates, answer: a.answer,
        reason: j?.reason, missing: j?.missing, parts: j ? `${j.partsCorrect}/${j.partsAsked}` : null,
        step: a.step, firstMean: a.firstMean, goldPos, goldRead: read.some((p) => ab.has(p)),
        gates: table.get("gates")?.get(key)?.correct ?? null, oracle: table.get("oracles")?.get(key)?.correct ?? null,
        k3: table.get("k3")?.get(key)?.correct ?? null, g5: table.get("g5")?.get(key)?.correct ?? null,
        gatesAnswer: a.gatesAnswer && a.gatesAnswer !== a.answer ? a.gatesAnswer : undefined,
    })
}
for (const row of rows) console.log(JSON.stringify(row))
console.error(`${setName} ${variant} ${stratum}: ${rows.length} wrong`)
