// Offline (no GPU, no grading): error anatomy of `gates` on a set (default FULL-0).
// Joins latest answers with J1 verdicts (as explore/analyze.js), reconstructs both gates
// contexts from the frozen pool lists, and writes per-question rows + summary tables.
// node benchmarks/premise2/explore2/tools/f-anatomy.js [FULL-0] > scratch.json  (summary on stderr)
import { join } from "node:path"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { byHeaderRank } from "../../explore/variants.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { isAbstain } from "../../prompts.js"
import { EvidenceCache } from "../../evidence.js"
import { ensureEmailStore } from "../../agent-run.js"
import { openBm25 } from "../../bm25.js"

try { process.loadEnvFile(".env") } catch {}
const dataDir = ".data/premise2"
const [setName = "FULL-0"] = process.argv.slice(2)
const VARS = ["gates", "oracles", "pbs", "gatea", "pb", "gates6", "gatesi", "gatesm", "gatesf", "hdru", "oracle"]
const pool = loadPool(dataDir)
const set = loadSet(dataDir, setName, pool)
const keys = new Set(set.questionKeys)
const missShare = pool.manifest.strata.missShare
const judge = judgeConfig("j1")
const verdicts = verdictIndex(dataDir)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const evidence = new EvidenceCache({ get: emails.emailOf })
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))

const rows = new Map()
for (const answer of latestAnswers(dataDir)) {
    if (answer.set !== setName || answer.alias !== "small" || !keys.has(answer.questionKey) || !VARS.includes(answer.variant)) continue
    const record = pool.byKey.get(answer.questionKey)
    const pre = preGrade(answer)
    let correct = null, reason = null
    if (pre) correct = 0
    else { const v = verdicts.get(answerVerdictKey(answer, record, judge)); if (v) { correct = v.verdict === "CORRECT" ? 1 : 0; reason = v.reason ?? v.missing ?? null } }
    if (!rows.has(answer.questionKey)) rows.set(answer.questionKey, { record, v: {} })
    rows.get(answer.questionKey).v[answer.variant] = { answer, correct, reason, abstain: Boolean(pre?.abstain) || isAbstain(answer.answer) }
}

const bodyKey = (p) => evidence.bodyKey(p)
const out = []
let mismatch = 0
for (const [qk, { record, v }] of rows) {
    const g = v.gates
    if (!g || g.correct === null) continue
    const ab = (p) => p === record.path || (record.twins ?? []).includes(p) || evidence.answerBearing(p, record) === true
    const global = record.lists.global.slice(0, 5)
    const mailbox = byHeaderRank(record.question, record.lists.user.slice(0, 20), emails.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const contexts = switched ? [mailbox, global] : [global, mailbox]
    if (JSON.stringify(contexts[0]) !== JSON.stringify(g.answer.contextPaths)) mismatch++
    const used = g.answer.used ?? 1
    const final = contexts[used - 1]
    const finalSource = (switched ? ["mailbox", "global"] : ["global", "mailbox"])[used - 1]
    const pos = (list) => { const i = list.findIndex(ab); return i < 0 ? null : i + 1 }
    const posFinal = pos(final), posGlobal = pos(global), posMailbox = pos(mailbox), posFirst = pos(contexts[0])
    // Deep ranks (top 50) for never-found analysis.
    let deep = null
    if (posGlobal === null && posMailbox === null) {
        const g50 = bm25.search(record.question, 50).map((h) => h.path)
        const u50 = bm25.search(record.question, 50, record.user).map((h) => h.path)
        const uh = byHeaderRank(record.question, u50, emails.emailOf)
        deep = { global50: pos(g50), mailbox50: pos(u50), mailboxHeader50: pos(uh), goldInMailbox: record.path.startsWith(`${record.user}/`) }
    }
    let bucket
    if (g.correct) bucket = "correct"
    else if (g.abstain) bucket = (posGlobal || posMailbox) ? "abstained (gold in view)" : "abstained (gold not in view)"
    else if (posFinal) bucket = "reading error"
    else if (posGlobal || posMailbox) bucket = "wrong context (gold only in unused ctx)"
    else bucket = "never found"
    const texts = final.map((p) => emails.emailOf(p))
    const keysF = final.map(bodyKey)
    out.push({
        qk, user: record.user, stratum: record.stratum, question: record.question, gold: record.gold, alternates: record.alternates, goldPath: record.path, nTwins: (record.twins ?? []).length,
        answer: g.answer.answer, correct: g.correct, reason: g.reason, bucket, switched, used, retry: used > 1, finalSource, posFinal, posFirst, posGlobal, posMailbox, deep,
        ctxChars: texts.reduce((s, t) => s + t.length, 0), goldChars: emails.emailOf(record.path).length,
        otherMailbox: final.filter((p) => !p.startsWith(`${record.user}/`)).length,
        dupBodies: keysF.length - new Set(keysF).size,
        nAB: final.filter(ab).length,
        finalPaths: final, globalPaths: global, mailboxPaths: mailbox, user20: record.lists.user, global20: record.lists.global,
        others: Object.fromEntries(Object.entries(v).filter(([k]) => k !== "gates").map(([k, x]) => [k, { c: x.correct, a: x.answer.answer, ab: x.abstain }])),
        wall: g.answer.wallMs,
    })
}
bm25.close()
process.stderr.write(`rows ${out.length}, context mismatches vs stored contextPaths ${mismatch}, missShare ${missShare}\n`)
console.log(JSON.stringify({ missShare, rows: out }))
