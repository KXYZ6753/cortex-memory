// Offline helpers for worker h (hybrid perfecter): join stored answers + J1 verdicts
// with the r-* feature/CE caches (BM25 lists, header scores, AB flags, MiniLM scores)
// and compute failure-detector features for the answer actually given.
// Pool records only; caches: <SCRATCH>/r-features*.json, r-ce*.json (r's dev caches;
// h-feat.js writes tagged caches for other sets into <SCRATCH>/h/).
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { contentWords, normaliseForMatch } from "../../text.js"
import { attribute } from "../variants/a-common.js"
import { openAll as openA, weightedOf } from "./a-lib.js"

export const SCRATCH = "C:/Users/Kerem/AppData/Local/Temp/claude/C--Users-Kerem-code-cortex-memory/e3b3b9cc-fd3b-40c4-81c7-69f7f03fda02/scratchpad"
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

export function loadCaches() {
    const feats = new Map()
    const ce = {}
    const pairs = [[join(SCRATCH, "r-features.json"), join(SCRATCH, "r-ce.json")]]
    for (const tag of ["S300-2"]) pairs.push([join(SCRATCH, "h", `r-features-${tag}.json`), join(SCRATCH, "h", `r-ce-${tag}.json`)])
    for (const [f, c] of pairs) {
        if (!existsSync(f) || !existsSync(c)) continue
        for (const row of readJson(f)) feats.set(row.key, row)
        Object.assign(ce, readJson(c))
    }
    return { feats, ce }
}

export const cov = (question, email) => {
    const qw = contentWords(question)
    const lower = normaliseForMatch(email)
    return qw.filter((w) => lower.includes(w)).length / Math.max(1, qw.length)
}

export async function openH() {
    const env = await openA()
    const { feats, ce } = loadCaches()
    // per graded answer: features of the answer's source email vs the unseen candidates
    const featuresOf = (item) => {
        const { answer, record } = item
        const f = feats.get(record.questionKey)
        const scores = ce[record.questionKey]?.s
        if (!f || !scores) return null
        const emailOf = env.emails.emailOf
        const ab = env.bearing(record)
        const used = answer.used ?? 1
        const read = answer.readPaths ?? answer.contextPaths ?? []
        const final = used > 1 ? read.slice(read.length - (read.length - (answer.contextPaths?.length ?? 5))) : (answer.contextPaths ?? read.slice(0, 5))
        const cands = [...new Set([...f.mailbox.map((x) => x[0]).slice(0, 30), ...f.global.map((x) => x[0]).slice(0, 10)])]
        const s = (p) => scores[p] ?? -20
        const src = item.abstain ? null : attribute(answer.answer, record.question, final, emailOf)
        const unseen = cands.filter((p) => !final.includes(p))
        const mailUnseen = f.mailbox.map((x) => x[0]).filter((p) => !final.includes(p))
        const bestUnseen = unseen.reduce((b, p) => (b === null || s(p) > s(b) ? p : b), null)
        const ceFinal = final.map(s)
        return {
            key: record.questionKey, stratum: record.stratum, correct: item.correct, switched: !!answer.switched, used,
            srcIdx: src?.index ?? -1, srcShare: src?.share ?? 0, srcAB: src ? (ab(src.path) ? 1 : 0) : 0,
            ceSrc: src ? s(src.path) : -20, ceFinalMax: Math.max(...ceFinal), ceFinal0: ceFinal[0] ?? -20,
            ceUnseenMax: bestUnseen ? s(bestUnseen) : -20, ceAllMax: Math.max(...cands.map(s)),
            covSrc: src ? cov(record.question, emailOf(src.path)) : 0, covUnseenMax: Math.max(0, ...mailUnseen.slice(0, 20).map((p) => cov(record.question, emailOf(p)))),
            hSrc: src ? (f.info[src.path]?.h ?? 0) : 0,
            g12: (f.global[0]?.[1] ?? 0) - (f.global[1]?.[1] ?? 0),
            abFinal: final.some(ab) ? 1 : 0, abFinalPos: final.findIndex(ab),
            abMail20: f.mailbox.slice(0, 20).some((x) => ab(x[0])) ? 1 : 0, abMail30: f.mailbox.slice(0, 30).some((x) => ab(x[0])) ? 1 : 0,
            abUnseen30: mailUnseen.slice(0, 30).some(ab) ? 1 : 0, bestUnseenAB: bestUnseen && ab(bestUnseen) ? 1 : 0,
            answerLen: String(answer.answer ?? "").length, abstain: item.abstain ? 1 : 0,
        }
    }
    return { ...env, feats, ce, featuresOf, weightedOf }
}
