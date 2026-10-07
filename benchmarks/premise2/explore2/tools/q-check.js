// Worker q: offline stub check of q1 / q2 and their det forms (no GPU). A fake ctx scripts the
// model (W0 probe YES/NO + token logprob, gates' answer mean logprob, recovery probes, list
// picks, the plan, and the g5 agent's two tool turns: search_mailbox(Q) then answer) and records
// every call with a hash of its exact prompt. The real g5 code runs, so the seeded search shows
// up in the hash of g5's second turn (the tool result it read).
// For each scenario q1's call sequence is compared with its parents' (x1, d8, m2) on the same
// script; q2's with q1's (only answer prompts may differ); det forms with their plain forms
// (same real calls, each preceded by one reset).
//   node benchmarks/premise2/explore2/tools/q-check.js [set] [nQuestions]
import { join } from "node:path"
import { createHash } from "node:crypto"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { VARIANTS as Q } from "../variants/q-stack.js"
import { VARIANTS as X } from "../variants/x-agent.js"
import { VARIANTS as D } from "../variants/d-agent.js"
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

// yes1: first W0 probe's YES logprob (null: every W0 probe NO -> explore); a: gates' answer mean
// lp; rec: [k, lp] = the k-th recovery probe says YES with that lp
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
// which parent q1 must equal call for call ("=") or match up to g5's seeded search ("~")
const EXPECT = {
    S1_sure: { x1: "=", d8: "=", m2: "=" },
    S2_unsure: { d8: "=", x1: "~", m2: "~" },
    S3_doubt_sure_noE: { m2: "=" },
    S4_doubt_sure_E: { m2: "=" },
    S5_doubt_unsure_E: { m2: "=" },
    S6_doubt_unsure_noE: { m2: "~" },
    S7_doubt_rec_below_yes1: { m2: "~" },
    S8_explore: { d8: "=" },
}
const G5Q = "quarterly budget meeting schedule"   // g5's scripted query (not the question)

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

const kind = (e) => e.split(":")[0]
const isAnswer = (e) => /^[AG]\d/.test(e)
let failures = 0
const fail = (msg) => { failures++; console.log(`   FAIL ${msg}`) }
for (const key of set.questionKeys.slice(0, Number(nq))) {
    const record = pool.byKey.get(key)
    const { W0 } = await x1Contexts({ search: async (q, k, u = null) => bm25.search(q, k, u).map((x) => x.path), emailOf: emails.emailOf }, record)
    const seedText = emails.emailOf(W0[0]).slice(0, 200)
    for (const [name, sc] of Object.entries(SCEN)) {
        const q1 = await runOne(Q.q1, record, sc, seedText)
        const s1 = q1.seq.join(" ")
        console.log(`${key.slice(0, 44)} ${name}: q1 step=${q1.out.step} ctx=${(q1.out.contextPaths ?? []).length} q=${JSON.stringify({ m2Fired: q1.out.q.m2Fired, rec: Boolean(q1.out.q.recovered), seeded: q1.out.q.seeded })}`)
        console.log(`   q1: ${q1.seq.map((e) => e.slice(0, 16)).join(" ")}`)
        for (const [pid, how] of Object.entries(EXPECT[name])) {
            const p = await runOne({ x1: X.x1, d8: D.d8, m2: M.m2 }[pid], record, sc, seedText)
            const sp = p.seq.join(" ")
            const same = sp === s1
            // "~": equal up to g5's second turn (the tool result: seeded vs unseeded search); from there on
            // the same kinds of calls (g5's final answer reads what its search showed, so it may differ)
            const t2 = q1.seq.findIndex((e) => e.startsWith("T2:"))
            const near = t2 >= 0 && p.seq.length === q1.seq.length && p.seq.every((e, i) => (i < t2 ? e === q1.seq[i] : kind(e) === kind(q1.seq[i]) || (/^G\d/.test(e) && /^G\d/.test(q1.seq[i]))))
            const verdict = same ? "IDENTICAL" : near ? "SAME EXCEPT g5 TOOL RESULT" : "DIFFERENT"
            console.log(`   vs ${pid}: ${verdict} (step ${p.out.step})`)
            if (how === "=" && !same) { fail(`${name} q1 != ${pid}`); console.log(`      ${pid}: ${p.seq.map((e) => e.slice(0, 16)).join(" ")}`) }
            if (how === "~" && !near) { fail(`${name} q1 !~ ${pid}`); console.log(`      ${pid}: ${p.seq.map((e) => e.slice(0, 16)).join(" ")}`) }
            if (how === "~" && same && q1.out.q.seeded) fail(`${name}: seeded but g5 saw the same result as ${pid}`)
        }
        // m2 fired without an accepted E: q1 minus its recovery probes must be d8 exactly
        if (["S3_doubt_sure_noE", "S6_doubt_unsure_noE", "S7_doubt_rec_below_yes1"].includes(name)) {
            const d8 = await runOne(D.d8, record, sc, seedText)
            const stripped = q1.seq.filter((e) => !/^R\d+:/.test(e)).join(" ")
            const ok = stripped === d8.seq.join(" ")
            console.log(`   q1 without recovery probes vs d8: ${ok ? "IDENTICAL" : "DIFFERENT"} (step ${d8.out.step})`)
            if (!ok) { fail(`${name} q1-R != d8`); console.log(`      d8: ${d8.seq.map((e) => e.slice(0, 16)).join(" ")}`) }
        }
        // seeding sanity: the seed is shown in g5's tool result iff q1 seeded (d8 too)
        const t2 = q1.seq.find((e) => e.startsWith("T2:"))
        if (t2) console.log(`   g5 turn 2: ${t2.split(":").slice(2).join(":")}, seeded=${q1.out.q.seeded}`)
        // q2 vs q1: same calls; only answer prompts may differ
        const q2 = await runOne(Q.q2, record, sc, seedText)
        const sameShape = q2.seq.length === q1.seq.length && q2.seq.every((e, i) => kind(e) === kind(q1.seq[i]))
        const nonAnswerSame = sameShape && q2.seq.every((e, i) => isAnswer(e) || e === q1.seq[i])
        const answersDiff = q2.seq.filter((e, i) => isAnswer(e) && e !== q1.seq[i]).length
        console.log(`   q2 vs q1: ${sameShape && nonAnswerSame ? "same calls, non-answer prompts identical" : "DIFFERENT"}; answer prompts relabelled ${answersDiff}/${q2.seq.filter(isAnswer).length}; rebuilt ${q2.out.c?.rebuilt ?? 0}`)
        if (!(sameShape && nonAnswerSame)) fail(`${name} q2 calls differ from q1`)
        // det forms: same real calls, each preceded by a reset
        for (const [id, plain] of [["q-det-q1", q1], ["q-det-q2", q2]]) {
            const d = await runOne(Q[id], record, sc, seedText)
            const real = d.seq.filter((e) => e !== "RESET")
            const paired = d.seq.every((e, i) => (i % 2 === 0 ? e === "RESET" : e !== "RESET")) && d.seq.length === 2 * real.length
            const same = real.join(" ") === plain.seq.join(" ")
            if (!same || !paired) fail(`${name} ${id}: real calls same ${same}, reset before each ${paired}`)
        }
    }
}
console.log({ failures })
bm25.close(); process.exit(failures ? 1 : 0)
