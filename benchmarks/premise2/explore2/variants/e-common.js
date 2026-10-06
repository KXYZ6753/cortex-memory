// Worker e (ensembles / answer selection): answer similarity used for agreement voting.
// No VARIANTS here; shared by variants/e-ens.js and tools/e-*.js.
import { isAbstain } from "../../prompts.js"

const STOP = new Set(("a an the of to in on for and or but is are was were be been being by with at from as that this these those it its " +
    "he she they them his her their him we you your our i me my what which who whom whose when where why how did does do done has have had " +
    "not no yes there here than then so such into about over under after before during per via also any all some each email emails " +
    "sent send wrote write message mentioned mention mentions according regarding regards re fw fwd subject would could should will can may might " +
    "s t one two").split(/\s+/))
export const toks = (t) => (t ?? "").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9$.%/-]+/).map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, "")).filter((w) => w && !STOP.has(w))
// content words of an answer that are not in the question (all content words if none)
export const novel = (text, question) => { const q = new Set(toks(question)); const t = toks(text).filter((w) => !q.has(w)); return t.length ? new Set(t) : new Set(toks(text)) }
const nums = (s) => new Set([...s].filter((w) => /\d/.test(w)))

// Similarity of two answers to the same question in [0, 1]: mean of overlap coefficient and
// Jaccard over novel words; abstentions only match abstentions; disjoint numbers -> 0.
export function sim(a, b, question) {
    const ab = isAbstain(a), bb = isAbstain(b)
    if (ab || bb) return ab && bb ? 1 : 0
    const A = novel(a, question), B = novel(b, question)
    if (!A.size || !B.size) return 0
    let inter = 0
    for (const w of A) if (B.has(w)) inter++
    const na = nums(A), nb = nums(B)
    if (na.size && nb.size && ![...na].some((n) => nb.has(n))) return 0
    return (inter / Math.min(A.size, B.size)) * 0.5 + (inter / (A.size + B.size - inter)) * 0.5
}
export const AGREE = 0.5
