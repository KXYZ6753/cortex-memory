// Worker v6 (round 6), AUX: an extractive QA encoder (RoBERTa-base SQuAD 2.0, int8 ONNX, CPU) chooses
// between two of e2b's own answers. The encoder never writes an answer: the output is always one of
// e2b's candidate texts. An answer selector is a new category (not a generator, not a retrieval
// helper); whether it counts in the paper is Kerem's decision. Notes: docs/premise-study/explore2/v6.md
//
// v6-go4 (behind det, mode all): gates (= i-det-gates), then gates with every answer prompt in o4's
// layout (= p6-e4, p6-shape.js withShape), then, if the two texts differ, the QA encoder reads the
// emails both runs read and scores each answer by expected cover of its top-20 span distribution
// (v6-common.js qaScores "ef"); the o4 answer is used only if ef(o4) - ef(gates) > margin (0).
// v6-go4-alt: replay (no model calls) of the o4 text v6-go4 logged for the same question, so the
// alternative can be graded on a set where p6-e4 was not run.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { det } from "./i-det.js"
import { withShape } from "./p6-shape.js"
import { VARIANTS as BASE } from "../../explore/variants.js"
import { loadQA, loadNLI, qaScores, words, content } from "./v6-common.js"

const gates = (ctx, record) => BASE.gates.run(ctx, record)
const gatesO4 = withShape(gates, "o4")

// R2 scales (v6.md section 4, fixed on pool A before the det test)
const SD_EF = 0.35, SD_NLI = 1.71, R2_THRESHOLD = 1.0

async function nliQa(ctx, record, paths, texts) {
    const nli = await ctx.resource("v6-nli", () => loadNLI({ threads: Number(process.env.V6_THREADS ?? 6) }))
    const chunks = nli.chunks(paths.map((path) => ctx.emailOf(path) ?? ""))
    const cw = chunks.map((c) => new Set(words(c)))
    const out = []
    for (const text of texts) {
        const target = [...new Set([...content(record.question), ...content(text)])]
        const ranked = chunks.map((ch, i) => ({ ch, s: target.filter((w) => cw[i].has(w)).length })).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.ch)
        out.push((await nli.score(ranked, [`${record.question} ${text}`]))[0].margin)
    }
    return out
}

async function selectO4(ctx, record, { margin = 0, rule = "R1" } = {}) {
    const g = await gates(ctx, record)
    const o = await gatesO4(ctx, record)
    const gt = String(g.answer ?? "").trim(), ot = String(o.answer ?? "").trim()
    const v6 = { aux: true, chose: "gates", o4Answer: o.answer ?? "", o4Status: o.status, o4Context: o.contextPaths, o4Read: o.readPaths, o4Used: o.used, p6: o.p6 }
    const out = { ...g, v6 }
    if (g.status !== "ok" || o.status !== "ok" || !ot || gt === ot) return out
    const paths = [...new Set([...(g.readPaths ?? g.contextPaths ?? []), ...(o.readPaths ?? o.contextPaths ?? [])])]
    const started = performance.now()
    // R2: NLI runs concurrently with the QA read (separate ONNX sessions on the CPU)
    const nliStarted = performance.now()
    const nliP = rule === "R2" ? nliQa(ctx, record, paths, [gt, ot]).then((r) => ({ r, ms: Math.round(performance.now() - nliStarted) })) : null
    const qa = await ctx.resource("v6-qa", () => loadQA({ threads: Number(process.env.V6_THREADS ?? 6) }))
    const read = await qa.read(record.question, paths.map((path) => ctx.emailOf(path) ?? ""))
    const [sg, so] = qaScores(read, [gt, ot])
    Object.assign(v6, { encMs: Math.round(performance.now() - started), windows: read.windows, paths, efGates: sg.ef, efO4: so.ef, maxGates: sg.max, maxO4: so.max, top1Gates: sg.top1, top1O4: so.top1, best: sg.best, margin, rule })
    let take = so.ef - sg.ef > margin
    if (rule === "R2") {
        const { r: [ng, no], ms } = await nliP
        v6.nliMs = ms
        v6.encMs = Math.round(performance.now() - started)
        Object.assign(v6, { nliGates: ng, nliO4: no, combined: (so.ef - sg.ef) / SD_EF + (no - ng) / SD_NLI })
        take = v6.combined > R2_THRESHOLD
    }
    if (take) {
        v6.chose = "o4"
        return { ...out, status: o.status, answer: o.answer, contextPaths: o.contextPaths, readPaths: o.readPaths, switched: o.switched, used: o.used }
    }
    return out
}

// latest v6-go4 record per questionKey (read lazily from the answer store)
let logged = null
function loggedGo4(dataDir) {
    if (logged) return logged
    logged = new Map()
    const file = join(dataDir, "explore", "answers.jsonl")
    if (!existsSync(file)) return logged
    for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.includes('"variant":"v6-go4"')) continue
        try {
            const a = JSON.parse(line)
            if (a.variant === "v6-go4" && a.v6 && (!logged.has(a.questionKey) || String(a.at) > String(logged.get(a.questionKey).at))) logged.set(a.questionKey, a)
        } catch {}
    }
    return logged
}

export const VARIANTS = {
    "v6-go4": { version: 1, describe: "AUX selector: gates and gates-in-o4-layout (= p6-e4) behind det; a CPU extractive QA encoder (RoBERTa SQuAD2) picks one of the two e2b answers (o4 only if its expected span cover is higher)", run: det((ctx, record) => selectO4(ctx, record, { margin: 0 }), { mode: "all" }) },
    "v6-go4n": { version: 1, describe: "AUX selector (R2): as v6-go4, but o4's answer is used only if QA margin/0.35 + NLI(question+answer) margin/1.71 > 1 (DeBERTa-v3-base MNLI/FEVER/ANLI cross-encoder, CPU)", run: det((ctx, record) => selectO4(ctx, record, { rule: "R2" }), { mode: "all" }) },
    "v6-o4": { version: 1, describe: "gates behind det(all) with every answer prompt in o4's layout: the same computation as p6-e4 under v6's id (the alternative for v6's pre-registered det test; no encoder)", run: det(gatesO4, { mode: "all" }) },
    "v6-go4-alt": { version: 1, describe: "AUX replay (no model calls): the o4-layout answer v6-go4 logged for the same question, for grading the alternative", run: async (ctx, record) => {
        const a = loggedGo4(ctx.dataDir ?? ".data/premise2").get(record.questionKey)
        if (!a) return { status: "missing", answer: "" }
        return { status: a.v6.o4Status ?? "ok", answer: a.v6.o4Answer ?? "", contextPaths: a.v6.o4Context ?? [], readPaths: a.v6.o4Read ?? [], replayOf: a.key }
    } },
}
