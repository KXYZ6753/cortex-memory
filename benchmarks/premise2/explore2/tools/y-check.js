// Worker y: offline stub check of y1/y2 (no GPU). A fake ctx scripts the model's replies
// (probe YES/NO + token logprob, answer mean logprobs) per scenario and records the call
// sequence. For each scenario the y variant's sequence is compared with its parents'
// (x1, j2, m2, t-lx) on the same script: where an add-on does not fire, the sequences
// must be identical; where it fires, the parent's sequence must be a prefix.
//   node benchmarks/premise2/explore2/tools/y-check.js [set] [nQuestions]
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS as Y } from "../variants/y-stack.js"
import { VARIANTS as X } from "../variants/x-agent.js"
import { VARIANTS as J } from "../variants/j-reread.js"
import { VARIANTS as M } from "../variants/m-agent.js"
import { VARIANTS as T } from "../variants/t-ladder.js"
import { VARIANTS as G } from "../variants/g-agent.js"

const dataDir = ".data/premise2"
const [setName = "S300-2", nq = "3"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()

// scenario: yes1 = first W0 probe's YES logprob (null = all W0 probes NO -> explore),
// a = gates' answer mean lp, rec = index (1-based) of the first recovery probe saying YES
// and its lp, s = single-read mean lp
const SCEN = {
    S1_sure: { yes1: -0.01, a: -0.05 },
    S2_unsure_single_ok: { yes1: -0.01, a: -0.3, s: -0.05 },
    S3_unsure_single_bad: { yes1: -0.01, a: -0.3, s: -0.3 },
    S4_doubt_sure_norec: { yes1: -0.3, a: -0.05 },
    S5_doubt_sure_rec: { yes1: -0.3, a: -0.05, rec: [2, -0.05] },
    S6_doubt_unsure_rec_single_ok: { yes1: -0.3, a: -0.3, rec: [2, -0.05], s: -0.05 },
    S7_doubt_unsure_rec_single_bad: { yes1: -0.3, a: -0.3, rec: [2, -0.05], s: -0.3 },
    S8_doubt_unsure_norec_single_ok: { yes1: -0.3, a: -0.3, s: -0.05 },
    S9_doubt_rec_below_yes1: { yes1: -0.3, a: -0.05, rec: [1, -0.5] },
    S10_explore: { yes1: null },
}

const nEmails = (p) => (p.match(/^\[\d+\]$/gm) ?? []).length
const isSandwich = (p) => p.startsWith("You answer questions about a person's email archive")
const isProbe = (p) => p.startsWith("Does the email below contain")

async function runOne(variant, record, sc) {
    const seq = []
    let probes = 0, answered = false
    const pathOf = (prompt) => {
        // which email is in a 1-email prompt (for single reads / probes)
        for (const p of resources.get("cands")) if (prompt.includes(emails.emailOf(p).slice(0, 400))) return p
        return "?"
    }
    const tok = (t, l, n = 1) => ({ message: { content: t }, done_reason: "stop", logprobs: Array.from({ length: n }, () => ({ token: "x", logprob: l, top_logprobs: [{ token: t, logprob: l }, { token: t === "YES" ? "NO" : "YES", logprob: -3 }] })) })
    const ctx = {
        dataDir, emailOf: emails.emailOf, bm25, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        chatRaw: async (body) => {
            const prompt = body.messages[0].content
            if (isProbe(prompt)) {
                probes++
                if (!answered) {
                    // W0 probes (or explore probes when sc.yes1 === null)
                    if (sc.yes1 !== null && probes === 1) { seq.push("P:yes"); return tok("YES", sc.yes1) }
                    seq.push("P:no"); return tok("NO", -0.01)
                }
                const k = probes - 1
                if (sc.rec && k === sc.rec[0]) { seq.push(`R${k}:yes`); return tok("YES", sc.rec[1]) }
                seq.push(`R${k}:no`); return tok("NO", -0.01)
            }
            if (isSandwich(prompt)) {
                const n = nEmails(prompt)
                if (n === 1) { seq.push(`S1:${pathOf(prompt)}`); return tok("single answer", sc.s ?? -0.05, 5) }
                answered = true
                seq.push(`A${n}`); return tok("gates answer", sc.a, 5)
            }
            seq.push("chat?"); return tok("?", -1)
        },
        generate: async ({ prompt }) => {
            if (isSandwich(prompt)) { seq.push(`G${nEmails(prompt)}`); return { status: "ok", answer: "gen answer" } }
            seq.push("gen"); return { status: "ok", answer: "1" }
        },
    }
    const realG5 = G.g5
    G.g5 = { ...realG5, run: async () => { seq.push("g5"); return { status: "ok", answer: "g5 answer", contextPaths: [], readPaths: [] } } }
    try {
        const out = await variant.run(ctx, record)
        return { seq, out }
    } finally { G.g5 = realG5 }
}

const parentsOf = {
    S1_sure: ["x1", "j2", "m2"], S2_unsure_single_ok: ["j2"], S3_unsure_single_bad: ["j2"],
    S4_doubt_sure_norec: ["m2", "x1"], S5_doubt_sure_rec: ["m2"], S6_doubt_unsure_rec_single_ok: ["m2"], S7_doubt_unsure_rec_single_bad: ["m2"],
    S8_doubt_unsure_norec_single_ok: ["m2"], S9_doubt_rec_below_yes1: ["m2"], S10_explore: ["x1", "m2", "j2"],
}
const PAR = { x1: X.x1, j2: J.j2, m2: M.m2, "t-lx": T["t-lx"] }
let bad = 0
for (const key of set.questionKeys.slice(0, Number(nq))) {
    const record = pool.byKey.get(key)
    const cands = new Set([...(await ctx0Search(record))])
    resources.set("cands", cands)
    for (const [name, sc] of Object.entries(SCEN)) {
        for (const [yid, base] of [["y1", "x1"], ["y2", "t-lx"]]) {
            const y = await runOne(Y[yid], record, sc)
            const lines = [`${key.slice(0, 40)} ${name} ${yid}: step=${y.out.step} ctx=${(y.out.contextPaths ?? []).length} seq=${y.seq.join(" ")} y=${JSON.stringify(y.out.y ?? null)}`]
            const parents = yid === "y1" ? parentsOf[name] : [...parentsOf[name].filter((p) => p !== "x1"), ...(name === "S1_sure" || name === "S10_explore" || name === "S4_doubt_sure_norec" ? ["t-lx"] : [])]
            for (const pid of parents) {
                if (yid === "y2" && pid !== "t-lx" && name === "S10_explore") continue // y2's explore is t-lx's
                const p = await runOne(PAR[pid], record, sc)
                const same = p.seq.join(" ") === y.seq.join(" ")
                const prefix = y.seq.join(" ").startsWith(p.seq.filter((s) => s !== "g5").join(" "))
                lines.push(`   ${pid}: ${same ? "IDENTICAL" : prefix ? "prefix" : "DIFFERENT"} seq=${p.seq.join(" ")} step=${p.out.step}`)
            }
            console.log(lines.join("\n"))
        }
    }
    // E placement check: in recover scenarios the m2 answer context must be [E, W0 top 4]
}
async function ctx0Search(record) {
    const q = record.question
    const a = bm25.search(q, 50, record.user).map((h) => h.path)
    const b = bm25.search(q, 20).map((h) => h.path)
    return [...a, ...b]
}
console.log({ bad })
bm25.close(); process.exit(0)
