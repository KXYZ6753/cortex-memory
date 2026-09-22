// Deterministic reanalysis of the V1 pilot (benchmarks/premiseBenchmark.js) with the
// V2 tooling. It makes no model or judge calls: it uses V1's own answers and
// verdicts, and adds V2's evidence checks (answer-bearing distractors, twins,
// retention) and V1-vs-V2 corrections. The V2 bridge cells re-grade V1's questions
// with the V2 pipeline; this file only reports what V1's own data supports.
//
//   node benchmarks/premise2/v1-reanalysis.js <v1 dir> [data dir]
// writes benchmarks/results/v1-pilot-reanalysis.md and .json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadRaw, splitMailboxes } from "./dataset.js"
import { EvidenceCache } from "./evidence.js"
import { retention } from "./represent.js"
import { openBm25 } from "./bm25.js"
import { exactMcNemar, clusterBootstrap, wilson } from "./stats.js"
import { criticalSpans, spanHaystack, spanPresent, questionType } from "./text.js"
import { segmentBody } from "./segment.js"
import { splitFile } from "./text.js"

const v1Dir = process.argv[2] ?? "/Users/kerem/Downloads/premise"
const dataDir = process.argv[3] ?? ".data/premise2"
const outDir = "benchmarks/results"

const readJsonl = (path) => readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN)
const r3 = (value) => (Number.isFinite(value) ? Number(value.toFixed(3)) : null)
const pts = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}` : "–")

const answers = readJsonl(join(v1Dir, "answers.jsonl")).filter((record) => record.type === "answer")
const verdictByCase = new Map()
for (const record of readJsonl(join(v1Dir, "verdicts.jsonl"))) if (record.type === "verdict" && record.caseKey) verdictByCase.set(record.caseKey, record.verdict)
const raw = await loadRaw(join(dataDir, "hf"))
const emailByPath = new Map(raw.corpus.map((row) => [row.path, row.email]))
const testByPath = new Map(raw.test.map((row) => [row.path, row]))
const evidence = new EvidenceCache(emailByPath)
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))

// ---- per-question records ----
const questions = new Map()
for (const answer of answers) {
    if (questions.has(answer.questionKey)) continue
    const row = testByPath.get(answer.path)
    const q = answer.questionIndex
    const gold = row?.gold_answers?.[q] ?? null
    questions.set(answer.questionKey, {
        questionKey: answer.questionKey, path: answer.path, user: answer.user, question: answer.question, gold,
        alternates: (row?.alternate_answers?.[q] ?? []).filter(Boolean), type: questionType(answer.question),
        threaded: segmentBody(splitFile(emailByPath.get(answer.path) ?? "").body).messages.length > 1,
    })
}
const cell = new Map()
for (const answer of answers) {
    if (!cell.has(answer.cellId)) cell.set(answer.cellId, new Map())
    cell.get(answer.cellId).set(answer.questionKey, { ...answer, correct: verdictByCase.get(answer.caseKey) === "CORRECT" ? 1 : 0, judged: verdictByCase.has(answer.caseKey) })
}
const acc = (id, filter = () => true) => {
    const rows = [...(cell.get(id)?.values() ?? [])].filter((row) => row.judged && filter(questions.get(row.questionKey), row))
    const correct = rows.filter((row) => row.correct).length
    return { n: rows.length, accuracy: r3(correct / rows.length), ci: wilson(correct, rows.length) }
}
const paired = (a, b, filter = () => true) => {
    const rows = []
    for (const [key, x] of cell.get(a) ?? []) {
        const y = cell.get(b)?.get(key)
        if (!y || !x.judged || !y.judged || !filter(questions.get(key), x, y)) continue
        rows.push({ user: x.user, d: x.correct - y.correct, x: x.correct, y: y.correct })
    }
    const onlyA = rows.filter((row) => row.d > 0).length
    const onlyB = rows.filter((row) => row.d < 0).length
    const boot = rows.length > 1 ? clusterBootstrap({ items: rows, clusterOf: (row) => row.user, statistic: (sample) => mean(sample.map((row) => row.d)), B: 10_000, seed: 20260922 }) : null
    return { n: rows.length, diff: r3(mean(rows.map((row) => row.d))), ci: boot ? [r3(boot.low), r3(boot.high)] : null, onlyFirst: onlyA, onlySecond: onlyB, exactMcNemarP: r3(exactMcNemar(onlyA, onlyB)) }
}

const out = { source: v1Dir, cells: {}, findings: {} }
for (const id of [...cell.keys()].sort()) out.cells[id] = acc(id)

// ---- 1. the oracle gap ----
out.findings.oracleGap = paired("oracle-large", "oracle-small")

// ---- 2. hard-negative contamination ----
const recordOf = (key) => {
    const q = questions.get(key)
    return { ...q, gold: q.gold ?? "" }
}
const contamination = {}
for (const id of ["dist4hard-small", "dist9hard-small", "dist4rand-small"]) {
    let contaminated = 0
    const reasons = { answerBearing: 0, twin: 0, nearDup: 0 }
    for (const [key, row] of cell.get(id) ?? []) {
        const record = recordOf(key)
        let dirty = false
        for (const path of row.distractorPaths ?? []) {
            const relation = evidence.relation(record.path, path)
            if (relation.twin) reasons.twin++
            else if (relation.nearDup) reasons.nearDup++
            if (relation.twin || evidence.answerBearing(path, record) === true) {
                if (!relation.twin) reasons.answerBearing++
                dirty = true
            }
        }
        if (dirty) contaminated++
        questions.get(key)[`dirty:${id.replace(/-small$/, "")}`] = dirty
    }
    contamination[id.replace(/-small$/, "")] = { contaminatedSets: contaminated, of: cell.get(id)?.size ?? 0, distractorReasons: reasons }
}
out.findings.contamination = contamination
const clean = (arm) => (q) => !q[`dirty:${arm}`]
out.findings.distraction = {}
for (const arm of ["dist4hard", "dist9hard", "dist4rand"]) {
    out.findings.distraction[arm] = {
        small: { all: paired("oracle-small", `${arm}-small`), cleanSetsOnly: paired("oracle-small", `${arm}-small`, clean(arm)) },
        large: { all: paired("oracle-large", `${arm}-large`), cleanSetsOnly: paired("oracle-large", `${arm}-large`, clean(arm)) },
    }
}

// ---- 3. how easy the retrieval was: gold rank under V2's BM25 ----
const ranks = []
for (const q of questions.values()) {
    const hits = bm25.search(q.question, 100)
    const index = hits.findIndex((hit) => hit.path === q.path)
    ranks.push(index < 0 ? null : index + 1)
}
out.findings.goldBm25Rank = { n: ranks.length, rank1: ranks.filter((r) => r === 1).length, top5: ranks.filter((r) => r != null && r <= 5).length, notInTop100: ranks.filter((r) => r == null).length }

// ---- 4. preprocessing: answer deletion vs neutral ----
const lossy = []
for (const q of questions.values()) {
    const kept = retention(emailByPath.get(q.path) ?? "", "RV1", [q.gold, ...q.alternates].filter(Boolean), q.question)
    q.rv1Loss = kept.spansKept < kept.spansPresent || kept.wordsKept < kept.wordsPresent
    q.rv1LostSpans = kept.lostSpans
    if (q.rv1Loss) lossy.push({ questionKey: q.questionKey, lostSpans: kept.lostSpans, lostWords: kept.lostWords.slice(0, 5) })
}
out.findings.preprocessing = {
    all: paired("oraclepre-small", "oracle-small"),
    answerLost: paired("oraclepre-small", "oracle-small", (q) => q.rv1Loss),
    answerKept: paired("oraclepre-small", "oracle-small", (q) => !q.rv1Loss),
    questionsWithLoss: lossy.length,
    lossExamples: lossy.slice(0, 12),
}

// ---- 5. the floor ----
out.findings.floor = Object.fromEntries(["floor-small", "floor-large"].map((id) => [id, [...(cell.get(id)?.values() ?? [])].filter((row) => row.correct).map((row) => ({ questionKey: row.questionKey, gold: questions.get(row.questionKey).gold, answer: row.answer?.slice(0, 160) }))]))

// ---- 6. which mailboxes V1 sampled ----
const { sizes } = splitMailboxes(raw.test, 20260922)
const bySize = [...sizes.entries()].sort((a, b) => a[1] - b[1]).map(([user]) => user)
const v1Users = new Set([...questions.values()].map((q) => q.user))
const positions = [...v1Users].map((user) => bySize.indexOf(user) + 1).sort((a, b) => a - b)
out.findings.mailboxes = { v1Mailboxes: v1Users.size, of: bySize.length, sizeRankMax: positions.at(-1), sizeRankMedian: positions[Math.floor(positions.length / 2)] }

// ---- 7. timing (warm calls only: load < 100 ms) ----
const timing = {}
for (const alias of ["small", "large"]) {
    const rows = [...(cell.get(`oracle-${alias}`)?.values() ?? [])]
    const warm = rows.filter((row) => (row.loadMs ?? 0) < 100 && row.wallMs)
    const walls = warm.map((row) => row.wallMs).sort((a, b) => a - b)
    const decode = warm.filter((row) => row.evalMs > 0 && row.evalCount > 1).map((row) => (row.evalCount - 1) / (row.evalMs / 1000)).sort((a, b) => a - b)
    timing[alias] = { calls: rows.length, warm: warm.length, medianWallMs: walls[Math.floor(walls.length / 2)] ?? null, meanWallMs: r3(mean(walls)), medianDecodeTokPerSec: r3(decode[Math.floor(decode.length / 2)]), meanOutputTokens: r3(mean(rows.map((row) => row.evalCount ?? 0))) }
}
{
    const pairs = []
    for (const [key, large] of cell.get("oracle-large") ?? []) {
        const small = cell.get("oracle-small")?.get(key)
        if (small && (large.loadMs ?? 0) < 100 && (small.loadMs ?? 0) < 100) pairs.push([large.wallMs, small.wallMs])
    }
    timing.warmRatioOfTotals = r3(pairs.reduce((s, [x]) => s + x, 0) / pairs.reduce((s, [, y]) => s + y, 0))
    timing.warmPairs = pairs.length
}
out.findings.timing = timing

// ---- 8. strata of the oracle gap ----
out.findings.oracleGapByStratum = {
    threaded: paired("oracle-large", "oracle-small", (q) => q.threaded),
    single: paired("oracle-large", "oracle-small", (q) => !q.threaded),
}
bm25.close()

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "v1-pilot-reanalysis.json"), JSON.stringify(out, null, 2) + "\n")

const f = out.findings
const line = (label, p) => `${label}: ${pts(p.diff)} pts [${pts(p.ci?.[0])}, ${pts(p.ci?.[1])}] (n=${p.n}; ${p.onlyFirst} vs ${p.onlySecond} discordant; exact McNemar p=${p.exactMcNemarP})`
const md = [
    "# V1 pilot: reanalysis with the V2 tooling",
    "",
    "The V1 pilot (`benchmarks/premiseBenchmark.js`, branch `poc-premise`) ran e2b (Q4_K_M) and 31b-it-qat on 100 EnronQA test questions.",
    "",
    "This file recomputes V1's results from V1's own answers and verdicts (judge: gpt-oss:20b-cloud, V1 rubric), and adds V2's evidence checks. It makes no new model or judge calls. The V2 run re-grades V1's questions with the V2 pipeline (bridge cells), so judge corrections are reported there, not here.",
    "",
    "Every number below is a pilot estimate on n=100, clustered by mailbox. It motivated V2's design, and it is not a result of the study.",
    "",
    "## Accuracy per V1 cell (V1 judge)",
    "",
    "| cell | n | accuracy | 95% Wilson |",
    "|---|---|---|---|",
    ...Object.entries(out.cells).map(([id, c]) => `| ${id} | ${c.n} | ${pts(c.accuracy)} | [${pts(c.ci[0])}, ${pts(c.ci[1])}] |`),
    "",
    "## Findings",
    "",
    `1. **Oracle gap (31b − e2b).** ${line("Gap", f.oracleGap)}. Threaded files: ${pts(f.oracleGapByStratum.threaded.diff)} pts (n=${f.oracleGapByStratum.threaded.n}); single-message files: ${pts(f.oracleGapByStratum.single.diff)} pts (n=${f.oracleGapByStratum.single.n}).`,
    `2. **Hard negatives often carried the answer.** Under V2's checks (twin, or an answer-bearing distractor), ${f.contamination.dist4hard.contaminatedSets}/${f.contamination.dist4hard.of} dist4-hard sets and ${f.contamination.dist9hard.contaminatedSets}/${f.contamination.dist9hard.of} dist9-hard sets contained the answer outside the gold (random sets: ${f.contamination.dist4rand.contaminatedSets}/${f.contamination.dist4rand.of}). The distraction loss (oracle − distractors) on all sets vs clean sets only:`,
    ...["dist4hard", "dist9hard", "dist4rand"].flatMap((arm) => [
        `   - ${arm}, e2b: all ${pts(f.distraction[arm].small.all.diff)} pts (n=${f.distraction[arm].small.all.n}), clean ${pts(f.distraction[arm].small.cleanSetsOnly.diff)} pts (n=${f.distraction[arm].small.cleanSetsOnly.n})`,
        `   - ${arm}, 31b: all ${pts(f.distraction[arm].large.all.diff)} pts (n=${f.distraction[arm].large.all.n}), clean ${pts(f.distraction[arm].large.cleanSetsOnly.diff)} pts (n=${f.distraction[arm].large.cleanSetsOnly.n})`,
    ]),
    `3. **Retrieval was easy for V1's questions.** The gold email is BM25 rank 1 for ${f.goldBm25Rank.rank1}/${f.goldBm25Rank.n} questions and in the top 5 for ${f.goldBm25Rank.top5}/${f.goldBm25Rank.n}. V1's pool was the ${f.mailboxes.v1Mailboxes} mailboxes up to size rank ${f.mailboxes.sizeRankMax} of ${f.mailboxes.of}, i.e. the smallest inboxes.`,
    `4. **The preprocessing loss is answer deletion.** ${line("Preprocessed − original (e2b)", f.preprocessing.all)}. V1's preprocessing removes answer content (for example URLs turned into \`[link]\`, or dropped \`Sent:\` lines) for ${f.preprocessing.questionsWithLoss} questions. On those, the difference is ${pts(f.preprocessing.answerLost.diff)} pts (n=${f.preprocessing.answerLost.n}); on the rest, ${pts(f.preprocessing.answerKept.diff)} pts (n=${f.preprocessing.answerKept.n}). V2's representations are lossless by construction and audited (R0/R1/R2: 0 losses over all 89,316 questions).`,
    `5. **The floor.** Correct answers without any email: e2b ${f.floor["floor-small"].length}, 31b ${f.floor["floor-large"].length}. V2 flags unanswerable golds and runs the floor at n=100 per model.`,
    `6. **Timing.** Warm e2b median ${f.timing.small.medianWallMs} ms and decode ${f.timing.small.medianDecodeTokPerSec} tok/s; warm 31b median ${f.timing.large.medianWallMs} ms and decode ${f.timing.large.medianDecodeTokPerSec} tok/s. The warm ratio of totals (31b/e2b) is ${f.timing.warmRatioOfTotals} over ${f.timing.warmPairs} pairs. V1's headline ratio included cold loads. On the 8 GB GPU the 31b runs mostly on CPU, so the ratio is hardware-specific.`,
    "",
    "## What V2 changes because of this",
    "",
    "- Tuning and evaluation are separated by mailbox, and every inbox size is sampled.",
    "- Distractors are answer-free by construction.",
    "- Representations are lossless and audited.",
    "- Grading uses two judges plus an evidence-grounded adjudicator.",
    "- Timing excludes cold loads.",
    "- Energy is measured per block.",
    "",
    "See `benchmarks/premise2/PREREG.md`.",
    "",
]
writeFileSync(join(outDir, "v1-pilot-reanalysis.md"), md.join("\n"))
console.log(JSON.stringify(out.findings, null, 1).slice(0, 3000))
