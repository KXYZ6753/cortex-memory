// z: x1's wrong misses: where is the AB email (mailbox BM25 rank, probed?), and what
// did the YES email look like vs the gold email (headers)?
import { join } from "node:path"
import { openAll } from "./a-lib.js"
import { openBm25 } from "../../bm25.js"
const { graded, bearing, emails } = await openAll()
const bm25 = openBm25(join(".data/premise2", "corpus.sqlite"))
const head = (p) => { const e = emails.emailOf(p) ?? ""; const h = e.split("\n=====")[0]; const g = (n) => (h.match(new RegExp(`^${n}:(.*)$`, "m"))?.[1] ?? "").trim().slice(0, 70); return `${g("Date").slice(0, 25)} | ${g("Sender")} | ${g("Subject")}` }
const set = process.argv[2] ?? "S300-2", verbose = process.argv[3] === "v"
const rows = graded("x1@1+cold", set).filter((i) => i.record.stratum === "miss" && i.correct === 0)
const cells = {}
for (const i of rows) {
    const r = i.record, ab = bearing(r), a = i.answer
    const mbox = bm25.search(r.question, 200, r.user).map((h) => h.path)
    const rank = mbox.findIndex(ab)
    const checks = (a.log ?? []).filter((l) => l.act === "check")
    const yes = checks.find((c) => c.yes)
    const probedAB = checks.some((c) => ab(c.path))
    const listedAB = (a.log ?? []).some((l) => (l.listed ?? []).some(ab) || (l.results ?? []).some(ab))
    const bucket = rank < 0 ? "none200" : rank < 5 ? "1-5" : rank < 10 ? "6-10" : rank < 30 ? "11-30" : rank < 50 ? "31-50" : "51-200"
    const key = `${a.step} ${yes ? (ab(yes.path) ? "trueYES" : "falseYES") : "noYES"} ab@${bucket}`
    cells[key] = (cells[key] ?? 0) + 1
    if (verbose) {
        console.log(`[${key}] probedAB=${probedAB} listedAB=${listedAB} yesLp=${yes?.yesLp}\n Q: ${r.question}\n GOLD: ${r.gold}\n ANS: ${String(a.answer).slice(0, 200)}\n gold: ${head(r.path)}`)
        if (yes && !ab(yes.path)) console.log(` YES : ${head(yes.path)}`)
        console.log()
    }
}
console.log(set, rows.length, Object.entries(cells).sort())
process.exit(0)
