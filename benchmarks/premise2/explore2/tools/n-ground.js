// Offline: select among stored prompt variants (same first context as gates) by lexical
// grounding of the answer in a single email. node .../n-ground.js S300-2
import { join } from "node:path"
import { pool, loadTable, weightedOf, dataDir, same } from "./n-lib.js"
import { ensureEmailStore } from "../../agent-run.js"
import { contentWords, normaliseForMatch } from "../../text.js"
const [setName = "S300-2"] = process.argv.slice(2)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const C = ["gates", "o4", "o5", "pb"]
const { table, keys } = loadTable(setName, C)
const score = (r, ans, paths) => {
    const novel = contentWords(ans).filter((w) => !new Set(contentWords(r.question)).has(w))
    if (!novel.length) return 0
    return Math.max(...paths.map((p) => { const e = normaliseForMatch(emails.emailOf(p)); return novel.filter((w) => e.includes(w)).length / novel.length }))
}
for (const margin of [0, 0.1, 0.2, 0.3]) {
    const items = []; let ch = 0, g = 0, b = 0
    for (const q of keys) {
        const r = pool.byKey.get(q), G = table.get("gates").get(q)
        const paths = G.a.contextPaths
        let best = "gates", bs = score(r, G.answer, paths) + margin
        for (const c of C.slice(1)) { const x = table.get(c).get(q); if (!x || x.abstain || (c === "pb" && G.a.switched)) continue; const s = score(r, x.answer, paths); if (s > bs) { best = c; bs = s } }
        const v = table.get(best).get(q).correct
        if (best !== "gates" && !same(table.get(best).get(q).answer, G.answer)) { ch++; if (v > G.correct) g++; if (v < G.correct) b++ }
        items.push({ stratum: r.stratum, v })
    }
    const w = weightedOf(items); console.log(`ground m${margin}: ${w.w.toFixed(1)} miss ${w.miss.toFixed(0)} hit ${w.hit.toFixed(1)} changed ${ch} +${g}/-${b}`)
}
