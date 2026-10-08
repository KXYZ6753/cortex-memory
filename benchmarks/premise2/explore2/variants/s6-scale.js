// Worker s6 (round 6): scale control, a diagnostic and not an e2b candidate. See
// docs/premise-study/explore2/s6.md.
//
// The frozen explore/ variants pb, gates and oracles, each behind det() (variants/i-det.js:
// a fixed one-token reset call before every model call, so an answer does not depend on
// earlier questions' prompt-cache state). The code is model-agnostic: the alias passed to
// runExplore2 picks the model (tools/s6-run.js runs them with alias "mid" =
// gemma4:e4b-it-qat). Own ids, so these answers never mix with other workers' e2b runs of
// i-det-pb / i-det-gates; the answer store also keys by model digest and records `alias`.

import { setTimeout as delay } from "node:timers/promises"
import { VARIANTS as BASE } from "../../explore/variants.js"
import { det, IDLE_MS } from "./i-det.js"

const wrap = (id) => det((ctx, record) => BASE[id].run(ctx, record), { mode: "all" })

export const VARIANTS = {
    "s6-det-pb": { version: 1, describe: "Scale control (s6): pb (BM25 global top 5, T2) behind det(); model chosen by the run's alias (e4b = mid)", run: wrap("pb") },
    "s6-det-gates": { version: 1, describe: "Scale control (s6): gates behind det(); model chosen by the run's alias (e4b = mid)", run: wrap("gates") },
    "s6-det-oracles": { version: 1, describe: "Scale control (s6), DIAGNOSTIC: gold email only, sandwich prompt (oracles) behind det(); model chosen by the run's alias", diagnostic: true, run: wrap("oracles") },
    // Decomposition of gates' gain (prompt vs mailbox switch) and of the sandwich prompt's
    // reading gain, for the larger model: pbs = P-B context + sandwich prompt; oracle = gold only, T2.
    "s6-det-pbs": { version: 1, describe: "Scale control (s6): pbs (P-B context, sandwich prompt) behind det(); model chosen by the run's alias", run: wrap("pbs") },
    "s6-det-oracle": { version: 1, describe: "Scale control (s6), DIAGNOSTIC: gold email only, T2 prompt (oracle) behind det(); model chosen by the run's alias", diagnostic: true, run: wrap("oracle") },
    // Idle baseline for the energy table (as i-idle): holds the GPU lock with the run's model
    // resident for 30 s and makes no model call; status "idle" is never graded.
    "s6-idle": { version: 1, describe: "Scale control (s6): idle baseline, the run's model resident for 30 s, no model call (status idle, never graded)", diagnostic: true, run: async () => { await delay(IDLE_MS); return { status: "idle", answer: "" } } },
}
