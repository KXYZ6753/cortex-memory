// v6 (aux): no-GPU dry run of v6-go4's code path. A stub generate returns i-det-gates' stored text for
// sandwich prompts and a fixed different text for o4-layout prompts (and "§" for det resets), so the
// whole path (det resets, gates, withShape o4, QA encoder, selection, logging) runs without Ollama.
import { join } from "node:path"
import { openV6 } from "./v6-lib.js"
import { VARIANTS } from "../variants/v6-sel.js"
import { parseSandwich } from "../variants/c-agent.js"
import { openBm25 } from "../../bm25.js"

const [set = "S300-4", n = "6", vid = "v6-go4"] = process.argv.slice(2)
const env = await openV6()
const bm25 = openBm25(join(".data/premise2", "corpus.sqlite"))
const resources = new Map()
for (const key of env.setKeys(set).slice(0, Number(n))) {
    const record = env.pool.byKey.get(key)
    const stored = env.bySet.get(set)?.get(key)?.["i-det-gates"]
    let calls = 0, resets = 0, sandwich = 0, o4 = 0
    const ctx = {
        dataDir: ".data/premise2", emailOf: env.emails.emailOf,
        search: async (q, k, user = null) => bm25.search(q, k, user).map((h) => h.path),
        resource: async (name, loader) => { if (!resources.has(name)) resources.set(name, await loader()); return resources.get(name) },
        generate: async ({ prompt }) => {
            calls++
            if (prompt.startsWith("§")) { resets++; return { status: "output_limit", answer: "§" } }
            if (parseSandwich(prompt)) { sandwich++; return { status: "ok", answer: stored?.answer ?? "stub" } }
            o4++
            return { status: "ok", answer: "The answer is the subject line of the first email." }
        },
        chatRaw: async () => { throw new Error("no chatRaw in v6-go4") },
    }
    const t = performance.now()
    const out = await VARIANTS[vid].run(ctx, record)
    console.log(`${key} calls ${calls} (resets ${resets}, sandwich ${sandwich}, o4 ${o4}) chose ${out.v6.chose} ef g ${out.v6.efGates?.toFixed(3)} o4 ${out.v6.efO4?.toFixed(3)} enc ${out.v6.encMs} ms nli ${out.v6.nliMs ?? "-"} ms comb ${out.v6.combined?.toFixed(2) ?? "-"}, wall ${Math.round(performance.now() - t)} ms; ctx = stored ${JSON.stringify(out.contextPaths) === JSON.stringify(stored?.contextPaths)}`)
}
bm25.close()
