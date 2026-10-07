// Worker b (round 5): shared offline helpers. Pool records + stored answers only; no GPU.
import { join } from "node:path"
import { pool, loadTable, verdictOf, verdictRow, weightedOf, missShare, dataDir } from "./n-lib.js"
import { loadSet } from "../../explore/sets.js"
import { ensureEmailStore } from "../../agent-run.js"

export { pool, loadTable, verdictOf, verdictRow, weightedOf, missShare, dataDir }
export const DEV_SETS = ["S300-1", "S300-2", "S300-3", "FULL-1"]
export const DEMO_SETS = ["DEMO-1", "DEMO-2"]

let store = null
export async function emails() {
    store ??= await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
    return store
}
export const recordsOf = (setName) => loadSet(dataDir, setName, pool).questionKeys.map((key) => pool.byKey.get(key))

// words with digits, capitalised tokens and dates: the "specific" content of an answer
export const specifics = (text) => {
    const s = String(text ?? "")
    const nums = s.match(/\$?\d[\d,./:%-]*\d|\$?\d/g) ?? []
    const caps = (s.match(/\b[A-Z][a-zA-Z&'.-]+(?:\s+[A-Z][a-zA-Z&'.-]+)*/g) ?? []).filter((w) => !/^(The|A|An|According|In|On|He|She|They|It|This|That|There|What|Who|When|Which|Mr|Ms|Mrs|I)$/.test(w))
    return { nums: [...new Set(nums)], caps: [...new Set(caps)] }
}
export const sentences = (text) => (String(text ?? "").match(/[^.!?]+[.!?]+(\s|$)/g) ?? [String(text ?? "")]).length
