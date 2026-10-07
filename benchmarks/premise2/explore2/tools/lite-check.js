// Worker lite: offline stub check of lite-a / lite-u / lite-ub and their det forms (no GPU).
// Same scripted model as tools/q-check.js (W0 probe YES/NO + token logprob, gates' answer mean
// logprob, recovery probes, list picks, the plan, and g5's two tool turns: search_mailbox(Q)
// then answer); every call is recorded with a hash of its exact prompt; real BM25, CE, d6 list,
// m2 recovery list and g5 code run.
// Per scenario each lite variant is compared with its parents on the same script:
//   "="   identical call sequence (exact prompts)
//   "-g5" identical to the parent's sequence with the parent's g5 handover calls removed
//         (T1, T2 and g5's final answer)
//   "-r"  identical to the parent's sequence with its recovery probes removed
//   "lean" explore: lite's pick and probe = the parent's first pick and probe, and lite's final
//         answer prompt = the parent's final answer prompt (the parent opens more before it)
// det forms: the same real calls as the plain forms, each preceded by exactly one reset.
//   node benchmarks/premise2/explore2/tools/lite-check.js [set] [nQuestions]
import { join } from "node:path"
import { createHash } from "node:crypto"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS as L } from "../variants/lite-stack.js"
import { VARIANTS as Q } from "../variants/q-stack.js"
import { VARIANTS as T } from "../variants/t-ladder.js"
import { VARIANTS as M } from "../variants/m-agent.js"
import { x1Contexts } from "../variants/m-agent.js"
import { RESET_PROMPT } from "../variants/i-det.js"

const dataDir = ".data/premise2"
const [setName = "S300-2", nq = "3"] = process.argv.slice(2)
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const resources = new Map()
const h = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 8)

const SCEN = {
    S1_sure: { yes1: -0.01, a: -0.05 },
    S2_unsure: { yes1: -0.01, a: -0.3 },
    S3_doubt_sure_noE: { yes1: -0.3, a: -0.05 },
    S4_doubt_sure_E: { yes1: -0.3, a: -0.05, rec: [2, -0.05] },
    S5_doubt_unsure_E: { yes1: -0.3, a: -0.3, rec: [2, -0.05] },
    S6_doubt_unsure_noE: { yes1: -0.3, a: -0.3 },
    S7_doubt_rec_below_yes1: { yes1: -0.3, a: -0.3, rec: [1, -0.5] },
    S8_explore: { yes1: null },
}
// expected relation of each lite variant to each parent, per scenario
const EXPECT = {
    "lite-a": {
        S1_sure: { q1: "=", tlk: "=" }, S2_unsure: { tlk: "=", q1: "-g5" }, S3_doubt_sure_noE: { q1: "=", m2: "=" },
        S4_doubt_sure_E: { q1: "=", m2: "=" }, S5_doubt_unsure_E: { q1: "=", m2: "=" }, S6_doubt_unsure_noE: { q1: "-g5" },
        S7_doubt_rec_below_yes1: { q1: "-g5" }, S8_explore: { q1: "lean" },
    },
    "lite-u": {
        S1_sure: { q1: "=", tlk: "=" }, S2_unsure: { tlk: "=", q1: "-g5" }, S3_doubt_sure_noE: { tlk: "=", q1: "-r" },
        S4_doubt_sure_E: { tlk: "=" }, S5_doubt_unsure_E: { q1: "=", m2: "=" }, S6_doubt_unsure_noE: { q1: "-g5" },
        S7_doubt_rec_below_yes1: { q1: "-g5" }, S8_explore: { q1: "lean" },
    },
    "lite-ub": {
        S1_sure: { q1: "=", tlk: "=" }, S2_unsure: { tlk: "=", q1: "-g5" }, S3_doubt_sure_noE: { tlk: "=", q1: "-r" },
        S4_doubt_sure_E: { tlk: "=" }, S5_doubt_unsure_E: { q1: "=", m2: "=" }, S6_doubt_unsure_noE: { q1: "=" },
        S7_doubt_rec_below_yes1: { q1: "=" }, S8_explore: { q1: "lean" },
    },
}
const PARENTS = { q1: Q.q1, tlk: T["t-lk"], m2: M.m2 }
const G5Q = "quarterly budget meeting schedule"
const nEmails = (p) => (p.match(/^\[\d+\]$/gm) ?? []).length
const isSandwich = (p) => p.startsWith("You answer questions about a person's email archive")
const isProbe = (p) => p.startsWith("Does the email below contain")

async function runOne(variant, record, sc, seedText) {
    const seq = []
    let probes = 0, answered = false, turns = 0
    const tok = (t, l, n = 1) => ({ message: { content: t }, done_reason: "stop", logprobs: Array.from({ length: n }, () => ({ token: "x", logprob: l, top_logprobs: [{ token: t, logprob: l }, { token: t === "YES" ? "NO" : "YES", logprob: -3 }] })) })
    const ctx = {
        dataDir, emailOf: emails.emailOf, bm25, search: async (q, k, u = null) => bm25.search(q, k, u).map((x) => x.path),
        resource: async (name, loader) => (resources.has(name) ? resources.get(name) : resources.set(name, await loader()).get(name)),
        chatRaw: async (body) => {
            if (body.tools) {
                turns++
                if (turns === 1) { seq.push("T1"); return { message: { content: "", tool_calls: [{ function: { name: "search_mailbox", arguments: { query: G5Q } } }] }, done_reason: "stop" } }
                const tool = body.messages.filter((m) => m.role === "tool").at(-1)?.content ?? ""
                seq.push(`T2:${h(tool)}:seedInFull=${seedText ? tool.includes(seedText) : "?"}`)
                return { message: { content: "", tool_calls: [{ function: { name: "answer", arguments: { text: "g5 answer" } } }] }, done_reason: "stop" }
            }
            const prompt = body.messages[0].content
            if (isProbe(prompt)) {
                probes++
                if (!answered) {
                    if (sc.yes1 !== null && probes === 1) { seq.push(`P:yes:${h(prompt)}`); return tok("YES", sc.yes1) }
                    seq.push(`P:no:${h(prompt)}`); return tok("NO", -0.01)
                }
                const k = probes - 1
                if (sc.rec && k === sc.rec[0]) { seq.push(`R${k}:yes:${h(prompt)}`); return tok("YES", sc.rec[1]) }
                seq.push(`R${k}:no:${h(prompt)}`); return tok("NO", -0.01)
            }
            if (isSandwich(prompt)) { answered = true; seq.push(`A${nEmails(prompt)}:${h(prompt)}`); return tok("gates answer", sc.a, 5) }
            seq.push(`chat?:${h(prompt)}`); return tok("?", -1)
        },
        generate: async ({ prompt }) => {
            if (prompt === RESET_PROMPT) { seq.push("RESET"); return { status: "ok", answer: "x", promptEvalCachedCount: 26 } }
            if (isSandwich(prompt)) { seq.push(`G${nEmails(prompt)}:${h(prompt)}`); return { status: "ok", answer: "gen answer" } }
            if (prompt.startsWith("You are searching")) { seq.push(`plan:${h(prompt)}`); return { status: "ok", answer: "FROM: | TO: | ABOUT: gas price contract" } }
            seq.push(`pick:${h(prompt)}`); return { status: "ok", answer: "1" }
        },
    }
    const out = await variant.run(ctx, record)
    return { seq, out }
}

// g5 calls in a parent's sequence: T1, T2 and every answer call after T1 (g5's final answer)
const withoutG5 = (seq) => { const i = seq.indexOf("T1"); return i < 0 ? seq : seq.slice(0, i) }
const withoutRec = (seq) => seq.filter((e) => !/^R\d+:/.test(e))
function lean(lite, parent) {
    // lite: P... pick P G (final); parent: P... pick P [plan pick P ...] G (final)
    const lp = lite.filter((e) => e.startsWith("pick:")), pp = parent.filter((e) => e.startsWith("pick:"))
    const lastL = lite.at(-1), lastP = parent.at(-1)
    const pre = lite.slice(0, lite.indexOf(lp[0]) + 2).join(" ") === parent.slice(0, parent.indexOf(pp[0]) + 2).join(" ")
    return lp.length === 1 && pp.length >= 1 && pre && lastL === lastP && /^G\d/.test(lastL)
}

let failures = 0, checks = 0
const fail = (msg) => { failures++; console.log(`   FAIL ${msg}`) }
for (const key of set.questionKeys.slice(0, Number(nq))) {
    const record = pool.byKey.get(key)
    const { W0 } = await x1Contexts({ search: async (q, k, u = null) => bm25.search(q, k, u).map((x) => x.path), emailOf: emails.emailOf }, record)
    const seedText = emails.emailOf(W0[0]).slice(0, 200)
    for (const [name, sc] of Object.entries(SCEN)) {
        const parents = {}
        for (const pid of ["q1", "tlk", "m2"]) parents[pid] = await runOne(PARENTS[pid], record, sc, seedText)
        console.log(`${key.slice(0, 44)} ${name}: parents q1 ${parents.q1.out.step}, t-lk ${parents.tlk.out.step}, m2 ${parents.m2.out.step}`)
        for (const vid of ["lite-a", "lite-u", "lite-ub"]) {
            const lite = await runOne(L[vid], record, sc, seedText)
            const s = lite.seq.join(" ")
            const res = []
            for (const [pid, how] of Object.entries(EXPECT[vid][name])) {
                const p = parents[pid].seq
                const ok = how === "=" ? s === p.join(" ") : how === "-g5" ? s === withoutG5(p).join(" ") && p.includes("T1") : how === "-r" ? s === withoutRec(p).join(" ") && p.some((e) => /^R\d+:/.test(e)) : lean(lite.seq, p)
                checks++
                res.push(`${how} ${pid} ${ok ? "ok" : "FAIL"}`)
                if (!ok) { fail(`${vid} ${name} ${how} ${pid}`); console.log(`      ${vid}: ${lite.seq.map((e) => e.slice(0, 14)).join(" ")}\n      ${pid}: ${p.map((e) => e.slice(0, 14)).join(" ")}`) }
            }
            const t2 = lite.seq.find((e) => e.startsWith("T2:"))
            console.log(`   ${vid}: step=${lite.out.step} lite=${JSON.stringify(lite.out.lite)} calls=${lite.seq.length} | ${res.join(", ")}${t2 ? ` | g5 turn 2 ${t2.split(":").slice(2).join(":")}` : ""}`)
            // det form: same real calls, each preceded by one reset
            const d = await runOne(L[vid.replace("lite-", "lite-det-")], record, sc, seedText)
            const real = d.seq.filter((e) => e !== "RESET")
            const okDet = real.join(" ") === s && d.seq.length === 2 * real.length && d.seq.every((e, i) => (i % 2 === 0 ? e === "RESET" : e !== "RESET"))
            checks++
            if (!okDet) fail(`${vid} det form ${name}`)
        }
    }
}
console.log(`\n${checks} checks, ${failures} failures`)
process.exit(failures ? 1 : 0)
