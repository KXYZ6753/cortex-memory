// Worker q8 (round 6): precision diagnostic. Is part of e2b's hit-reading floor the 4-bit
// quantization? Same code run on gemma4:e2b-it-qat (Q4_0, QAT; alias "small") and on
// gemma4:e2b-it-q8_0 (Q8_0; alias label "small-q8") by tools/q8-run.js. Notes:
// docs/premise-study/explore2/q8.md.
//
//   q8-det-oracle  DIAGNOSTIC: gold email only, sandwich prompt (= explore `oracles` =
//                  a6-det-oracle = p6-g0), behind det(all); hits only (misses "skipped", no
//                  call; q8-run.js --hits never sends them).
//   q8-det-gates   gates (explore/variants.js, unchanged) behind det(all) (= i-det-gates@2).
//
// The code is model-agnostic; the runner's tag picks the model. Own ids, so Q8 answers never
// appear under another worker's variant id; the answer store also keys by model digest and
// records alias "small-q8".

import { sandwichPrompt, VARIANTS as BASE } from "../../explore/variants.js"
import { det } from "./i-det.js"

async function oracleHit(ctx, record) {
    if (record.stratum !== "hit") return { status: "skipped", answer: "", contextPaths: [record.path] }
    const result = await ctx.generate({ prompt: sandwichPrompt(record.question, [ctx.emailOf(record.path)]) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: [record.path], readPaths: [record.path] }
}

export const VARIANTS = {
    "q8-det-oracle": { version: 1, diagnostic: true, describe: "Precision diagnostic (q8), DIAGNOSTIC: gold email only, sandwich prompt (= oracles), behind det(all); hits only; model chosen by tools/q8-run.js (Q4 qat or Q8_0)", run: det(oracleHit, { mode: "all" }) },
    "q8-det-gates": { version: 1, describe: "Precision diagnostic (q8): gates behind det(all) (= i-det-gates@2); model chosen by tools/q8-run.js (Q4 qat or Q8_0)", run: det((ctx, record) => BASE.gates.run(ctx, record), { mode: "all" }) },
}
