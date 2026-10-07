// Worker s: map j's hand labels of x1's wrong hits (j-taxonomy.js, positional in j-dump
// order) to question keys for S300-2 and S300-1, written to tools/s-jwf.json.
//   node benchmarks/premise2/explore2/tools/j-dump.js S300-2 x1 hit > <dir>/wrong-S300-2.jsonl  (and S300-1)
//   node benchmarks/premise2/explore2/tools/s-jwf.js <dir>
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const LABELS = { // copied from j-taxonomy.js
    "S300-2": "WF WE HDR HEDGE STRICT PART HEDGE WF STRICT STRICT PART HDR WF WE STRICT WF PART GRAN HEDGE PART GRAN PART",
    "S300-1": "WE AMB WF PART WF AMB PART TRUNC PART AMB WF WF WE GRAN WF WF AMB STRICT OVER",
}
const dir = process.argv[2]
const out = {}
for (const [set, labels] of Object.entries(LABELS)) {
    const rows = readFileSync(join(dir, `wrong-${set}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    const L = labels.split(" ")
    if (L.length !== rows.length) throw new Error(`${set}: ${L.length} labels for ${rows.length} rows`)
    rows.forEach((row, i) => { out[row.key] = L[i] })
}
writeFileSync(new URL("./s-jwf.json", import.meta.url), JSON.stringify(out, null, 1))
console.log(Object.keys(out).length, "keys")
