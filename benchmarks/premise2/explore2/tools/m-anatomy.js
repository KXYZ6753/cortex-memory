// Worker m: anatomy of x1's misses (gold not in P-B's global top 5).
// Pool records + stored x1 answers only. For every miss: where the AB email sits in the
// asker's mailbox BM25 list (deep), the global BM25 list, the cached MiniLM CE pool
// (p-ce-std: mailbox top 50 + global top 10), the stored dense lists (pdense, S300-2 only);
// what x1 did (commit/handover/explore), and for false-YES stops how the YES email relates
// to the gold email (thread, sender, quoting, near-dup, answer-word coverage).
//   node benchmarks/premise2/explore2/tools/m-anatomy.js [sets...]   (default S300-2 S300-1 FULL-0)
//   writes <SCRATCH>/m-anatomy.json (per-miss rows) for the m-* simulators
import { join } from "node:path"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
import { SCRATCH, readJsonIf, writeJsonFile } from "./r-common.js"
import { denseLists } from "./p-common.js"
import { splitFile, parseFileHeader, novelAnswerWords, contentWords } from "../../text.js"

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["S300-2", "S300-1", "FULL-0"]
const { graded, bearing, evidence, emails } = await openAll()
const bm25 = openBm25(join(".data/premise2", "corpus.sqlite"))
const ce = readJsonIf(join(SCRATCH, "p-ce-std.json"), {})
const dense = denseLists()
const hdr = (p) => parseFileHeader(splitFile(emails.emailOf(p)).header)
const normSubj = (s) => String(s ?? "").toLowerCase().replace(/^(\s*(re|fw|fwd)\s*:\s*)+/g, "").replace(/\s+/g, " ").trim()
const answerCover = (path, record) => {
    const words = novelAnswerWords([record.gold], record.question)
    if (!words.length) return null
    const have = evidence.wordsOf(path)
    return words.filter((w) => have.has(w)).length / words.length
}
const qCover = (path, record) => {
    const words = [...new Set(contentWords(record.question))]
    const have = evidence.wordsOf(path)
    return words.length ? words.filter((w) => have.has(w)).length / words.length : 0
}
const rankOf = (list, ab) => { const i = list.findIndex(ab); return i < 0 ? null : i + 1 }
const bucket = (r) => (r == null ? "none" : r <= 5 ? "1-5" : r <= 10 ? "6-10" : r <= 20 ? "11-20" : r <= 30 ? "21-30" : r <= 50 ? "31-50" : r <= 100 ? "51-100" : ">100")

const rows = []
for (const set of sets) {
    const items = graded("x1@1+cold", set).filter((i) => i.record.stratum === "miss")
    const tally = {}
    const add = (k) => { tally[k] = (tally[k] ?? 0) + 1 }
    for (const it of items) {
        const rec = it.record, a = it.answer, ab = bearing(rec)
        const mbox = bm25.search(rec.question, 5000, rec.user).map((h) => h.path)
        const glob = bm25.search(rec.question, 300).map((h) => h.path)
        const ceScores = ce[rec.questionKey] ?? {}
        const ceList = Object.entries(ceScores).sort((x, y) => y[1] - x[1]).map(([p]) => p)
        const d = dense.get(rec.questionKey)
        const log = a.log ?? []
        const checks = log.filter((l) => l.act === "check")
        const W0checks = a.step?.startsWith("commit") ? checks : checks.slice(0, 5)
        const yes = W0checks.find((c) => c.yes)
        const listed = new Set(log.flatMap((l) => l.listed ?? []))
        const searched = new Set(log.flatMap((l) => l.results ?? []))
        const shown = new Set([...checks.map((c) => c.path), ...listed, ...searched, ...(a.g5?.readPaths ?? []), ...(a.shownPaths ?? []), ...(a.g5 ? [] : [])])
        const final = new Set(a.readPaths ?? a.contextPaths ?? [])
        const abPaths = [...new Set([...mbox, ...glob].filter(ab))]
        const row = {
            set, key: rec.questionKey, correct: it.correct, step: a.step, user: rec.user,
            mbRank: rankOf(mbox, ab), glRank: rankOf(glob, ab), mbSize: mbox.length, nAB: abPaths.length,
            ceRank: rankOf(ceList, ab), cePool: ceList.length,
            dnRank: d ? rankOf(d.mailbox.map((x) => x[0]), ab) : undefined,
            yesAt: yes ? W0checks.indexOf(yes) : null, yesPath: yes?.path ?? null, yesLp: yes?.yesLp ?? null,
            yesAB: yes ? ab(yes.path) : null,
            abInW0: W0checks.some((c) => ab(c.path)) || (a.step?.startsWith("commit") && (a.gatesContext ?? []).some?.(ab)),
            abShown: [...shown].some(ab), abListed: [...listed].some(ab), abSearched: [...searched].some(ab),
            abOpened: checks.slice(W0checks.length).some((c) => ab(c.path)), abFinal: [...final].some(ab),
            found: a.foundPath ?? null, foundAB: a.foundPath ? ab(a.foundPath) : null,
        }
        // false-YES anatomy
        if (yes && !row.yesAB) {
            const y = yes.path, g = rec.path
            const rel = evidence.relation(g, y)
            const hy = hdr(y), hg = hdr(g)
            row.fy = {
                sameUserBox: y.startsWith(`${rec.user}/`),
                sameSubj: normSubj(hy.subject) !== "" && normSubj(hy.subject) === normSubj(hg.subject),
                subjNan: normSubj(hg.subject) === "nan" || normSubj(hg.subject) === "",
                sameSender: hy.sender.toLowerCase() === hg.sender.toLowerCase(),
                nearDup: (rec.nearDups ?? []).includes(y) || rel.nearDup,
                goldInYes: rel.goldInCandidate, yesInGold: rel.candidateInGold,
                ansCovYes: answerCover(y, rec), ansCovGold: answerCover(g, rec),
                qCovYes: qCover(y, rec), qCovGold: qCover(g, rec),
                yesMbRank: rankOf(mbox, (p) => p === y), yesGlRank: rankOf(glob, (p) => p === y),
                goldMbRank: rankOf(mbox, (p) => p === g),
                yesCe: ceScores[y] ?? null, goldCe: ceScores[g] ?? null,
            }
        }
        // outcome class
        let cls
        if (it.correct) cls = "ok"
        else if (yes && !row.yesAB) cls = row.abInW0 ? "wrong/falseYES/abInW0" : "wrong/falseYES/abOutW0"
        else if (yes && row.yesAB) cls = "wrong/trueYES(read)"
        else if (row.found && row.foundAB) cls = "wrong/explore-foundAB(read)"
        else if (row.found) cls = "wrong/explore-foundNonAB"
        else if (row.abShown) cls = "wrong/explore-ABshown-notfound"
        else cls = "wrong/explore-ABneverShown"
        row.cls = cls
        add(cls)
        add(`all/${a.step}`)
        add(`step/${a.step}/${it.correct ? "ok" : "bad"}`)
        rows.push(row)
    }
    const ms = rows.filter((r) => r.set === set)
    console.log(`\n== ${set} x1 misses n=${ms.length} correct=${ms.filter((r) => r.correct).length}`)
    for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(40)} ${v}`)
    // gold location by outcome
    const tab = (name, f) => {
        const t = {}
        for (const r of ms) { const b = f(r); t[b] ??= { n: 0, ok: 0 }; t[b].n++; t[b].ok += r.correct }
        console.log(`  ${name}: ` + Object.entries(t).sort().map(([b, v]) => `${b} ${v.ok}/${v.n}`).join(" | "))
    }
    tab("mailbox BM25 rank of best AB (ok/n)", (r) => bucket(r.mbRank))
    tab("global BM25 rank of best AB", (r) => bucket(r.glRank))
    tab("CE rank in cached pool (mbox50+glob10)", (r) => bucket(r.ceRank))
    if (ms.some((r) => r.dnRank !== undefined)) tab("dense mailbox top30 rank", (r) => bucket(r.dnRank))
    // never-found anatomy
    const nf = ms.filter((r) => r.cls === "wrong/explore-ABneverShown")
    console.log(`  never-shown (${nf.length}): mbox rank buckets ` + JSON.stringify(nf.reduce((t, r) => ((t[bucket(r.mbRank)] = (t[bucket(r.mbRank)] ?? 0) + 1), t), {})) + `; CE rank ` + JSON.stringify(nf.reduce((t, r) => ((t[bucket(r.ceRank)] = (t[bucket(r.ceRank)] ?? 0) + 1), t), {})) + `; nAB=0 ${nf.filter((r) => !r.nAB).length}`)
    const fy = ms.filter((r) => r.fy)
    const cnt = (f) => fy.filter(f).length
    console.log(`  falseYES (${fy.length}, ok ${fy.filter((r) => r.correct).length}): yesAt0 ${cnt((r) => r.yesAt === 0)}, sameMailbox ${cnt((r) => r.fy.sameUserBox)}, sameSubj ${cnt((r) => r.fy.sameSubj)}, sameSender ${cnt((r) => r.fy.sameSender)}, nearDup ${cnt((r) => r.fy.nearDup)}, goldInYes>=.3 ${cnt((r) => r.fy.goldInYes >= 0.3)}, yesInGold>=.3 ${cnt((r) => r.fy.yesInGold >= 0.3)}`)
    console.log(`    gold mbox rank: ` + JSON.stringify(fy.reduce((t, r) => ((t[bucket(r.mbRank)] = (t[bucket(r.mbRank)] ?? 0) + 1), t), {})) + `; CE rank: ` + JSON.stringify(fy.reduce((t, r) => ((t[bucket(r.ceRank)] = (t[bucket(r.ceRank)] ?? 0) + 1), t), {})))
    const mean = (f) => (fy.length ? (fy.reduce((s, r) => s + (f(r) ?? 0), 0) / fy.length).toFixed(2) : "-")
    console.log(`    answer-word cover yes ${mean((r) => r.fy.ansCovYes)} vs gold ${mean((r) => r.fy.ansCovGold)}; q-word cover yes ${mean((r) => r.fy.qCovYes)} vs gold ${mean((r) => r.fy.qCovGold)}; CE yes>gold ${cnt((r) => r.fy.yesCe != null && r.fy.goldCe != null && r.fy.yesCe > r.fy.goldCe)}/${cnt((r) => r.fy.yesCe != null && r.fy.goldCe != null)}`)
    console.log(`    AB shown anywhere ${cnt((r) => r.abShown)}, AB in final ${cnt((r) => r.abFinal)}; handover(g5) ${cnt((r) => r.step === "commit-g5")} ok ${fy.filter((r) => r.step === "commit-g5" && r.correct).length}`)
}
writeJsonFile(join(SCRATCH, "m-anatomy.json"), rows)
process.exit(0)
